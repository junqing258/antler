import { afterEach, expect, it, vi } from "vitest";
import type { ThreadMessageLike } from "@assistant-ui/react";
import {
  applyRunEvent,
  mergeMessageSnapshots,
  subscribeRunEvents,
} from "../../src/lib/run-events";
vi.mock("@/lib/server-info", () => ({
  authHeaders: () => ({ "x-antler-token": "test" }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const frame = (id: number, type: string, payload: unknown) =>
  `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
const snapshot: ThreadMessageLike = {
  id: "run:assistant",
  role: "assistant",
  content: [],
  status: { type: "running" },
  metadata: { custom: { runId: "run", appliedEventId: 1 } },
};

it("projects live text, reasoning, tools and failures and ignores replay duplicates", () => {
  let messages = [snapshot];
  const events = [
    { id: 2, type: "assistant.thinking.delta", payload: { delta: "think" } },
    { id: 3, type: "assistant.delta", payload: { delta: "hello" } },
    { id: 4, type: "assistant.delta", payload: { delta: " world" } },
    {
      id: 5,
      type: "step.started",
      payload: {
        kind: "tool",
        stepId: "tool",
        tool: "read",
        args: { path: "a" },
      },
    },
    {
      id: 6,
      type: "tool.completed",
      payload: { stepId: "tool", result: { text: "done" } },
    },
    {
      id: 7,
      type: "run.failed",
      payload: { error: { message: "403 Access to model denied" } },
    },
  ];
  for (const event of events) messages = applyRunEvent(messages, "run", event);
  expect(messages[0].content).toMatchObject([
    { type: "reasoning", text: "think" },
    { type: "text", text: "hello world" },
    { type: "tool-call", toolName: "read", result: { text: "done" } },
  ]);
  expect(messages[0].status).toMatchObject({
    type: "incomplete",
    reason: "error",
    error: expect.stringContaining("403"),
  });
  expect(applyRunEvent(messages, "run", events[1])).toBe(messages);
});

it("does not let delayed disk snapshots erase live output or earlier pages", () => {
  const earlier: ThreadMessageLike = {
    id: "earlier",
    role: "user",
    content: "old",
  };
  const live = applyRunEvent([snapshot], "run", {
    id: 2,
    type: "assistant.delta",
    payload: { delta: "live" },
  })[0];
  expect(mergeMessageSnapshots([earlier, live], [snapshot])).toEqual([
    earlier,
    live,
  ]);
  expect(mergeMessageSnapshots([live], [])).toEqual([live]);
  const saved = {
    ...live,
    metadata: { custom: { runId: "run", appliedEventId: 2 } },
  };
  expect(mergeMessageSnapshots([live], [saved])).toEqual([saved]);
});

it("reconnects with the replay cursor, decodes split UTF-8 and stops on completion", async () => {
  vi.useFakeTimers();
  const encoder = new TextEncoder();
  const response = (text: string) =>
    new Response(
      new ReadableStream({
        start(controller) {
          const bytes = encoder.encode(text);
          for (let i = 0; i < bytes.length; i += 3)
            controller.enqueue(bytes.slice(i, i + 3));
          controller.close();
        },
      }),
    );
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response(frame(1, "assistant.delta", { delta: "你" })),
    )
    .mockResolvedValueOnce(
      response(
        frame(1, "assistant.delta", { delta: "你" }) +
          frame(2, "assistant.delta", { delta: "好" }) +
          frame(3, "run.completed", {}),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const event = vi.fn();
  const stop = subscribeRunEvents(
    async () => ({ baseUrl: "http://backend", token: "test" }),
    "run",
    event,
    vi.fn(),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(event.mock.calls.map(([value]) => value.id)).toEqual([1]);
  await vi.advanceTimersByTimeAsync(500);
  expect(event.mock.calls.map(([value]) => value.id)).toEqual([1, 2, 3]);
  expect(event.mock.calls[1][0].payload.delta).toBe("好");
  expect(fetcher.mock.calls[1][0]).toContain("afterEventId=1");
  expect(fetcher.mock.calls[0][1].headers).toEqual({
    "x-antler-token": "test",
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  stop();
});
