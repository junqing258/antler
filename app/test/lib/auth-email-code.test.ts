import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(), recoveryClient: vi.fn(), updateUser: vi.fn(), resetPasswordForEmail: vi.fn(), client: vi.fn(), signInWithPassword: vi.fn(), signUp: vi.fn(), resend: vi.fn(), verifyOtp: vi.fn(),
}));
vi.mock("@/lib/server-info", () => ({ supabaseClient: mocks.client, createPasswordRecoveryClient: mocks.recoveryClient }));
import { createPasswordRecovery, signIn, signUp, resendSignupCode, verifySignupCode } from "@/lib/auth";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockReturnValue({ auth: mocks });
  mocks.recoveryClient.mockReturnValue({ auth: mocks });
  for (const method of [mocks.signInWithPassword, mocks.signUp, mocks.resend, mocks.verifyOtp, mocks.resetPasswordForEmail, mocks.updateUser]) {
    method.mockResolvedValue({ error: null });
  }
});

describe("password login and signup email code", () => {
  it("does not report a sent code for an already registered email", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: { identities: [] } }, error: null });
    await expect(signUp("alice@example.com", "secret123")).rejects.toThrow("该邮箱已注册");
  });
  it("logs in with password and registers with a password", async () => {
    await signIn("alice@example.com", "secret123");
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "alice@example.com", password: "secret123" });
    await signUp("alice@example.com", "secret123");
    expect(mocks.signUp).toHaveBeenCalledWith({ email: "alice@example.com", password: "secret123" });
  });

  it("resends and verifies only signup codes", async () => {
    await resendSignupCode("alice@example.com");
    expect(mocks.resend).toHaveBeenCalledWith({ email: "alice@example.com", type: "signup" });
    await verifySignupCode("alice@example.com", "123456");
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: "alice@example.com", token: "123456", type: "signup" });
  });

  it("propagates invalid-code failures", async () => {
    const error = new Error("Token has expired or is invalid");
    mocks.verifyOtp.mockResolvedValue({ error });
    await expect(verifySignupCode("alice@example.com", "123456")).rejects.toBe(error);
  });

  it("rejects authentication when disabled", async () => {
    mocks.client.mockReturnValue(undefined);
    await expect(signIn("alice@example.com", "secret123")).rejects.toThrow("当前未启用登录");
    await expect(signUp("alice@example.com", "secret123")).rejects.toThrow("当前未启用登录");
    await expect(resendSignupCode("alice@example.com")).rejects.toThrow("当前未启用登录");
    await expect(verifySignupCode("alice@example.com", "123456")).rejects.toThrow("当前未启用登录");
  });
});

describe("password recovery", () => {
  it("requires a recovery OTP and retries failed updates without reusing the code", async () => {
    const recovery = createPasswordRecovery();
    await expect(recovery.updatePassword("new-secret")).rejects.toThrow("请先验证");
    await recovery.sendCode("alice@example.com");
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("alice@example.com");
    await recovery.verifyCode("alice@example.com", "123456");
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: "alice@example.com", token: "123456", type: "recovery" });
    const error = new Error("weak password");
    mocks.updateUser.mockResolvedValueOnce({ error });
    await expect(recovery.updatePassword("weak")).rejects.toBe(error);
    await recovery.updatePassword("new-secret");
    expect(mocks.updateUser).toHaveBeenLastCalledWith({ password: "new-secret" });
    expect(mocks.verifyOtp).toHaveBeenCalledTimes(1);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    await expect(recovery.updatePassword("another-secret")).rejects.toThrow("请先验证");
  });

  it("does not update a password with an invalid OTP or cleared recovery session", async () => {
    const recovery = createPasswordRecovery();
    mocks.verifyOtp.mockResolvedValueOnce({ error: new Error("invalid code") });
    await expect(recovery.verifyCode("alice@example.com", "123456")).rejects.toThrow("invalid code");
    await expect(recovery.updatePassword("new-secret")).rejects.toThrow("请先验证");
    await recovery.verifyCode("alice@example.com", "654321");
    recovery.clear();
    await expect(recovery.updatePassword("new-secret")).rejects.toThrow("请先验证");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("propagates send errors and rejects recovery when auth is disabled", async () => {
    mocks.resetPasswordForEmail.mockResolvedValueOnce({ error: new Error("rate limited") });
    await expect(createPasswordRecovery().sendCode("alice@example.com")).rejects.toThrow("rate limited");
    mocks.recoveryClient.mockReturnValue(undefined);
    await expect(createPasswordRecovery().sendCode("alice@example.com")).rejects.toThrow("当前未启用登录");
  });
});
