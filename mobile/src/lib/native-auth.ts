import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AuthBackendConfig = {
  mode: "local" | "supabase";
  requiresAccessToken?: boolean;
  url?: string;
  publishableKey?: string;
};

export async function loadAuthBackendConfig(
  baseUrl: string,
): Promise<AuthBackendConfig> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let config: Record<string, unknown>;
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/auth-config`, {
        signal: controller.signal,
      });
    } catch {
      throw new Error("无法连接服务端，请检查网络后重试。");
    }
    if (!response.ok) throw new Error("无法读取认证配置，请检查连接后重试。");
    try {
      config = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new Error(
        controller.signal.aborted
          ? "无法连接服务端，请检查网络后重试。"
          : "服务端认证配置无效，请联系管理员。",
      );
    }
  } finally {
    clearTimeout(timeout);
  }
  if (config && config.mode === "local") {
    if (typeof config.requiresAccessToken !== "boolean")
      throw new Error("服务端版本过旧，请联系管理员升级服务端。");
    return { mode: "local", requiresAccessToken: config.requiresAccessToken };
  }
  if (
    config &&
    config.mode === "supabase" &&
    typeof config.url === "string" &&
    typeof config.publishableKey === "string" &&
    config.publishableKey.trim()
  ) {
    try {
      const url = new URL(config.url);
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
        return {
          mode: "supabase",
          url: url.toString().replace(/\/+$/, ""),
          publishableKey: config.publishableKey,
        };
    } catch {
      /* invalid configuration */
    }
  }
  throw new Error("服务端认证配置无效，请联系管理员。");
}

let client: SupabaseClient | undefined;
let clientKey = "";
let authGeneration = 0;
const clientSubscriptions = new Set<() => void>();
const legacyKey = "antler.native.supabase.auth";

/** Invalidate in-flight reads before stopping a previous project's client. */
export function disposeNativeAuth(): void {
  authGeneration++;
  for (const unsubscribe of clientSubscriptions) unsubscribe();
  clientSubscriptions.clear();
  const previous = client;
  client = undefined;
  clientKey = "";
  void previous?.auth.stopAutoRefresh();
  void previous?.auth.dispose();
}

function ensureClient(url: string, publishableKey: string): SupabaseClient {
  const project = new URL(url).toString().replace(/\/+$/, "");
  const key = JSON.stringify([project, publishableKey]);
  if (!client || clientKey !== key) {
    disposeNativeAuth();
    // Supabase's default storage key is host-derived; encode the complete project URL
    // so projects on the same host remain isolated.
    const storageKey = `antler.native.supabase.${encodeURIComponent(project)}`;
    const cleanLegacyAfterSession = async (
      name: string,
      value: string | null,
    ) => {
      if (name !== storageKey || !value) return;
      let session: unknown;
      try {
        session = JSON.parse(value);
      } catch {
        return;
      }
      if (
        !session ||
        typeof session !== "object" ||
        !("access_token" in session) ||
        typeof session.access_token !== "string" ||
        !session.access_token ||
        !("refresh_token" in session) ||
        typeof session.refresh_token !== "string" ||
        !session.refresh_token
      )
        return;
      // Cleanup is retried on the next project-session read or write; a cleanup
      // failure must not turn a successfully persisted login into a failed one.
      try {
        await AsyncStorage.removeItem(legacyKey);
      } catch {
        /* retry later */
      }
    };
    client = createClient(project, publishableKey, {
      auth: {
        storage: {
          getItem: async (name: string) => {
            const value = await AsyncStorage.getItem(name);
            await cleanLegacyAfterSession(name, value);
            return value;
          },
          setItem: async (name: string, value: string) => {
            await AsyncStorage.setItem(name, value);
            await cleanLegacyAfterSession(name, value);
          },
          removeItem: (name: string) => AsyncStorage.removeItem(name),
        },
        storageKey,
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
  const { error } = await ensureClient(url, publishableKey).auth.signOut({
    scope: "local",
  });
  if (error) throw error;
}

/** 读取持久会话的访问令牌；autoRefreshToken 在应用运行期间保持会话新鲜。 */
export async function currentAccessToken(
  url: string,
  publishableKey: string,
): Promise<string> {
  const current = ensureClient(url, publishableKey);
  const generation = authGeneration;
  const { data } = await current.auth.getSession();
  if (generation !== authGeneration || current !== client)
    throw new Error("认证配置已更改，请重试。");
  return data.session?.access_token ?? "";
}

/** Stable account identity for isolating local caches; never use a rotating token. */
export async function currentAccountId(url: string, publishableKey: string): Promise<string> {
  const current = ensureClient(url, publishableKey);
  const generation = authGeneration;
  const { data } = await current.auth.getSession();
  if (generation !== authGeneration || current !== client)
    throw new Error("认证配置已更改，请重试。");
  return data.session?.user?.id ?? "";
}

/** 读取当前账号邮箱；不可得时返回空串，由界面显示中性占位。 */
export async function currentAccountEmail(
  url: string,
  publishableKey: string,
): Promise<string> {
  const current = ensureClient(url, publishableKey);
  const generation = authGeneration;
  const { data } = await current.auth.getUser();
  if (generation !== authGeneration || current !== client)
    throw new Error("认证配置已更改，请重试。");
  return typeof data.user?.email === "string" ? data.user.email : "";
}

/** A recovery flow uses an isolated in-memory client and cannot sign in the app. */
export function createNativeAuthActions(
  url: string,
  publishableKey: string,
  onSignedIn: () => void,
) {
  const main = ensureClient(url, publishableKey);
  let recovery: SupabaseClient | undefined;
  let verified = false;
  const clear = () => {
    verified = false;
    void recovery?.auth.dispose();
    recovery = undefined;
  };
  const recoveryClient = () =>
    (recovery ??= createClient(url, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "antler-native-recovery",
      },
    }));
  return {
    clear,
    actions: {
      async signIn(email: string, password: string) {
        const { error } = await main.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        onSignedIn();
      },
      async signUp(email: string, password: string) {
        const { data, error } = await main.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user?.identities?.length === 0)
          throw new Error("该邮箱已注册，请返回登录。");
      },
      async resendSignupCode(email: string) {
        const { error } = await main.auth.resend({ email, type: "signup" });
        if (error) throw error;
      },
      async verifySignupCode(email: string, token: string) {
        const { error } = await main.auth.verifyOtp({
          email,
          token,
          type: "signup",
        });
        if (error) throw error;
        onSignedIn();
      },
      async sendRecoveryCode(email: string) {
        verified = false;
        const { error } =
          await recoveryClient().auth.resetPasswordForEmail(email);
        if (error) throw error;
      },
      async verifyRecoveryCode(email: string, token: string) {
        verified = false;
        const { error } = await recoveryClient().auth.verifyOtp({
          email,
          token,
          type: "recovery",
        });
        if (error) throw error;
        verified = true;
      },
      async updateRecoveryPassword(password: string) {
        if (!verified) throw new Error("请先验证邮箱验证码。");
        const { error } = await recoveryClient().auth.updateUser({ password });
        if (error) throw error;
        clear();
      },
    },
  };
}

export function onNativeSignedOut(
  url: string,
  publishableKey: string,
  callback: () => void,
) {
  const observedClient = ensureClient(url, publishableKey);
  const { data } = observedClient.auth.onAuthStateChange((event) => {
    if (client === observedClient && event === "SIGNED_OUT") callback();
  });
  const unsubscribe = () => {
    if (!clientSubscriptions.delete(unsubscribe)) return;
    data.subscription.unsubscribe();
  };
  clientSubscriptions.add(unsubscribe);
  return unsubscribe;
}
