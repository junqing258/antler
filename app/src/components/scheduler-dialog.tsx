import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarClockIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  schedulerApi,
  type ScheduledTask,
  type ScheduledTaskList,
  type TaskExecution,
} from "@/lib/scheduler-api";
import type { ServerInfo } from "@/lib/server-info";

const buttonClass =
  "rounded-lg border border-[#ddd] bg-white px-3 py-2 text-xs text-[#4b4b4b] hover:bg-[#f0f0f0] disabled:cursor-not-allowed disabled:opacity-50";
const inputClass =
  "w-full rounded-lg border border-[#ddd] bg-white px-3 py-2 text-sm font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";
const statusLabels = {
  running: "执行中",
  succeeded: "成功",
  failed: "失败",
  timeout: "超时",
};
const typeLabels = { http: "HTTP", service: "服务", script: "脚本" };
const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN") : "尚未执行";
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试。";

function CreateTaskForm({
  busy,
  onCreate,
  onBack,
}: {
  busy: boolean;
  onCreate: (name: string, schedule: string, message: string) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState("cron");
  const [cron, setCron] = useState("0 9 * * *");
  const [minutes, setMinutes] = useState("30");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !message.trim() || busy) return;
    onCreate(
      name.trim(),
      mode === "cron" ? cron.trim() : `delay:${Number(minutes) * 60000}`,
      message.trim(),
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-4" aria-label="新建定时任务">
      <label className="grid gap-1.5 text-xs font-semibold text-[#555]">
        任务名称
        <input
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoFocus
          maxLength={200}
        />
      </label>
      <label className="grid gap-1.5 text-xs font-semibold text-[#555]">
        任务内容
        <textarea
          className={`${inputClass} min-h-28 resize-y`}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="例如：检查工作区并汇总今日待办事项"
          required
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-semibold text-[#555]">
          执行方式
          <select
            className={inputClass}
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="cron">周期执行</option>
            <option value="delay">延迟执行一次</option>
          </select>
        </label>
        {mode === "cron" ? (
          <label className="grid gap-1.5 text-xs font-semibold text-[#555]">
            Cron 表达式
            <input
              className={`${inputClass} font-mono`}
              value={cron}
              onChange={(event) => setCron(event.target.value)}
              required
              aria-describedby="schedule-help"
            />
          </label>
        ) : (
          <label className="grid gap-1.5 text-xs font-semibold text-[#555]">
            延迟分钟数
            <input
              className={inputClass}
              type="number"
              min="0"
              max="35791"
              step="1"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              required
              aria-describedby="schedule-help"
            />
          </label>
        )}
      </div>
      <p id="schedule-help" className="m-0 text-xs leading-5 text-[#777]">
        {mode === "cron"
          ? "0 9 * * * 表示每天 09:00，按服务所在时区执行。"
          : "从创建时开始倒计时，最多约 24.8 天；执行一次后自动停用。"}
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={onBack}
          disabled={busy}
        >
          返回列表
        </button>
        <button
          type="submit"
          className={`${buttonClass} border-primary! bg-primary! text-white! hover:opacity-90`}
          disabled={busy}
        >
          {busy ? "正在创建…" : "创建任务"}
        </button>
      </div>
    </form>
  );
}

function ExecutionHistory({
  task,
  api,
  revision,
}: {
  task: ScheduledTask;
  api: ReturnType<typeof schedulerApi>;
  revision: number;
}) {
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setError("");
    setExecutions([]);
    const load = async () => {
      try {
        const history = await api.history(task.id, controller.signal);
        if (!controller.signal.aborted) {
          setExecutions(history.executions);
          timer = setTimeout(() => void load(), 2000);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(messageOf(failure));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [task.id, api, revision]);
  return (
    <section
      aria-label={`${task.name} 执行历史`}
      className="mt-5 border-t border-[#eee] pt-4"
    >
      <h3 className="m-0 mb-3 text-sm font-semibold">{task.name} · 执行历史</h3>
      {loading && (
        <p role="status" className="text-xs text-[#777]">
          正在读取执行记录…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-[#b42318]">
          {error}
        </p>
      )}
      {!loading && !error && executions.length === 0 && (
        <p className="text-xs text-[#777]">暂无执行记录。</p>
      )}
      <ul className="m-0 grid list-none gap-2 p-0">
        {executions.map((execution) => (
          <li
            key={execution.id}
            className="rounded-lg border border-[#eee] p-3 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <strong
                className={
                  execution.status === "succeeded"
                    ? "text-primary"
                    : execution.status === "running"
                      ? "text-[#555]"
                      : "text-[#b42318]"
                }
              >
                {statusLabels[execution.status]}
              </strong>
              <span className="text-[#777]">
                {formatDate(execution.startedAt)}
              </span>
              {execution.duration !== null && (
                <span className="text-[#777]">{execution.duration} ms</span>
              )}
              {execution.retryAttempt > 0 && (
                <span className="text-[#777]">
                  第 {execution.retryAttempt} 次重试
                </span>
              )}
            </div>
            {execution.error && (
              <p className="mb-0 whitespace-pre-wrap break-words text-[#b42318]">
                {execution.error}
              </p>
            )}
            {execution.result !== null && execution.result !== undefined && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[#777]">
                  执行结果
                </summary>
                <pre className="mb-0 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-[#fafafa] p-2">
                  {JSON.stringify(execution.result, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SchedulerDialog({
  getServerInfo,
  onClose,
}: {
  getServerInfo: () => Promise<ServerInfo>;
  onClose: () => void;
}) {
  const api = useMemo(() => schedulerApi(getServerInfo), [getServerInfo]);
  const [list, setList] = useState<ScheduledTaskList | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = list?.tasks.find((task) => task.id === selectedId);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api
      .list(page, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          if (next.tasks.length === 0 && page > 1) setPage(page - 1);
          else setList(next);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(messageOf(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, page, revision]);
  const act = async (operation: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await operation();
      setStatus(success);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100svh-32px)] w-[calc(100%_-_2rem)] flex-col overflow-hidden rounded-[14px] border-[#e4e4e4] bg-white p-5 sm:max-w-[850px] sm:p-7">
        <DialogHeader className="pr-6">
          <DialogTitle className="flex items-center gap-2">
            <CalendarClockIcon
              className="size-5 text-primary"
              aria-hidden="true"
            />
            定时任务
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 text-[#777]">
            安排助手在指定时间执行任务，或管理已有计划。
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-xs text-[#b42318]"
            >
              {error}
            </p>
          )}
          {status && (
            <p
              role="status"
              className="rounded-lg bg-[#e8f3ef] p-3 text-xs text-[#087d61]"
            >
              {status}
            </p>
          )}
          {formOpen ? (
            <CreateTaskForm
              busy={busy}
              onBack={() => setFormOpen(false)}
              onCreate={(name, schedule, message) =>
                void act(async () => {
                  await api.create(name, schedule, message);
                  setFormOpen(false);
                  setPage(1);
                }, "任务已创建。")
              }
            />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[#777]">
                  {list ? `共 ${list.total} 个任务` : "任务列表"}
                </span>
                <div className="flex gap-2">
                  <button
                    className={buttonClass}
                    type="button"
                    disabled={busy || loading}
                    onClick={() => {
                      setError("");
                      setRevision((value) => value + 1);
                    }}
                    aria-label="刷新定时任务"
                  >
                    <RefreshCwIcon className="size-3.5" />
                  </button>
                  <button
                    className={`${buttonClass} flex items-center gap-1.5 border-primary! bg-primary! text-white!`}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setStatus("");
                      setFormOpen(true);
                    }}
                  >
                    <PlusIcon className="size-3.5" aria-hidden="true" />
                    新建任务
                  </button>
                </div>
              </div>
              {loading && (
                <p
                  className="py-6 text-center text-xs text-[#777]"
                  role="status"
                >
                  正在读取任务…
                </p>
              )}
              {!loading && list?.tasks.length === 0 && (
                <div className="rounded-xl border border-dashed border-[#ddd] py-10 text-center">
                  <CalendarClockIcon
                    className="mx-auto mb-3 size-7 text-[#aaa]"
                    aria-hidden="true"
                  />
                  <p className="m-0 text-sm text-[#555]">暂无定时任务</p>
                  <p className="mb-0 text-xs text-[#888]">
                    新建一个任务，让助手按计划执行。
                  </p>
                </div>
              )}
              {!loading && (
                <ul className="m-0 grid list-none gap-3 p-0">
                  {list?.tasks.map((task) => (
                    <li
                      key={task.id}
                      className="rounded-xl border border-[#e8e8e8] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="m-0 truncate text-sm font-semibold text-[#333]">
                            {task.name}
                          </h3>
                          <p className="mb-0 mt-1 break-all text-xs text-[#777]">
                            {typeLabels[task.type]} ·{" "}
                            {task.schedule.startsWith("delay:")
                              ? task.runAt
                                ? `预定 ${formatDate(task.runAt)}`
                                : task.enabled
                                  ? "一次性任务已开始"
                                  : "一次性任务已结束"
                              : task.schedule}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${task.enabled ? "bg-[#e8f3ef] text-[#087d61]" : "bg-[#f2f2f2] text-[#777]"}`}
                        >
                          {task.enabled ? "已启用" : "已停用"}
                        </span>
                      </div>
                      <p className="my-2 text-xs text-[#888]">
                        上次执行：{formatDate(task.lastExecutedAt)}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={buttonClass}
                          type="button"
                          disabled={
                            busy ||
                            (!task.enabled &&
                              task.schedule.startsWith("delay:") &&
                              !task.runAt)
                          }
                          onClick={() =>
                            void act(
                              () => api.toggle(task),
                              task.enabled ? "任务已停用。" : "任务已启用。",
                            )
                          }
                        >
                          {task.enabled ? "停用" : "启用"}
                        </button>
                        <button
                          className={buttonClass}
                          type="button"
                          disabled={busy || !task.enabled}
                          onClick={() =>
                            void act(async () => {
                              await api.trigger(task.id);
                              setSelectedId(task.id);
                            }, "已受理执行，可在执行历史中查看结果。")
                          }
                        >
                          立即执行
                        </button>
                        <button
                          className={buttonClass}
                          type="button"
                          aria-expanded={selectedId === task.id}
                          onClick={() =>
                            setSelectedId(
                              selectedId === task.id ? null : task.id,
                            )
                          }
                        >
                          执行历史
                        </button>
                        <button
                          className={`${buttonClass} ml-auto text-[#b42318]!`}
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `删除定时任务“${task.name}”及其执行记录？`,
                              )
                            )
                              void act(
                                () => api.remove(task.id),
                                "任务已删除。",
                              );
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {list && list.total > list.limit && (
                <div className="mt-4 flex items-center justify-end gap-3 text-xs text-[#777]">
                  <button
                    className={buttonClass}
                    type="button"
                    disabled={page === 1 || loading || busy}
                    onClick={() => setPage(page - 1)}
                  >
                    上一页
                  </button>
                  <span>第 {page} 页</span>
                  <button
                    className={buttonClass}
                    type="button"
                    disabled={
                      page * list.limit >= list.total || loading || busy
                    }
                    onClick={() => setPage(page + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
              {selected && (
                <ExecutionHistory
                  key={selected.id}
                  task={selected}
                  api={api}
                  revision={revision}
                />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
