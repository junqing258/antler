import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@supabase/supabase-js";

export type ServerInfo = { baseUrl: string; token: string };

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

/** 配置了 Supabase 时走浏览器端登录，API 头使用 Bearer 访问令牌。 */
export const supabaseAuthEnabled = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = supabaseAuthEnabled
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { autoRefreshToken: true, persistSession: true },
    })
  : undefined;

function localServerInfo(): ServerInfo {
  return {
    // Development keeps talking to the locally started backend. A production
    // Web build uses the current origin because Fastify serves both UI and API.
    baseUrl:
      import.meta.env.VITE_ANTLER_SERVER_BASE_URL ??
      (import.meta.env.DEV ? "http://127.0.0.1:3210" : ""),
    token: import.meta.env.VITE_ANTLER_ACCESS_TOKEN ?? "",
  };
}

export async function serverInfo(): Promise<ServerInfo> {
  if ("__TAURI_INTERNALS__" in window) return invoke<ServerInfo>("server_info");
  if (supabase) {
    const session = (await supabase.auth.getSession()).data.session;
    return { ...localServerInfo(), token: session?.access_token ?? "" };
  }
  return localServerInfo();
}

/** 按认证模式返回 API 鉴权头：Supabase 用 Bearer，本地伴生服务用共享令牌。 */
export function authHeaders(server: ServerInfo): Record<string, string> {
  return supabaseAuthEnabled
    ? { authorization: `Bearer ${server.token}` }
    : { "x-antler-token": server.token };
}
