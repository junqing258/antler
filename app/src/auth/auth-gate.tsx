import { useEffect, useState, type ReactNode } from "react";
import { currentSession, onSessionChange } from "@/lib/auth";
import { loadAuthConfig } from "@/lib/server-info";
import { LoginView } from "@/auth/login-view";

type AuthState = "loading" | "local" | "anonymous" | "authenticated";

/** 认证门：local 模式直接放行；supabase 模式未登录时显示登录视图。 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    let mounted = true;
    void loadAuthConfig().then(async (mode) => {
      if (!mounted) return;
      if (mode === "local") {
        setState("local");
        return;
      }
      const session = await currentSession();
      if (!mounted) return;
      setState(session ? "authenticated" : "anonymous");
      onSessionChange((authenticated) => {
        if (mounted) setState(authenticated ? "authenticated" : "anonymous");
      });
    });
    return () => {
      mounted = false;
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
