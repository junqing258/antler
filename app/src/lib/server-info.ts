import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ServerInfo = { baseUrl: string; token: string };
export type AuthMode = "local" | "supabase";

function localBaseUrl() {
  return (
    import.meta.env.VITE_ANTLER_SERVER_BASE_URL ??
    (import.meta.env.DEV ? "http://127.0.0.1:3210" : "")
  );
}

let authModeValue: AuthMode = "local";
let client: SupabaseClient | undefined;
let publicAuthConfig: { url: string; publishableKey: string } | undefined;
let loaded: Promise<void> | undefined;

/** 当前认证模式；仅在 loadAuthConfig 完成后可靠。 */
export function authMode(): AuthMode {
  return authModeValue;
}

export function supabaseClient(): SupabaseClient | undefined {
  return client;
}

/** 恢复密码使用独立内存会话，验证邮件后不会提前登录主应用。 */
export function createPasswordRecoveryClient(): SupabaseClient | undefined {
  if (!publicAuthConfig) return undefined;
  return createClient(publicAuthConfig.url, publicAuthConfig.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "antler-password-recovery",
    },
  });
}

/**
 * 从后端拉取认证配置并按需创建 Supabase 客户端。
 * 后端未就绪或 local 模式时保持无登录行为（本地开发场景）。
 */
export async function loadAuthConfig(): Promise<AuthMode> {
  if (!loaded) {
    loaded = (async () => {
      // 后端启动通常慢于前端（tsx 编译 + 数据库连接），重试避免误降级为无登录。
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const response = await fetch(`${localBaseUrl()}/api/auth-config`, {
            signal: AbortSignal.timeout(5_000),
          });
          if (!response.ok) return;
          const config = (await response.json()) as {
            mode?: unknown;
            url?: unknown;
            publishableKey?: unknown;
          };
          if (
            config.mode === "supabase" &&
            typeof config.url === "string" &&
            typeof config.publishableKey === "string"
          ) {
            authModeValue = "supabase";
            publicAuthConfig = { url: config.url, publishableKey: config.publishableKey };
            client = createClient(config.url, config.publishableKey, {
              auth: { autoRefreshToken: true, persistSession: true },
            });
          }
          return;
        } catch {
          if (attempt < 4) await new Promise((r) => setTimeout(r, 800));
        }
      }
    })();
  }
  await loaded;
  return authModeValue;
}

export async function serverInfo(): Promise<ServerInfo> {
  if (client) {
    const session = (await client.auth.getSession()).data.session;
    return { baseUrl: localBaseUrl(), token: session?.access_token ?? "" };
  }
  return {
    baseUrl: localBaseUrl(),
    token: import.meta.env.VITE_ANTLER_ACCESS_TOKEN ?? "",
  };
}

/** 按认证模式返回 API 鉴权头：Supabase 用 Bearer，local 模式用共享令牌。 */
export function authHeaders(server: ServerInfo): Record<string, string> {
  return authModeValue === "supabase"
    ? { authorization: `Bearer ${server.token}` }
    : { "x-antler-token": server.token };
}
