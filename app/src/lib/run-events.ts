import type { ThreadMessageLike } from "@assistant-ui/react";
import { authHeaders, type ServerInfo } from "./server-info";

export type RunEvent = {
  id: number;
  type: string;
  payload: Record<string, unknown>;
};
const terminal = new Set(["run.completed", "run.failed", "run.cancelled"]);
export const isTerminalEvent = (event: RunEvent) => terminal.has(event.type);
export function runErrorMessage(message?: string) {
  if (
    message &&
    /403/.test(message) &&
    /model|access|permission/i.test(message)
  )
    return "当前模型没有访问权限（403），请检查 API Key 或在新会话中选择已授权的模型。";
  return message || "运行已中断或失败，请重试。";
}
export const eventWatermark = (message: ThreadMessageLike) =>
  Number(message.metadata?.custom?.appliedEventId ?? 0);

/** Apply replay/live events once, independently of the disk flush watermark. */
export function applyRunEvent(
  messages: ThreadMessageLike[],
  runId: string,
  event: RunEvent,
): ThreadMessageLike[] {
  const id = `${runId}:assistant`;
  const current = messages.find((message) => message.id === id);
  if (current && event.id <= eventWatermark(current)) return messages;
  const message: ThreadMessageLike = current ?? {
    id,
    role: "assistant",
    content: [],
    createdAt: new Date(),
  };
  const parts =
    typeof message.content === "string"
      ? [{ type: "text" as const, text: message.content }]
      : [...message.content];
  const payload = event.payload;
  if (
    event.type === "assistant.delta" ||
    event.type === "assistant.thinking.delta"
  ) {
    const type = event.type === "assistant.delta" ? "text" : "reasoning";
    const last = parts.at(-1);
    if (last?.type === type)
      parts[parts.length - 1] = {
        ...last,
        text: last.text + String(payload.delta ?? ""),
      };
    else parts.push({ type, text: String(payload.delta ?? "") });
  } else if (event.type === "step.started" && payload.kind === "tool") {
    parts.push({
      type: "tool-call",
      toolCallId: String(payload.stepId),
      toolName: String(payload.tool),
      args: (payload.args ?? {}) as Record<string, string>,
      argsText: JSON.stringify(payload.args ?? {}),
    });
  } else if (event.type === "tool.completed") {
    const index = parts.findIndex(
      (part) => part.type === "tool-call" && part.toolCallId === payload.stepId,
    );
    const part = parts[index];
    if (part?.type === "tool-call")
      parts[index] = {
        ...part,
        result: payload.result ?? { summary: payload.summary },
        isError: Boolean(payload.isError),
      };
  }
  const status: ThreadMessageLike["status"] =
    event.type === "run.completed"
      ? { type: "complete", reason: "stop" }
      : event.type === "run.failed"
        ? {
            type: "incomplete",
            reason: "error",
            error: runErrorMessage(
              (payload.error as { message?: string } | undefined)?.message,
            ),
          }
        : event.type === "run.cancelled"
          ? { type: "incomplete", reason: "cancelled" }
          : { type: "running" };
  const next: ThreadMessageLike = {
    ...message,
    content: parts,
    status,
    metadata: {
      ...message.metadata,
      custom: {
        ...message.metadata?.custom,
        runId,
        appliedEventId: event.id,
        live: true,
      },
    },
  };
  return current
    ? messages.map((item) => (item.id === id ? next : item))
    : [...messages, next];
}

/** A delayed history snapshot must not erase output already shown live. */
export function mergeMessageSnapshots(
  current: ThreadMessageLike[],
  incoming: ThreadMessageLike[],
) {
  const previous = new Map(current.map((message) => [message.id, message]));
  const ids = new Set(incoming.map((message) => message.id));
  const overlap = current.findIndex((message) => ids.has(message.id));
  const prefix = overlap < 0 ? [] : current.slice(0, overlap);
  const merged = incoming.map((message) => {
    const live = previous.get(message.id);
    return live && eventWatermark(live) > eventWatermark(message)
      ? live
      : message;
  });
  const included = new Set([...prefix, ...merged].map((message) => message.id));
  return [
    ...prefix,
    ...merged,
    ...current.filter(
      (message) => message.metadata?.custom?.live && !included.has(message.id),
    ),
  ];
}

/** Authenticated SSE with cursor replay; disconnecting the view never cancels the run. */
export function subscribeRunEvents(
  getServerInfo: () => Promise<ServerInfo>,
  runId: string,
  onEvent: (event: RunEvent) => void,
  onConnection: (connected: boolean) => void,
) {
  const controller = new AbortController();
  let cursor = 0;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout>;
  const connect = async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const server = await getServerInfo();
      if (controller.signal.aborted) return;
      const response = await fetch(
        `${server.baseUrl}/api/runs/${encodeURIComponent(runId)}/events?afterEventId=${cursor}`,
        { headers: authHeaders(server), signal: controller.signal },
      );
      if (!response.ok || !response.body)
        throw new Error("run_stream_unavailable");
      onConnection(true);
      attempt = 0;
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) throw new Error("run_stream_disconnected");
        buffer += decoder.decode(value, { stream: true });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const block = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          const id = Number(block.match(/^id:\s*(\d+)/m)?.[1]);
          const type = block.match(/^event:\s*(.+)/m)?.[1]?.trim();
          const data = [...block.matchAll(/^data:\s?(.*)$/gm)]
            .map((match) => match[1])
            .join("\n");
          if (!Number.isSafeInteger(id) || id <= cursor || !type || !data)
            continue;
          const event: RunEvent = { id, type, payload: JSON.parse(data) };
          if (controller.signal.aborted) return;
          onEvent(event);
          cursor = id;
          if (isTerminalEvent(event)) return;
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        onConnection(false);
        timer = setTimeout(
          () => void connect(),
          Math.min(500 * 2 ** attempt++, 15_000),
        );
      }
    } finally {
      await reader?.cancel().catch(() => {});
    }
  };
  void connect();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
