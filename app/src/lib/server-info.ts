import { invoke } from "@tauri-apps/api/core";

export type ServerInfo = { baseUrl: string; token: string };

export async function serverInfo(): Promise<ServerInfo> {
  if ("__TAURI_INTERNALS__" in window) return invoke<ServerInfo>("server_info");
  return {
    // Development keeps talking to the locally started backend. A production
    // Web build uses the current origin because Fastify serves both UI and API.
    baseUrl:
      import.meta.env.VITE_ANTLER_SERVER_BASE_URL ??
      (import.meta.env.DEV ? "http://127.0.0.1:3210" : ""),
    token: import.meta.env.VITE_ANTLER_ACCESS_TOKEN ?? "",
  };
}

