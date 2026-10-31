import { expect, it, vi } from "vitest";
import type { StreamPlatform } from "@antler/platform";
import { subscribeRunStream } from "../src";

it("refreshes authentication on reconnect and keeps the run cursor independent", async () => {
  let token = "first";
  let retry: (() => void) | undefined;
  const frame = (id: number, event: string, data: unknown) =>
    `id: ${id}\r\nevent: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
  const stream = (text: string) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const bytes = new TextEncoder().encode(text);
          for (let i = 0; i < bytes.length; i += 2)
            controller.enqueue(bytes.slice(i, i + 2));
          controller.close();
        },
      }),
    );
  const request = vi
    .fn()
    .mockResolvedValueOnce(stream(frame(1, "assistant.delta", { delta: "你" })))
    .mockResolvedValueOnce(
      stream(
        frame(1, "assistant.delta", { delta: "你" }) +
          frame(2, "run.completed", {}),
      ),
    );
  const platform: StreamPlatform = {
    connection: async () => ({
      baseUrl: "https://backend",
      headers: { authorization: `Bearer ${token}` },
    }),
    request,
    abortController: () => new AbortController(),
    decoder: () => new TextDecoder(),
    schedule: (callback) => {
      retry = callback;
      return () => {
        retry = undefined;
      };
    },
  };
  const onEvent = vi.fn();
  const stop = subscribeRunStream(platform, "run", onEvent, vi.fn());
  await vi.waitFor(() => expect(retry).toBeDefined());
  token = "second";
  retry!();
  await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2));
  expect(onEvent.mock.calls.map(([event]) => event.id)).toEqual([1, 2]);
  expect(onEvent.mock.calls[0][0].payload.delta).toBe("你");
  expect(request.mock.calls[1][0]).toContain("afterEventId=1");
  expect(request.mock.calls[1][1].headers).toEqual({
    authorization: "Bearer second",
  });
  stop();
});

it("does not publish a connection that resolves after disposal", async () => {
  let release!: (response: Response) => void;
  const cancel = vi.fn();
  const platform: StreamPlatform = {
    connection: async () => ({ baseUrl: "", headers: {} }),
    request: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    abortController: () => new AbortController(),
    decoder: () => new TextDecoder(),
    schedule: () => () => {},
  };
  const onConnection = vi.fn();
  const stop = subscribeRunStream(platform, "run", vi.fn(), onConnection);
  await vi.waitFor(() => expect(release).toBeDefined());
  stop();
  release(new Response(new ReadableStream({ cancel })));
  await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  expect(onConnection).not.toHaveBeenCalled();
});
