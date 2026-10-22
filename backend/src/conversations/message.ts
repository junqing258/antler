import type { RunEvent } from "../agent/events.js";

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
    };
export type MessageContent = { schemaVersion: 1; parts: MessagePart[] };

/** Pure display projection. The event cursor is committed together with this value. */
export function projectEvent(
  content: MessageContent,
  event: RunEvent,
): MessageContent {
  const parts = structuredClone(content.parts);
  const p = event.payload;
  if (
    event.type === "assistant.delta" ||
    event.type === "assistant.thinking.delta"
  ) {
    const type = event.type === "assistant.delta" ? "text" : "reasoning";
    const last = parts.at(-1);
    if (last?.type === type) last.text += String(p.delta ?? "");
    else parts.push({ type, text: String(p.delta ?? "") });
  } else if (event.type === "step.started" && p.kind === "tool") {
    parts.push({
      type: "tool-call",
      toolCallId: String(p.stepId),
      toolName: String(p.tool),
      args: (p.args ?? {}) as Record<string, unknown>,
      argsText: JSON.stringify(p.args ?? {}),
    });
  } else if (event.type === "tool.completed") {
    const part = parts.find(
      (part) => part.type === "tool-call" && part.toolCallId === p.stepId,
    );
    if (part?.type === "tool-call") {
      part.result = p.result ?? { summary: p.summary };
      part.isError = Boolean(p.isError);
    }
  }
  return { schemaVersion: 1, parts };
}
