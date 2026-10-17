import { authHeaders, type ServerInfo } from "@/lib/server-info";

export type ScheduledTask = {
  id: string;
  name: string;
  type: "http" | "service" | "script";
  schedule: string;
  enabled: boolean;
  runAt: string | null;
  lastExecutedAt: string | null;
};
export type TaskExecution = {
  id: string;
  status: "running" | "succeeded" | "failed" | "timeout";
  startedAt: string;
  duration: number | null;
  error: string | null;
  result: unknown;
  retryAttempt: number;
};
export type ScheduledTaskList = {
  tasks: ScheduledTask[];
  total: number;
  page: number;
  limit: number;
};

export function schedulerApi(getServerInfo: () => Promise<ServerInfo>) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const server = await getServerInfo();
    init.signal?.throwIfAborted();
    const response = await fetch(`${server.baseUrl}/api/${path}`, {
      ...init,
      headers: {
        ...authHeaders(server),
        ...(init.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
    });
    if (!response.ok) {
      let message = `请求失败（${response.status}）`;
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === "string") message = body.error;
      } catch {
        /* Keep the HTTP status when the server returns non-JSON. */
      }
      throw new Error(message);
    }
    return response.status === 204
      ? (undefined as T)
      : (response.json() as Promise<T>);
  }
  const taskPath = (id: string) => `scheduled-tasks/${encodeURIComponent(id)}`;
  return {
    list: (page: number, signal?: AbortSignal) =>
      request<ScheduledTaskList>(`scheduled-tasks?page=${page}&limit=20`, {
        signal,
      }),
    create: (name: string, schedule: string, message: string) =>
      request<ScheduledTask>("scheduled-tasks", {
        method: "POST",
        body: JSON.stringify({
          name,
          schedule,
          type: "service",
          payload: {
            service: "taskService",
            method: "create",
            args: [message],
          },
        }),
      }),
    toggle: (task: ScheduledTask) =>
      request<ScheduledTask>(
        `${taskPath(task.id)}/${task.enabled ? "disable" : "enable"}`,
        { method: "POST" },
      ),
    trigger: (id: string) =>
      request<{ executionId: string; status: string }>(
        `${taskPath(id)}/trigger`,
        { method: "POST" },
      ),
    remove: (id: string) => request<void>(taskPath(id), { method: "DELETE" }),
    history: (id: string, signal?: AbortSignal) =>
      request<{ executions: TaskExecution[] }>(
        `${taskPath(id)}/executions?limit=20`,
        { signal },
      ),
  };
}
