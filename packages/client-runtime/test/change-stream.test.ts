import { expect, it, vi } from "vitest";
import type { StreamPlatform } from "@antler/platform";
import { subscribeChangeStream } from "../src";

it("reconnects with its own change cursor and resynchronizes after a 409", async () => {
  const frame = (changeId: number) =>
    `id: ${changeId}\r\nevent: conversation.changed\r\ndata: ${JSON.stringify({ changeId, conversationId: "thread", type: "updated", revision: changeId })}\r\n\r\n`;
  const body = (text: string) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const bytes = new TextEncoder().encode(text);
          for (let i = 0; i < bytes.length; i += 3)
            controller.enqueue(bytes.slice(i, i + 3));
          controller.close();
        },
      }),
    );
  const request = vi
    .fn()
    .mockResolvedValueOnce(body(frame(4) + frame(4)))
    .mockResolvedValueOnce(new Response("", { status: 409 }))
    .mockResolvedValueOnce(body(frame(10)));
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  let token = "first";
  const platform: StreamPlatform = {
    connection: async () => ({
      baseUrl: "https://backend",
      headers: { authorization: `Bearer ${token}` },
    }),
    request,
    abortController: () => new AbortController(),
    decoder: () => new TextDecoder(),
    schedule: (callback, delay) => {
      const item = { callback, delay };
      scheduled.push(item);
      return () => {
        const i = scheduled.indexOf(item);
        if (i >= 0) scheduled.splice(i, 1);
      };
    },
  };
  const onChange = vi.fn();
  const reset = vi.fn().mockResolvedValue(9);
  const stop = subscribeChangeStream(platform, 3, reset, onChange);
  await vi.waitFor(() => expect(scheduled).toHaveLength(1));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(scheduled[0].delay).toBe(1000);
  token = "refreshed";
  scheduled.shift()!.callback();
  await vi.waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(scheduled).toHaveLength(1));
  expect(scheduled[0].delay).toBe(0);
  scheduled.shift()!.callback();
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(3));
  expect(onChange.mock.calls.map(([change]) => change.type)).toEqual([
    "updated",
    "reset_required",
    "updated",
  ]);
  expect(request.mock.calls[1][0]).toContain("afterChangeId=4");
  expect(request.mock.calls[2][0]).toContain("afterChangeId=9");
  expect(request.mock.calls[2][1].headers).toEqual({
    authorization: "Bearer refreshed",
  });
  stop();
});

it("drops a delayed reset after the change stream is disposed", async () => {
  let release!: (cursor: number) => void;
  const reset = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        release = resolve;
      }),
  );
  const platform: StreamPlatform = {
    connection: async () => ({ baseUrl: "", headers: {} }),
    request: async () => new Response("", { status: 409 }),
    abortController: () => new AbortController(),
    decoder: () => new TextDecoder(),
    schedule: vi.fn(() => () => {}),
  };
  const onChange = vi.fn();
  const stop = subscribeChangeStream(platform, 0, reset, onChange);
  await vi.waitFor(() => expect(reset).toHaveBeenCalled());
  stop();
  release(10);
  await Promise.resolve();
  expect(onChange).not.toHaveBeenCalled();
  expect(platform.schedule).not.toHaveBeenCalled();
});
