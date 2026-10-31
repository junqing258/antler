import { SseParser } from "@antler/chat-core";
import type { StreamPlatform } from "@antler/platform";

export type ConversationChange = {
  conversationId: string;
  type: string;
  revision: number;
  changeId: number;
};

/** Independently reconnect the conversation change stream from its last consumed changeId. */
export function subscribeChangeStream(
  platform: StreamPlatform,
  initialCursor: number,
  resetCursor: () => Promise<number>,
  onChange: (
    change:
      | ConversationChange
      | { conversationId: ""; type: "reset_required"; revision: 0 },
  ) => void,
  onConnection?: (connected: boolean) => void,
): () => void {
  const controller = platform.abortController();
  let cursor = initialCursor;
  let attempt = 0;
  let cancelTimer: (() => void) | undefined;
  const connect = async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const server = await platform.connection();
      if (controller.signal.aborted) return;
      const response = await platform.request(
        `${server.baseUrl}/api/conversations/changes?afterChangeId=${cursor}`,
        { headers: server.headers, signal: controller.signal },
      );
      if (controller.signal.aborted) {
        await response.body?.cancel().catch(() => {});
        return;
      }
      if (response.status === 409) {
        cursor = await resetCursor();
        if (controller.signal.aborted) return;
        onChange({ conversationId: "", type: "reset_required", revision: 0 });
        cancelTimer = platform.schedule(() => void connect(), 0);
        return;
      }
      if (!response.ok || !response.body)
        throw new Error("change_stream_unavailable");
      onConnection?.(true);
      attempt = 0;
      reader = response.body.getReader();
      const decoder = platform.decoder();
      const parser = new SseParser();
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) throw new Error("change_stream_disconnected");
        for (const frame of parser.push(
          decoder.decode(value, { stream: true }),
        )) {
          const decoded: unknown = JSON.parse(frame.data);
          if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
            continue;
          const change = Object.fromEntries(Object.entries(decoded));
          if (controller.signal.aborted) return;
          if (
            !Number.isSafeInteger(change.changeId) ||
            typeof change.changeId !== "number" ||
            change.changeId <= cursor ||
            typeof change.conversationId !== "string" ||
            typeof change.type !== "string" ||
            typeof change.revision !== "number"
          )
            continue;
          onChange({
            conversationId: change.conversationId,
            type: change.type,
            revision: change.revision,
            changeId: change.changeId,
          });
          cursor = change.changeId;
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        onConnection?.(false);
        cancelTimer = platform.schedule(
          () => void connect(),
          Math.min(1000 * 2 ** attempt++, 15_000),
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
