import { useState, type FormEvent } from "react";
import { signIn, signUp } from "@/lib/auth";

/** 把 Supabase Auth 常见错误码翻译成可操作的中文提示。 */
function friendlyAuthError(cause: unknown): string {
  const code =
    typeof cause === "object" && cause && "code" in cause
      ? String((cause as { code: unknown }).code)
      : "";
  switch (code) {
    case "over_email_send_rate_limit":
      return "验证邮件发送已达频率上限（Supabase 默认每小时仅少量邮件），请稍后再试；开发调试可在 Supabase Dashboard 关闭邮箱确认或配置自定义 SMTP。";
    case "invalid_credentials":
      return "邮箱或密码不正确。";
    case "email_not_confirmed":
      return "邮箱尚未确认，请先查收确认邮件并点击链接。";
    case "user_already_exists":
      return "该邮箱已注册，可直接登录。";
    default:
      return cause instanceof Error ? cause.message : "登录失败，请稍后重试。";
  }
}

const inputClass =
  "w-full rounded-lg border border-[#ddd] bg-white px-3 py-2 text-sm font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";
const buttonClass =
  "w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";

/** Supabase 模式下的邮箱密码登录视图；注册成功后展示确认邮件指引。 */
export function LoginView() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [registered, setRegistered] = useState(false);
  const registeredDone = mode === "signup" && registered;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "signup") {
        await signUp(email.trim(), password);
        setRegistered(true);
      } else {
        await signIn(email.trim(), password);
        // onAuthStateChange 会把视图切换回聊天界面。
      }
    } catch (cause) {
      setError(friendlyAuthError(cause));
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
          {registeredDone ? "注册 Antler" : mode === "signin" ? "登录 Antler" : "注册 Antler"}
        </h1>
        {registeredDone ? (
          <div
            className="grid gap-2 rounded-lg border border-[#d9ecdf] bg-[#f2faf5] p-4 text-xs text-[#087d61]"
            role="status"
          >
            <p className="m-0 text-sm font-semibold">注册成功！</p>
            <p className="m-0">
              确认邮件已发送至{" "}
              <span className="font-semibold break-all">{email}</span>
              ，请打开邮箱点击确认链接完成验证，然后返回登录。
            </p>
            <button
              type="button"
              className="mt-1 justify-self-start rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                setMode("signin");
                setRegistered(false);
                setError("");
              }}
            >
              返回登录
            </button>
          </div>
        ) : (
          <>
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
          </>
        )}
        {!registeredDone && (
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
        )}
      </form>
    </div>
  );
}
