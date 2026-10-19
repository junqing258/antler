import type { SupabaseClient } from "@supabase/supabase-js";
import { createPasswordRecoveryClient, supabaseClient } from "@/lib/server-info";

export type AuthSession = Awaited<
  ReturnType<NonNullable<SupabaseClient>["auth"]["getSession"]>
>["data"]["session"];

export async function currentSession(): Promise<AuthSession | undefined> {
  const client = supabaseClient();
  if (!client) return undefined;
  return (await client.auth.getSession()).data.session ?? undefined;
}

export function onSessionChange(
  callback: (authenticated: boolean) => void,
): () => void {
  const client = supabaseClient();
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    callback(Boolean(session));
  });
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string) {
  const client = supabaseClient();
  if (!client) throw new Error("当前未启用登录。");
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string) {
  const client = supabaseClient();
  if (!client) throw new Error("当前未启用登录。");
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  // 已验证邮箱重复注册时，Auth 可能返回不含 identities 的占位用户，实际不发邮件。
  if (data?.user?.identities?.length === 0) {
    throw new Error("该邮箱已注册，请返回登录；如忘记密码，需要重置密码。");
  }
}

export async function resendSignupCode(email: string) {
  const client = supabaseClient();
  if (!client) throw new Error("当前未启用登录。");
  const { error } = await client.auth.resend({ email, type: "signup" });
  if (error) throw error;
}

export async function verifySignupCode(email: string, token: string) {
  const client = supabaseClient();
  if (!client) throw new Error("当前未启用登录。");
  const { error } = await client.auth.verifyOtp({ email, token, type: "signup" });
  if (error) throw error;
}

/** 每个表单独立持有恢复会话；取消、完成或卸载时丢弃，不写入浏览器存储。 */
export function createPasswordRecovery() {
  let client: SupabaseClient | undefined;
  let verified = false;
  const clear = () => {
    verified = false;
    void client?.auth.dispose();
    client = undefined;
  };
  const getClient = () => {
    client ??= createPasswordRecoveryClient();
    if (!client) throw new Error("当前未启用登录。");
    return client;
  };
  return {
    async sendCode(email: string) {
      verified = false;
      const { error } = await getClient().auth.resetPasswordForEmail(email);
      if (error) throw error;
    },
    async verifyCode(email: string, token: string) {
      verified = false;
      const { error } = await getClient().auth.verifyOtp({ email, token, type: "recovery" });
      if (error) throw error;
      verified = true;
    },
    async updatePassword(password: string) {
      if (!verified) throw new Error("请先验证邮箱验证码。");
      const { error } = await getClient().auth.updateUser({ password });
      if (error) throw error;
      clear();
    },
    clear,
  };
}

/** 当前登录账号的展示信息；未登录（local 模式）返回 undefined。 */
export async function currentUserProfile(): Promise<
  { email: string; initial: string } | undefined
> {
  const email = (await currentSession())?.user.email;
  if (!email) return undefined;
  return { email, initial: email.slice(0, 1).toUpperCase() };
}

export async function signOut() {
  await supabaseClient()?.auth.signOut();
}
