import { subscribeRunStream } from "@antler/client-runtime";
import type { RunEvent } from "@antler/chat-core";
import { createWebPlatform } from "./platform/web-platform";
import type { ServerInfo } from "./server-info";

export {
  applyRunEvent,
  eventWatermark,
  isTerminalEvent,
  mergeMessageSnapshots,
  runErrorMessage,
} from "@antler/chat-core";
export type { RunEvent } from "@antler/chat-core";

export function subscribeRunEvents(
  getServerInfo: () => Promise<ServerInfo>,
  runId: string,
  onEvent: (event: RunEvent) => void,
  onConnection: (connected: boolean) => void,
) {
  return subscribeRunStream(
    createWebPlatform(getServerInfo),
    runId,
    onEvent,
    onConnection,
  );
}
