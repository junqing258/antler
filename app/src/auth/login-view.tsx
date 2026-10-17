import { useState, type FormEvent } from "react";
import { signIn, signUp } from "@/lib/auth";

const inputClass =
  "w-full rounded-lg border border-[#ddd] bg-white px-3 py-2 text-sm font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";
const buttonClass =
  "w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";

/** Supabase 模式下的邮箱密码登录视图；注册成功后按项目确认策略提示用户。 */
export function LoginView() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "signup") {
        await signUp(email.trim(), password);
        setNotice("注册成功，如开启了邮箱确认请查收邮件后登录。");
      } else {
        await signIn(email.trim(), password);
        // onAuthStateChange 会把视图切换回聊天界面。
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "登录失败，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-[#fafafa] p-4">
      <form
        onSubmit={submit}
        className="grid w-full max-w-sm gap-4 rounded-2xl border border-[#eee] bg-white p-6 shadow-sm"
      >
        <h1 className="m-0 text-lg font-semibold text-[#222]">
          {mode === "signin" ? "登录 Antler" : "注册 Antler"}
        </h1>
        <label className="grid gap-1.5 text-xs text-[#555]">
          邮箱
          <input
            type="email"
            required
            autoComplete="email"
            className={inputClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="grid gap-1.5 text-xs text-[#555]">
          密码
          <input
            type="password"
            required
            minLength={6}
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            className={inputClass}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="m-0 rounded-lg border border-[#f4d5d1] bg-[#fff8f7] p-2.5 text-xs text-[#b42318]" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="m-0 rounded-lg border border-[#d9ecdf] bg-[#f2faf5] p-2.5 text-xs text-[#087d61]" role="status">
            {notice}
          </p>
        )}
        <button type="submit" className={buttonClass} disabled={busy}>
          {busy ? "请稍候…" : mode === "signin" ? "登录" : "注册"}
        </button>
        <button
          type="button"
          className="border-0 bg-transparent p-0 text-xs text-primary hover:underline"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError("");
            setNotice("");
          }}
        >
          {mode === "signin" ? "没有账号？注册" : "已有账号？登录"}
        </button>
      </form>
    </div>
  );
}
