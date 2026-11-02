import { useEffect, useState } from "react";
import { AuthForm, type AuthFormActions, type AuthMode } from "@antler/ui";
import { SiteFiling } from "@/components/site-filing";
import {
  createPasswordRecovery,
  resendSignupCode,
  signIn,
  signUp,
  verifySignupCode,
} from "@/lib/auth";

/** 认证协议（Supabase）留在 Web 宿主；表单状态机经共享 AuthForm 复用。 */
export function LoginView() {
  const [recovery] = useState(createPasswordRecovery);
  const [mode, setMode] = useState<AuthMode>("signin");
  useEffect(() => () => recovery.clear(), [recovery]);
  const actions: AuthFormActions = {
    signIn: (email, password) => signIn(email, password),
    signUp: (email, password) => signUp(email, password),
    resendSignupCode: (email) => resendSignupCode(email),
    verifySignupCode: (email, token) => verifySignupCode(email, token),
    sendRecoveryCode: (email) => recovery.sendCode(email),
    verifyRecoveryCode: (email, token) => recovery.verifyCode(email, token),
    updateRecoveryPassword: (password) => recovery.updatePassword(password),
  };
  return (
    <>
      <div
        className={`grid min-h-[var(--app-viewport-height)] place-items-center bg-[#fafafa] p-4 ${mode !== "recovery" ? "auth-with-site-filing" : ""}`}
      >
        <AuthForm
          actions={actions}
          onModeChange={(next) => {
            recovery.clear();
            setMode(next);
          }}
        />
      </div>
      {mode !== "recovery" && <SiteFiling />}
    </>
  );
}
