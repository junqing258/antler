import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(), signInWithPassword: vi.fn(), signUp: vi.fn(), resend: vi.fn(), verifyOtp: vi.fn(),
}));
vi.mock("@/lib/server-info", () => ({ supabaseClient: mocks.client }));
import { signIn, signUp, resendSignupCode, verifySignupCode } from "@/lib/auth";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockReturnValue({ auth: mocks });
  for (const method of [mocks.signInWithPassword, mocks.signUp, mocks.resend, mocks.verifyOtp]) {
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
