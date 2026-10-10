import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectDialog } from "@/components/project-dialog";

const getServerInfo = async () => ({ baseUrl: "http://server", token: "test-token" });
const project = {
  id: "project-1",
  name: "My project",
  workingDirectory: "/workspace/My project",
  createdAt: 0,
  updatedAt: 0,
};

vi.mock("@/components/directory-picker", () => ({
  DirectoryPicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="工作目录" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

afterEach(() => vi.unstubAllGlobals());

describe("ProjectDialog", () => {
  it("preserves general edits across tabs and saves trimmed project values", async () => {
    const onSave = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ skills: [], diagnostics: [] }) });
    vi.stubGlobal("fetch", fetch);
    render(<ProjectDialog project={project} getServerInfo={getServerInfo} onSave={onSave} onClose={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "常规" })).toHaveAttribute("aria-selected", "true");
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), { target: { value: " Edited project " } });
    fireEvent.change(screen.getByRole("textbox", { name: "工作目录" }), { target: { value: " /workspace/new folder " } });
    fireEvent.click(screen.getByRole("tab", { name: "Skill" }));
    await screen.findByText("暂无可用 Skill。");
    expect(fetch).toHaveBeenCalledWith("http://server/api/skills?workingDirectory=%2Fworkspace%2Fnew%20folder", {
      headers: { "x-antler-token": "test-token" }, signal: expect.any(AbortSignal),
    });
    expect(screen.queryByRole("textbox", { name: "项目名称" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Subagent" }));
    expect(screen.getByText("Subagent 配置即将推出。")).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "常规" }));
    expect(screen.getByRole("textbox", { name: "项目名称" })).toHaveValue(" Edited project ");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith({ name: "Edited project", workingDirectory: "/workspace/new folder" });
  });

  it("shows available skills, scope and diagnostics, and retries a failed request", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "服务不可用" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        skills: [
          { id: "workspace:test", name: "Test skill", description: "项目技能说明", scope: "workspace" },
          { id: "user:test", name: "User skill", description: "用户技能说明", scope: "user" },
          { id: "bundled:test", name: "Bundled skill", description: "内置技能说明", scope: "bundled" },
        ],
        diagnostics: [{ code: "skill_invalid", name: "Invalid skill", message: "缺少描述", scope: "workspace" }],
      }) });
    vi.stubGlobal("fetch", fetch);
    render(<ProjectDialog getServerInfo={getServerInfo} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Skill" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在加载 Skill");
    expect(await screen.findByRole("alert")).toHaveTextContent("服务不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("项目技能说明");
    for (const scope of ["项目", "用户", "内置"]) expect(within(screen.getByRole("list")).getByText(scope)).toBeVisible();
    expect(screen.getByText("Invalid skill：缺少描述")).toBeVisible();
    expect(fetch).toHaveBeenLastCalledWith("http://server/api/skills", expect.any(Object));
  });

  it("filters project and global skills and diagnostics without refetching", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      skills: [
        { id: "workspace:test", name: "Project skill", description: "项目技能", scope: "workspace" },
        { id: "user:test", name: "User skill", description: "用户技能", scope: "user" },
        { id: "bundled:test", name: "Bundled skill", description: "内置技能", scope: "bundled" },
      ],
      diagnostics: [
        { code: "skill_invalid", message: "项目技能错误", scope: "workspace" },
        { code: "skill_invalid", message: "用户技能错误", scope: "user" },
        { code: "skill_invalid", message: "内置技能错误", scope: "bundled" },
      ],
    }) });
    vi.stubGlobal("fetch", fetch);
    render(<ProjectDialog project={project} getServerInfo={getServerInfo} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Skill" }));
    await screen.findByRole("heading", { name: "Project skill" });
    expect(screen.getByRole("tab", { name: "全部" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    fireEvent.click(screen.getByRole("tab", { name: "项目" }));
    expect(screen.getByRole("tabpanel", { name: "项目" })).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Project skill" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "User skill" })).not.toBeInTheDocument();
    expect(screen.getByText("项目技能错误")).toBeVisible();
    expect(screen.queryByText("用户技能错误")).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("tab", { name: "项目" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "全局" })).toHaveFocus();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Project skill" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "User skill" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Bundled skill" })).toBeVisible();
    expect(screen.queryByText("项目技能错误")).not.toBeInTheDocument();
    expect(screen.getByText("用户技能错误")).toBeVisible();
    expect(screen.getByText("内置技能错误")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "全部" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state for each scope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ skills: [], diagnostics: [] }) }));
    render(<ProjectDialog project={project} getServerInfo={getServerInfo} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Skill" }));
    await screen.findByText("暂无可用 Skill。");
    fireEvent.click(screen.getByRole("tab", { name: "项目" }));
    expect(screen.getByText("当前项目暂无可用 Skill。")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "全局" }));
    expect(screen.getByText("暂无可用的全局 Skill。")).toBeVisible();
  });

  it("keeps new project validation and supports keyboard tab navigation and dismissal", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<ProjectDialog getServerInfo={getServerInfo} onSave={onSave} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "新建项目" })).toBeVisible();
    expect(screen.getByRole("button", { name: "创建项目" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "创建项目" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("tab", { name: "常规" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "Subagent" })).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Subagent" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Subagent" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "常规" })).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), { target: { value: " New project " } });
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    expect(onSave).toHaveBeenCalledWith({ name: "New project", workingDirectory: "" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("aborts the skill request when switching away", async () => {
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    render(<ProjectDialog project={project} getServerInfo={getServerInfo} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Skill" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("tab", { name: "Subagent" }));
    expect(signal.aborted).toBe(true);
  });
});
