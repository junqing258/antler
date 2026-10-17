import { supabase } from "@/lib/server-info";

export type AuthSession = Awaited<
  ReturnType<NonNullable<typeof supabase>["auth"]["getSession"]>
>["data"]["session"];

export async function currentSession(): Promise<AuthSession | undefined> {
  if (!supabase) return undefined;
  return (await supabase.auth.getSession()).data.session ?? undefined;
}

export function onSessionChange(
  callback: (authenticated: boolean) => void,
): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(Boolean(session));
  });
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error("未配置 Supabase 登录。");
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
}

export async function signUp(email: string, password: string) {
  if (!supabase) throw new Error("未配置 Supabase 登录。");
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signOut() {
  await supabase?.auth.signOut();
}
