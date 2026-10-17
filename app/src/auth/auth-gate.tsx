import { useEffect, useState, type ReactNode } from "react";
import { currentSession, onSessionChange } from "@/lib/auth";
import { LoginView } from "@/auth/login-view";

type AuthState = "loading" | "anonymous" | "authenticated";

/** Supabase 模式的认证门：未登录显示登录视图，已登录渲染子内容。 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    let mounted = true;
    void currentSession().then((session) => {
      if (mounted) setState(session ? "authenticated" : "anonymous");
    });
    const unsubscribe = onSessionChange((authenticated) => {
      if (mounted) setState(authenticated ? "authenticated" : "anonymous");
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#fafafa] text-sm text-[#777]">
        正在加载…
      </div>
    );
  }
  if (state === "anonymous") return <LoginView />;
  return <>{children}</>;
}
