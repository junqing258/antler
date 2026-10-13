import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchedulerDialog } from "@/components/scheduler-dialog";
import type { ScheduledTask } from "@/lib/scheduler-api";

const getServerInfo = async () => ({
  baseUrl: "http://127.0.0.1:3210",
  token: "test-token",
});
const task: ScheduledTask = {
  id: "task-1",
  name: "每日汇总",
  type: "service",
  schedule: "0 9 * * *",
  enabled: true,
  runAt: null,
  lastExecutedAt: null,
};
const response = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const list = (tasks = [task]) => ({
  tasks,
  total: tasks.length,
  page: 1,
  limit: 20,
});
function open() {
  render(<SchedulerDialog getServerInfo={getServerInfo} onClose={vi.fn()} />);
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("scheduler dialog", () => {
  it("loads authenticated task lists and handles an empty schedule", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(list([])));
    vi.stubGlobal("fetch", fetchMock);
    open();
    await screen.findByText("暂无定时任务");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3210/api/scheduled-tasks?page=1&limit=20",
      expect.objectContaining({
        headers: {
          "x-antler-token": "test-token",
        },
      }),
    );
  });
  it.each(["cron", "delay"])(
    "creates assistant tasks using %s scheduling",
    async (mode) => {
      const fetchMock = vi.fn().mockResolvedValue(response(list([])));
      vi.stubGlobal("fetch", fetchMock);
      open();
      await screen.findByText("暂无定时任务");
      fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
      fireEvent.change(screen.getByLabelText("任务名称"), {
        target: { value: "  每日汇总  " },
      });
      fireEvent.change(screen.getByLabelText("任务内容"), {
        target: { value: "  汇总待办事项  " },
      });
      if (mode === "delay") {
        fireEvent.change(screen.getByLabelText("执行方式"), {
          target: { value: "delay" },
        });
        fireEvent.change(screen.getByLabelText("延迟分钟数"), {
          target: { value: "2" },
        });
      }
      fetchMock
        .mockResolvedValueOnce(response(task, 201))
        .mockResolvedValue(response(list()));
      fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
      await screen.findByText("任务已创建。");
      const creation = fetchMock.mock.calls.find(
        ([, init]) => init.method === "POST",
      );
      expect(JSON.parse(creation![1].body)).toEqual({
        name: "每日汇总",
        type: "service",
        schedule: mode === "delay" ? "delay:120000" : "0 9 * * *",
        payload: {
          service: "taskService",
          method: "create",
          args: ["汇总待办事项"],
        },
      });
      expect(
        screen.queryByRole("form", { name: "新建定时任务" }),
      ).not.toBeInTheDocument();
    },
  );
  it("preserves the creation form when the backend rejects the schedule", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(list([])));
    vi.stubGlobal("fetch", fetchMock);
    open();
    await screen.findByText("暂无定时任务");
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.change(screen.getByLabelText("任务名称"), {
      target: { value: "保留的任务" },
    });
    fireEvent.change(screen.getByLabelText("任务内容"), {
      target: { value: "保留的内容" },
    });
    fetchMock.mockResolvedValueOnce(
      response({ error: "Invalid cron expression" }, 400),
    );
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid cron expression",
    );
    expect(screen.getByLabelText("任务内容")).toHaveValue("保留的内容");
    expect(screen.getByRole("button", { name: "创建任务" })).toBeEnabled();
  });
  it("disables tasks and reflects the server's resulting state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(list()));
    vi.stubGlobal("fetch", fetchMock);
    open();
    await screen.findByRole("button", { name: "停用" });
    fetchMock
      .mockResolvedValueOnce(response({ ...task, enabled: false }))
      .mockResolvedValue(response(list([{ ...task, enabled: false }])));
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    await screen.findByText("已停用");
    expect(screen.getByRole("button", { name: "立即执行" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/task-1/disable"),
      expect.objectContaining({
        method: "POST",
        headers: { "x-antler-token": "test-token" },
      }),
    );
  });
  it("triggers in the background and opens execution history", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/executions"))
          return Promise.resolve(
            response({
              executions: [
                {
                  id: "e1",
                  status: "running",
                  startedAt: "2026-10-13T00:00:00Z",
                  duration: null,
                  error: null,
                  result: null,
                  retryAttempt: 0,
                },
              ],
            }),
          );
        if (init?.method === "POST")
          return Promise.resolve(
            response({ executionId: "e1", status: "running" }, 202),
          );
        return Promise.resolve(response(list()));
      });
    vi.stubGlobal("fetch", fetchMock);
    open();
    await screen.findByText(task.name);
    fireEvent.click(screen.getByRole("button", { name: "立即执行" }));
    await screen.findByText("执行中");
    expect(
      screen.getByText("已受理执行，可在执行历史中查看结果。"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/task-1/trigger"),
      expect.objectContaining({
        method: "POST",
        headers: { "x-antler-token": "test-token" },
      }),
    );
  });
  it("shows concurrency errors from manual triggers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(list()));
    vi.stubGlobal("fetch", fetchMock);
    open();
    await screen.findByText(task.name);
    fetchMock.mockResolvedValueOnce(response({ error: "任务正在执行中" }, 409));
    fireEvent.click(screen.getByRole("button", { name: "立即执行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "任务正在执行中",
    );
  });
  it("requires confirmation to delete and removes the task after a 204 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(list()));
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    open();
    await screen.findByText(task.name);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    fetchMock
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValue(response(list([])));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await screen.findByText("暂无定时任务");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/task-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
  it("does not reenable consumed one-time tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response(
            list([
              { ...task, enabled: false, schedule: "delay:0", runAt: null },
            ]),
          ),
        ),
    );
    open();
    await screen.findByText(/一次性任务已结束/);
    expect(screen.getByRole("button", { name: "启用" })).toBeDisabled();
  });
  it("allows retrying a failed list load", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ error: "暂时无法读取" }, 500))
      .mockResolvedValue(response(list()));
    vi.stubGlobal("fetch", fetchMock);
    open();
    await screen.findByRole("alert");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "刷新定时任务" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "刷新定时任务" }));
    await screen.findByText(task.name);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
