import { resetConversationSession } from "@/lib/conversation-store";
import { useEffect, useState, type ReactNode } from "react";
import { currentSession, onSessionChange } from "@/lib/auth";
import { loadAuthConfig } from "@/lib/server-info";
import { LoginView } from "@/auth/login-view";

type AuthState = "loading" | "error" | "local" | "anonymous" | "authenticated";

/** 认证门：local 模式直接放行；supabase 模式未登录时显示登录视图。 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    setState("loading");
    void loadAuthConfig().then(async (mode) => {
      if (!mounted) return;
      if (mode === "local") {
        setState("local");
        return;
      }
      const session = await currentSession();
      if (!mounted) return;
      setUserId(session?.user?.id ?? "");
      setState(session ? "authenticated" : "anonymous");
      let currentUserId = session?.user?.id ?? "";
      unsubscribe = onSessionChange((authenticated, id) => {
        if (mounted) {
          if (currentUserId !== (id ?? "")) resetConversationSession();
          currentUserId = id ?? "";
          setUserId(currentUserId);
          setState(authenticated ? "authenticated" : "anonymous");
        }
      });
    }).catch((cause: unknown) => {
      if (mounted) {
        setError(cause instanceof Error ? cause.message : "无法连接服务端。");
        setState("error");
      }
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [attempt]);

  if (state === "loading") {
    return (
      <div className="grid min-h-[var(--app-viewport-height)] place-items-center bg-[#fafafa] text-sm text-[#777]">
        正在加载…
      </div>
    );
  }
  if (state === "error") return (
    <div className="grid min-h-[var(--app-viewport-height)] place-content-center gap-4 text-center">
      <p role="alert">{error}</p>
      <button onClick={() => setAttempt((value) => value + 1)}>重试</button>
    </div>
  );
  if (state === "anonymous") return <LoginView />;
  return <div key={userId} className="contents">{children}</div>;
}
