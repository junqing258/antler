import type { ClientPlatform } from "@antler/platform";
import { authHeaders, type ServerInfo } from "@/lib/server-info";
import { createUuid } from "@/lib/utils";

/** Host adapter; shared packages never import browser globals. */
export function createWebPlatform(
  getServerInfo: () => Promise<ServerInfo>,
): ClientPlatform {
  return {
    initialize: async () => {
      await getServerInfo();
    },
    connection: async () => {
      const server = await getServerInfo();
      return { baseUrl: server.baseUrl, headers: authHeaders(server) };
    },
    request: (url, init) => fetch(url, init),
    abortController: () => new AbortController(),
    decoder: () => new TextDecoder(),
    schedule: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
    createId: createUuid,
    onForeground: (callback) => {
      const listener = () => {
        if (document.visibilityState === "visible") callback();
      };
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}
