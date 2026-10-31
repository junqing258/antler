export {
  matchSlashCommands,
  slashCommandQuery,
  slashCommands,
} from "./commands";
export type { SlashCommand } from "./commands";

export type MessagePart =
  | { type: "text" | "reasoning"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      argsText: string;
      result?: unknown;
      isError?: boolean;
    }
  | { type: "unknown"; value: unknown };

export type MessageStatus =
  | { type: "running" }
  | { type: "complete"; reason: "stop" }
  | { type: "incomplete"; reason: "cancelled" }
  | { type: "incomplete"; reason: "error"; error: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: MessagePart[];
  createdAt?: Date;
  status?: MessageStatus;
  runId?: string | null;
  seq?: number;
  appliedEventId?: number;
  live?: boolean;
};

export type ConversationSnapshot = {
  messages: ChatMessage[];
  revision: number;
  activeRunId: string | null;
  hasMore: boolean;
};

export type MessageDto = {
  id: string;
  role: "user" | "assistant";
  seq: number;
  runId: string | null;
  appliedEventId: number;
  error?: { code?: string; message: string };
  content: { schemaVersion: number; parts: unknown[] };
  status: string;
  createdAt: string;
};

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

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function messagePart(value: unknown): MessagePart {
  const part = record(value);
  if (
    (part?.type === "text" || part?.type === "reasoning") &&
    typeof part.text === "string"
  )
    return { type: part.type, text: part.text };
  if (
    part?.type === "tool-call" &&
    typeof part.toolCallId === "string" &&
    typeof part.toolName === "string"
  ) {
    const args = record(part.args) ?? {};
    return {
      type: "tool-call",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      args,
      argsText:
        typeof part.argsText === "string"
          ? part.argsText
          : JSON.stringify(args),
      ...(Object.hasOwn(part, "result") ? { result: part.result } : {}),
      ...(typeof part.isError === "boolean" ? { isError: part.isError } : {}),
    };
  }
  return { type: "unknown", value };
}

export function messageFromDto(message: MessageDto): ChatMessage {
  if (message.content.schemaVersion !== 1)
    throw new Error("消息格式版本不受支持");
  const status: MessageStatus | undefined =
    message.role !== "assistant"
      ? undefined
      : message.status === "running" || message.status === "queued"
        ? { type: "running" }
        : message.status === "failed"
          ? {
              type: "incomplete",
              reason: "error",
              error: runErrorMessage(message.error?.message),
            }
          : message.status === "cancelled"
            ? { type: "incomplete", reason: "cancelled" }
            : { type: "complete", reason: "stop" };
  return {
    id: message.id,
    role: message.role,
    content: message.content.parts.map(messagePart),
    createdAt: new Date(message.createdAt),
    seq: message.seq,
    runId: message.runId,
    appliedEventId: message.appliedEventId,
    ...(status ? { status } : {}),
  };
}

export const eventWatermark = (message: ChatMessage) =>
  message.appliedEventId ?? 0;

export function applyRunEvent(
  messages: ChatMessage[],
  runId: string,
  event: RunEvent,
): ChatMessage[] {
  const id = `${runId}:assistant`;
  const current = messages.find((message) => message.id === id);
  if (current && event.id <= eventWatermark(current)) return messages;
  const message: ChatMessage = current ?? {
    id,
    role: "assistant",
    content: [],
    createdAt: new Date(),
  };
  const parts = [...message.content];
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
    const args = record(payload.args) ?? {};
    parts.push({
      type: "tool-call",
      toolCallId: String(payload.stepId),
      toolName: String(payload.tool),
      args,
      argsText: JSON.stringify(args),
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
  const error = record(payload.error);
  const status: MessageStatus =
    event.type === "run.completed"
      ? { type: "complete", reason: "stop" }
      : event.type === "run.failed"
        ? {
            type: "incomplete",
            reason: "error",
            error: runErrorMessage(
              typeof error?.message === "string" ? error.message : undefined,
            ),
          }
        : event.type === "run.cancelled"
          ? { type: "incomplete", reason: "cancelled" }
          : { type: "running" };
  const next: ChatMessage = {
    ...message,
    content: parts,
    status,
    runId,
    appliedEventId: event.id,
    live: true,
  };
  return current
    ? messages.map((item) => (item.id === id ? next : item))
    : [...messages, next];
}

export function mergeMessageSnapshots(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
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
    ...current.filter((message) => message.live && !included.has(message.id)),
  ];
}

export { SseParser } from "./sse";
export type { SseFrame } from "./sse";
