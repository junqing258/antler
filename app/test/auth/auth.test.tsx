import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  currentSession: vi.fn(),
  onSessionChange: vi.fn(
    (_callback: (authenticated: boolean) => void) => () => {},
  ),
  loadAuthConfig: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  signIn: mocks.signIn,
  signUp: mocks.signUp,
  currentSession: mocks.currentSession,
  onSessionChange: mocks.onSessionChange,
}));

vi.mock("@/lib/server-info", () => ({
  loadAuthConfig: mocks.loadAuthConfig,
}));

import { AuthGate } from "@/auth/auth-gate";
import { LoginView } from "@/auth/login-view";

beforeEach(() => {
  mocks.signIn.mockReset();
  mocks.signUp.mockReset();
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
  it("提交登录表单并展示错误信息", async () => {
    mocks.signIn.mockRejectedValueOnce(new Error("Invalid login credentials"));
    render(<LoginView />);
    fireEvent.change(screen.getByLabelText(/邮箱/), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/密码/), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(mocks.signIn).toHaveBeenCalledWith("alice@example.com", "secret123");
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Invalid login credentials",
      );
    });
  });

  it("注册成功后隐藏表单并展示确认邮件指引", async () => {
    render(<LoginView />);
    fireEvent.click(screen.getByRole("button", { name: "没有账号？注册" }));
    fireEvent.change(screen.getByLabelText(/邮箱/), {
      target: { value: "bob@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/密码/), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "注册" }));
    await waitFor(() => {
      expect(mocks.signUp).toHaveBeenCalledWith("bob@example.com", "secret123");
    });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("注册成功");
    expect(status).toHaveTextContent("bob@example.com");
    // 表单与注册按钮已隐藏，仅保留“返回登录”。
    expect(screen.queryByLabelText(/邮箱/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/密码/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "注册" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回登录" }));
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByLabelText(/邮箱/)).toBeInTheDocument();
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
