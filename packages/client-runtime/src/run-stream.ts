import { isTerminalEvent, SseParser, type RunEvent } from "@antler/chat-core";
import type { StreamPlatform } from "@antler/platform";

/** A subscription has its own run cursor; disposing it never cancels the server run. */
export function subscribeRunStream(
  platform: StreamPlatform,
  runId: string,
  onEvent: (event: RunEvent) => void,
  onConnection: (connected: boolean) => void,
): () => void {
  const controller = platform.abortController();
  let cursor = 0;
  let attempt = 0;
  let cancelTimer: (() => void) | undefined;
  const connect = async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const server = await platform.connection();
      if (controller.signal.aborted) return;
      const response = await platform.request(
        `${server.baseUrl}/api/runs/${encodeURIComponent(runId)}/events?afterEventId=${cursor}`,
        { headers: server.headers, signal: controller.signal },
      );
      if (controller.signal.aborted) {
        await response.body?.cancel().catch(() => {});
        return;
      }
      if (!response.ok || !response.body)
        throw new Error("run_stream_unavailable");
      onConnection(true);
      attempt = 0;
      reader = response.body.getReader();
      const decoder = platform.decoder();
      const parser = new SseParser();
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) throw new Error("run_stream_disconnected");
        for (const frame of parser.push(
          decoder.decode(value, { stream: true }),
        )) {
          const id = Number(frame.id);
          if (
            !frame.id ||
            !Number.isSafeInteger(id) ||
            id <= cursor ||
            !frame.event ||
            !frame.data
          )
            continue;
          const event: RunEvent = {
            id,
            type: frame.event.trim(),
            payload: JSON.parse(frame.data),
          };
          if (controller.signal.aborted) return;
          onEvent(event);
          cursor = id;
          if (isTerminalEvent(event)) return;
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        onConnection(false);
        cancelTimer = platform.schedule(
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
    cancelTimer?.();
  };
}
