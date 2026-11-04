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
 * 仅明确的 local 配置免登录；读取失败由认证门显示错误并允许重试。
 */
export async function loadAuthConfig(): Promise<AuthMode> {
  if (!loaded) {
    loaded = (async () => {
      const response = await fetch(`${localBaseUrl()}/api/auth-config`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("无法读取认证配置，请检查服务连接。");
      const config = (await response.json().catch(() => {
        throw new Error("服务端认证配置无效。");
      })) as Record<string, unknown>;
      if (
        config &&
        config.mode === "local" &&
        typeof config.requiresAccessToken === "boolean"
      ) {
        authModeValue = "local";
        return;
      }
      if (
        config &&
        config.mode === "supabase" &&
        typeof config.url === "string" &&
        typeof config.publishableKey === "string" &&
        config.publishableKey.trim()
      ) {
        let url: URL;
        try {
          url = new URL(config.url);
        } catch {
          throw new Error("服务端认证配置无效。");
        }
        if (
          (url.protocol !== "https:" && url.protocol !== "http:") ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error("服务端认证配置无效。");
        authModeValue = "supabase";
        publicAuthConfig = {
          url: config.url,
          publishableKey: config.publishableKey,
        };
        client = createClient(config.url, config.publishableKey, {
          auth: { autoRefreshToken: true, persistSession: true },
        });
        return;
      }
      throw new Error(
        config?.mode === "local"
          ? "服务端版本过旧，请升级服务端。"
          : "服务端认证配置无效。",
      );
    })();
  }
  try {
    await loaded;
  } catch (error) {
    loaded = undefined;
    throw error;
  }
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
