import { describe, expect, it } from "vitest";
import {
  applyRunEvent,
  mergeMessageSnapshots,
  messageFromDto,
  type ChatMessage,
} from "../src/index";

describe("chat domain", () => {
  it("maps server messages without losing sequence, watermark, tools or unknown parts", () => {
    const result = messageFromDto({
      id: "r:assistant",
      role: "assistant",
      seq: 4,
      runId: "r",
      appliedEventId: 7,
      status: "failed",
      error: { message: "403 model access denied" },
      createdAt: "2026-01-01T00:00:00Z",
      content: {
        schemaVersion: 1,
        parts: [
          { type: "reasoning", text: "thought" },
          {
            type: "tool-call",
            toolCallId: "t",
            toolName: "read",
            args: { nested: { n: 1 } },
            argsText: "{}",
            result: { output: "ok" },
            isError: true,
          },
          { type: "future", value: 1 },
        ],
      },
    });
    expect(result).toMatchObject({
      seq: 4,
      runId: "r",
      appliedEventId: 7,
      status: { type: "incomplete", reason: "error" },
    });
    expect(result.content[1]).toMatchObject({
      type: "tool-call",
      args: { nested: { n: 1 } },
      result: { output: "ok" },
      isError: true,
    });
    expect(result.content[2]).toEqual({
      type: "unknown",
      value: { type: "future", value: 1 },
    });
  });
  it("deduplicates events and preserves live output against a stale snapshot", () => {
    const snapshot: ChatMessage = {
      id: "r:assistant",
      role: "assistant",
      content: [],
      appliedEventId: 1,
    };
    const event = {
      id: 2,
      type: "assistant.delta",
      payload: { delta: "你好" },
    };
    const live = applyRunEvent([snapshot], "r", event);
    expect(applyRunEvent(live, "r", event)).toBe(live);
    expect(mergeMessageSnapshots(live, [snapshot])).toEqual(live);
    expect(live[0].content).toEqual([{ type: "text", text: "你好" }]);
  });
});
