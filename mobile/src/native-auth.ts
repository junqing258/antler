import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

export type AuthBackendConfig = {
  mode: "local" | "supabase";
  url?: string;
  publishableKey?: string;
};

/** 后端 /api/auth-config 公开返回认证模式；与 Web 宿主 loadAuthConfig 语义一致。 */
export async function loadAuthBackendConfig(
  baseUrl: string,
): Promise<AuthBackendConfig> {
  let data: unknown;
  try {
    const response = await fetch(`${baseUrl}/api/auth-config`);
    if (!response.ok) return { mode: "local" };
    data = await response.json();
  } catch {
    // 后端不可达时按 local 模式降级，与 Web 宿主行为一致。
    return { mode: "local" };
  }
  const config = data as {
    mode?: unknown;
    url?: unknown;
    publishableKey?: unknown;
  };
  if (
    config.mode === "supabase" &&
    typeof config.url === "string" &&
    typeof config.publishableKey === "string"
  )
    return {
      mode: "supabase",
      url: config.url,
      publishableKey: config.publishableKey,
    };
  return { mode: "local" };
}

let client: SupabaseClient | undefined;
let clientKey = "";

function ensureClient(
  url: string,
  publishableKey: string,
): SupabaseClient {
  const key = `${url}|${publishableKey}`;
  if (!client || clientKey !== key) {
    client = createClient(url, publishableKey, {
      auth: {
        storage: AsyncStorage,
        storageKey: "antler.native.supabase.auth",
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    clientKey = key;
  }
  return client;
}

export async function signIn(
  url: string,
  publishableKey: string,
  email: string,
  password: string,
): Promise<void> {
  const supabase = ensureClient(url, publishableKey);
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error)
    throw new Error(
      error.message === "Invalid login credentials"
        ? "邮箱或密码不正确。"
        : error.message,
    );
}

export async function signOut(
  url: string,
  publishableKey: string,
): Promise<void> {
  await ensureClient(url, publishableKey).auth.signOut();
}

/** 读取持久会话的访问令牌；autoRefreshToken 在应用运行期间保持会话新鲜。 */
export async function currentAccessToken(
  url: string,
  publishableKey: string,
): Promise<string> {
  const { data } = await ensureClient(url, publishableKey).auth.getSession();
  return data.session?.access_token ?? "";
}
