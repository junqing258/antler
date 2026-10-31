import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export type AuthMode = "signin" | "signup" | "recovery";

/** 认证协议（如 Supabase）由宿主注入；组件只承载表单状态机与展示。 */
export type AuthFormActions = {
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  resendSignupCode(email: string): Promise<void>;
  verifySignupCode(email: string, token: string): Promise<void>;
  sendRecoveryCode(email: string): Promise<void>;
  verifyRecoveryCode(email: string, token: string): Promise<void>;
  updateRecoveryPassword(password: string): Promise<void>;
};

export function friendlyAuthError(cause: unknown): string {
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

/** 邮箱密码登录；注册和找回密码使用独立类型的邮件验证码。 */
export function AuthForm({
  actions,
  onModeChange,
}: {
  actions: AuthFormActions;
  onModeChange?: (mode: AuthMode) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryVerified, setRecoveryVerified] = useState(false);
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
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  const changeMode = (next: AuthMode) => {
    setMode(next);
    onModeChange?.(next);
    setSentEmail("");
    setToken("");
    setPassword("");
    setConfirmPassword("");
    setRecoveryVerified(false);
    setError("");
    setNotice("");
  };

  const sendCode = async () => {
    if (busy || Date.now() < resendAt) return;
    setBusy(true);
    setError("");
    setNotice("");
    const recipient = sentEmail || email.trim();
    try {
      if (mode === "recovery") await actions.sendRecoveryCode(recipient);
      else if (sentEmail) await actions.resendSignupCode(recipient);
      else await actions.signUp(recipient, password);
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

  const submit = async () => {
    if (busy) return;
    if (mode === "signin") {
      if (!email.trim() || !password) {
        setError("请输入邮箱和密码。");
        return;
      }
      setBusy(true);
      setError("");
      try {
        await actions.signIn(email.trim(), password);
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
        await actions.updateRecoveryPassword(password);
        setEmail(sentEmail);
        changeMode("signin");
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
        await actions.verifyRecoveryCode(sentEmail, token);
        setRecoveryVerified(true);
        setToken("");
        setNotice("邮箱验证成功，请设置新密码。");
      } else {
        await actions.verifySignupCode(sentEmail, token);
        // 登录态变化后由宿主切换视图。
      }
    } catch (cause) {
      setError(friendlyAuthError(cause));
    } finally {
      setBusy(false);
    }
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
    <View style={styles.card}>
      <Text style={styles.heading}>{heading}</Text>
      <Text style={styles.description}>{description}</Text>
      <Text style={styles.fieldLabel}>邮箱</Text>
      <TextInput
        accessibilityLabel="邮箱"
        style={styles.input}
        value={sentEmail || email}
        editable={!busy && !sentEmail}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      {((!sentEmail && mode !== "recovery") || recoveryVerified) && (
        <>
          <Text style={styles.fieldLabel}>
            {mode === "recovery" ? "新密码" : "密码"}
          </Text>
          <TextInput
            accessibilityLabel={mode === "recovery" ? "新密码" : "密码"}
            style={styles.input}
            value={password}
            editable={!busy}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
          />
        </>
      )}
      {recoveryVerified && (
        <>
          <Text style={styles.fieldLabel}>确认新密码</Text>
          <TextInput
            accessibilityLabel="确认新密码"
            style={styles.input}
            value={confirmPassword}
            editable={!busy}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoCapitalize="none"
          />
        </>
      )}
      {sentEmail && !recoveryVerified && (
        <>
          <Text style={styles.fieldLabel}>验证码</Text>
          <TextInput
            accessibilityLabel="验证码"
            style={styles.input}
            value={token}
            editable={!busy}
            onChangeText={(value) =>
              setToken(value.replace(/\D/g, "").slice(0, 6))
            }
            keyboardType="number-pad"
            maxLength={6}
          />
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!notice && (
        <Text accessibilityRole="status" style={styles.notice}>
          {notice}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={submitLabel}
        disabled={busy || (mode !== "signin" && !sentEmail && secondsLeft > 0)}
        onPress={() => {
          void submit();
        }}
        style={[styles.submit, busy && styles.disabled]}
      >
        <Text style={styles.submitText}>{busy ? "请稍候…" : submitLabel}</Text>
      </Pressable>
      {sentEmail && !recoveryVerified && (
        <View style={styles.resendRow}>
          <Pressable
            accessibilityRole="button"
            disabled={busy || secondsLeft > 0}
            onPress={() => {
              void sendCode();
            }}
          >
            <Text style={[styles.link, (busy || secondsLeft > 0) && styles.disabledText]}>
              {secondsLeft > 0 ? `${secondsLeft} 秒后可重发` : "重新发送验证码"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              setEmail(sentEmail);
              setSentEmail("");
              setToken("");
              setError("");
              setNotice("");
            }}
          >
            <Text style={styles.link}>更换邮箱</Text>
          </Pressable>
        </View>
      )}
      {mode === "signin" && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => changeMode("recovery")}
        >
          <Text style={styles.link}>忘记密码？</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => changeMode(mode === "signin" ? "signup" : "signin")}
      >
        <Text style={styles.link}>
          {mode === "signin" ? "没有账号？注册" : mode === "recovery" ? "返回登录" : "已有账号？登录"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 384,
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#eee",
    backgroundColor: "white",
    padding: 24,
  },
  heading: { fontSize: 18, fontWeight: "600", color: "#222" },
  description: { fontSize: 12, color: "#777" },
  fieldLabel: { fontSize: 12, color: "#555" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "white",
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: "#222",
  },
  error: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f4d5d1",
    backgroundColor: "#fff8f7",
    color: "#b42318",
    fontSize: 12,
    padding: 10,
  },
  notice: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9ecdf",
    backgroundColor: "#f2faf5",
    color: "#087d61",
    fontSize: 12,
    padding: 10,
  },
  submit: {
    borderRadius: 8,
    backgroundColor: "#087d61",
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  submitText: { color: "white", fontSize: 14, fontWeight: "500" },
  disabled: { opacity: 0.5 },
  disabledText: { opacity: 0.5 },
  resendRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  link: { fontSize: 12, color: "#087d61" },
});
