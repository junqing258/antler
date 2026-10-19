import { useEffect, useState, type FormEvent } from "react";
import { signIn, signUp, resendSignupCode, verifySignupCode, createPasswordRecovery } from "@/lib/auth";

function friendlyAuthError(cause: unknown): string {
  const code =
    typeof cause === "object" && cause && "code" in cause
      ? String(cause.code)
      : "";
  switch (code) {
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "验证码发送过于频繁，请稍后再试。";
    case "invalid_credentials":
      return "邮箱或密码不正确。";
    case "email_not_confirmed":
      return "邮箱尚未验证，请切换到注册页面完成验证码验证。";
    case "weak_password":
      return "密码强度不足，请使用更长的密码并包含字母和数字。";
    case "same_password":
      return "新密码不能与原密码相同。";
    case "session_not_found":
    case "refresh_token_not_found":
      return "验证会话已过期，请返回登录后重新申请重置密码。";
    case "otp_expired":
      return "验证码不正确或已过期，请检查验证码或重新发送。";
    default:
      return cause instanceof Error ? cause.message : "登录失败，请稍后重试。";
  }
}

const inputClass =
  "w-full rounded-lg border border-[#ddd] bg-white px-3 py-2 text-sm font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";
const buttonClass =
  "w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";

/** 邮箱密码登录；注册和找回密码使用独立类型的邮件验证码。 */
export function LoginView() {
  const [mode, setMode] = useState<"signin" | "signup" | "recovery">("signin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryVerified, setRecoveryVerified] = useState(false);
  const [recovery] = useState(createPasswordRecovery);
  useEffect(() => () => recovery.clear(), [recovery]);
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (!resendAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const sendCode = async () => {
    if (busy || Date.now() < resendAt) return;
    setBusy(true);
    setError("");
    setNotice("");
    const recipient = sentEmail || email.trim();
    try {
      if (mode === "recovery") await recovery.sendCode(recipient);
      else if (sentEmail) await resendSignupCode(recipient);
      else await signUp(recipient, password);
      setPassword("");
      setSentEmail(recipient);
      setToken("");
      setNotice(mode === "recovery"
        ? `如果 ${recipient} 已注册，您将收到重置密码验证码，请在 10 分钟内输入。`
        : `验证码已发送至 ${recipient}，请在 10 分钟内输入。`);
      const sentAt = Date.now();
      setNow(sentAt);
      setResendAt(sentAt + 60_000);
    } catch (cause) {
      setError(friendlyAuthError(cause));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === "signin") {
      setBusy(true);
      setError("");
      try {
        await signIn(email.trim(), password);
      } catch (cause) {
        setError(friendlyAuthError(cause));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === "recovery" && recoveryVerified) {
      if (password.length < 6) {
        setError("新密码至少需要 6 个字符。");
        return;
      }
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致。");
        return;
      }
      setBusy(true);
      setError("");
      try {
        await recovery.updatePassword(password);
        setEmail(sentEmail);
        setMode("signin");
        setSentEmail("");
        setToken("");
        setPassword("");
        setConfirmPassword("");
        setRecoveryVerified(false);
        setNotice("密码已重置，请使用新密码登录。");
      } catch (cause) {
        setError(friendlyAuthError(cause));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!sentEmail) {
      await sendCode();
      return;
    }
    if (!/^\d{6}$/.test(token)) {
      setError("请输入 6 位数字验证码。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (mode === "recovery") {
        await recovery.verifyCode(sentEmail, token);
        setRecoveryVerified(true);
        setToken("");
        setNotice("邮箱验证成功，请设置新密码。");
      } else {
        await verifySignupCode(sentEmail, token);
        // onAuthStateChange 会把视图切换回聊天界面。
      }
    } catch (cause) {
      setError(friendlyAuthError(cause));
    } finally {
      setBusy(false);
    }
  };

  const changeMode = (next: typeof mode) => {
    recovery.clear();
    setMode(next);
    setSentEmail("");
    setToken("");
    setPassword("");
    setConfirmPassword("");
    setRecoveryVerified(false);
    setError("");
    setNotice("");
  };
  const heading = mode === "signin" ? "登录 Antler" : mode === "signup" ? "注册 Antler" : "找回密码";
  const description = mode === "signin" ? "使用邮箱和密码登录。" : mode === "signup"
    ? "设置密码后，输入邮件验证码完成注册。"
    : recoveryVerified ? "设置新密码后，返回登录。" : "输入注册邮箱，通过邮件验证码重置密码。";
  const submitLabel = mode === "signin" ? "登录" : recoveryVerified ? "重置密码"
    : sentEmail ? (mode === "recovery" ? "验证邮箱" : "验证并完成注册")
    : secondsLeft > 0 ? `${secondsLeft} 秒后可发送`
    : mode === "recovery" ? "发送重置验证码" : "注册并发送验证码";

  return (
    <div className="grid min-h-[var(--app-viewport-height)] place-items-center bg-[#fafafa] p-4">
      <form
        onSubmit={submit}
        className="grid w-full max-w-sm gap-4 rounded-2xl border border-[#eee] bg-white p-6 shadow-sm"
      >
        <h1 className="m-0 text-lg font-semibold text-[#222]">{heading}</h1>
        <p className="m-0 text-xs text-[#777]">{description}</p>
        <label className="grid gap-1.5 text-xs text-[#555]">
          邮箱
          <input
            type="email"
            required
            autoComplete="email"
            className={inputClass}
            value={sentEmail || email}
            disabled={busy || Boolean(sentEmail)}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {((!sentEmail && mode !== "recovery") || recoveryVerified) && (
          <label className="grid gap-1.5 text-xs text-[#555]">
            {mode === "recovery" ? "新密码" : "密码"}
            <input
              type="password"
              required
              minLength={mode !== "signin" ? 6 : undefined}
              autoComplete={mode !== "signin" ? "new-password" : "current-password"}
              className={inputClass}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
        {recoveryVerified && (
          <label className="grid gap-1.5 text-xs text-[#555]">
            确认新密码
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className={inputClass}
              value={confirmPassword}
              disabled={busy}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
        )}
        {sentEmail && !recoveryVerified && (
          <label className="grid gap-1.5 text-xs text-[#555]">
            验证码
            <input
              type="text"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              className={inputClass}
              value={token}
              disabled={busy}
              onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </label>
        )}
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
        <button type="submit" className={buttonClass} disabled={busy || (mode !== "signin" && !sentEmail && secondsLeft > 0)}>
          {busy ? "请稍候…" : submitLabel}
        </button>
        {sentEmail && !recoveryVerified && (
          <div className="flex justify-between gap-3 text-xs text-primary">
            <button type="button" disabled={busy || secondsLeft > 0} className="disabled:opacity-50" onClick={() => void sendCode()}>
              {secondsLeft > 0 ? `${secondsLeft} 秒后可重发` : "重新发送验证码"}
            </button>
            <button type="button" disabled={busy} onClick={() => {
              setEmail(sentEmail);
              setSentEmail("");
              setToken("");
              setError("");
              setNotice("");
            }}>
              更换邮箱
            </button>
          </div>
        )}
        {mode === "signin" && (
          <button
            type="button"
            className="border-0 bg-transparent p-0 text-xs text-primary hover:underline"
            disabled={busy}
            onClick={() => changeMode("recovery")}
          >
            忘记密码？
          </button>
        )}
        <button
          type="button"
          className="border-0 bg-transparent p-0 text-xs text-primary hover:underline"
          disabled={busy}
          onClick={() => changeMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "没有账号？注册" : mode === "recovery" ? "返回登录" : "已有账号？登录"}
        </button>
      </form>
    </div>
  );
}
