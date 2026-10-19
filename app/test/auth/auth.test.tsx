import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  resendSignupCode: vi.fn(),
  verifySignupCode: vi.fn(),
  currentSession: vi.fn(),
  onSessionChange: vi.fn(
    (_callback: (authenticated: boolean) => void) => () => {},
  ),
  loadAuthConfig: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  signUp: mocks.signUp,
  signIn: mocks.signIn,
  resendSignupCode: mocks.resendSignupCode,
  verifySignupCode: mocks.verifySignupCode,
  currentSession: mocks.currentSession,
  onSessionChange: mocks.onSessionChange,
}));

vi.mock("@/lib/server-info", () => ({
  loadAuthConfig: mocks.loadAuthConfig,
}));

import { AuthGate } from "@/auth/auth-gate";
import { LoginView } from "@/auth/login-view";

beforeEach(() => {
  mocks.signUp.mockReset();
  mocks.signIn.mockReset();
  mocks.resendSignupCode.mockReset();
  mocks.verifySignupCode.mockReset();
  mocks.currentSession.mockReset();
  mocks.onSessionChange.mockReset();
  mocks.onSessionChange.mockImplementation(() => () => {});
  mocks.loadAuthConfig.mockReset();
  mocks.loadAuthConfig.mockResolvedValue("supabase");
});

afterEach(() => {
  cleanup();
});

describe("LoginView", () => {
  const enterEmail = () => {
    fireEvent.click(screen.getByRole("button", { name: "没有账号？注册" }));
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret123" } });
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "注册并发送验证码" }));
  };

  it("默认使用邮箱密码登录，不发送验证码", async () => {
    render(<LoginView />);
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "alice@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith("alice@example.com", "secret123"));
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("验证码")).not.toBeInTheDocument();
  });

  it("发送验证码后使用已发送邮箱验证，期间不能重复发送", async () => {
    render(<LoginView />);
    enterEmail();
    expect(await screen.findByLabelText("验证码")).toBeInTheDocument();
    expect(mocks.signUp).toHaveBeenCalledWith("alice@example.com", "secret123");
    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
    expect(screen.getByLabelText("邮箱")).toBeDisabled();
    expect(screen.getByRole("button", { name: /秒后可重发/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "验证并完成注册" }));
    await waitFor(() => {
      expect(mocks.verifySignupCode).toHaveBeenCalledWith("alice@example.com", "123456");
    });
  });

  it("重复注册不进入验证码页面或显示发送成功", async () => {
    mocks.signUp.mockRejectedValueOnce(new Error("该邮箱已注册，请返回登录；如忘记密码，需要重置密码。"));
    render(<LoginView />);
    enterEmail();
    expect(await screen.findByRole("alert")).toHaveTextContent("该邮箱已注册");
    expect(screen.queryByLabelText("验证码")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("发送失败保留邮箱表单并显示可操作的频率提示", async () => {
    mocks.signUp.mockRejectedValueOnce({ code: "over_email_send_rate_limit" });
    render(<LoginView />);
    enterEmail();
    expect(await screen.findByRole("alert")).toHaveTextContent("发送过于频繁");
    expect(screen.queryByLabelText("验证码")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "注册并发送验证码" })).toBeEnabled();
  });

  it("验证码过期保留输入页，允许更换邮箱且清除旧验证码", async () => {
    mocks.verifySignupCode.mockRejectedValueOnce({ code: "otp_expired" });
    render(<LoginView />);
    enterEmail();
    fireEvent.change(await screen.findByLabelText("验证码"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "验证并完成注册" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("验证码不正确或已过期");
    fireEvent.click(screen.getByRole("button", { name: "更换邮箱" }));
    expect(screen.queryByLabelText("验证码")).not.toBeInTheDocument();
    expect(screen.getByLabelText("邮箱")).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // 更换邮箱不能绕过当前页面的重发间隔。
    expect(screen.getByRole("button", { name: /秒后可发送/ })).toBeDisabled();
  });

  it("重发倒计时结束后可再次发送，并清除旧验证码", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<LoginView />);
      enterEmail();
      const input = await screen.findByLabelText("验证码");
      fireEvent.change(input, { target: { value: "123456" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      fireEvent.click(screen.getByRole("button", { name: "重新发送验证码" }));
      await waitFor(() => expect(mocks.resendSignupCode).toHaveBeenCalledWith("alice@example.com"));
      expect(input).toHaveValue("");
      expect(screen.getByRole("button", { name: /秒后可重发/ })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AuthGate", () => {
  it("未登录时显示登录视图，登录后渲染子内容", async () => {
    let authenticated = false;
    mocks.currentSession.mockResolvedValue(undefined);
    mocks.onSessionChange.mockImplementation((callback) => {
      if (authenticated) callback(true);
      return () => {};
    });
    render(
      <AuthGate>
        <main>聊天界面</main>
      </AuthGate>,
    );
    expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();

    authenticated = true;
    mocks.onSessionChange.mockImplementation((callback) => {
      callback(true);
      return () => {};
    });
    cleanup();
    render(
      <AuthGate>
        <main>聊天界面</main>
      </AuthGate>,
    );
    await waitFor(() => {
      expect(screen.getByText("聊天界面")).toBeInTheDocument();
    });
  });

  it("已登录会话直接渲染子内容", async () => {
    mocks.currentSession.mockResolvedValue({ access_token: "token" });
    render(
      <AuthGate>
        <main>聊天界面</main>
      </AuthGate>,
    );
    await waitFor(() => {
      expect(screen.getByText("聊天界面")).toBeInTheDocument();
    });
  });
});
