import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseClient } from "@/lib/server-info";

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
  const { error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
}

export async function signUp(email: string, password: string) {
  const client = supabaseClient();
  if (!client) throw new Error("当前未启用登录。");
  const { error } = await client.auth.signUp({ email, password });
  if (error) throw error;
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
