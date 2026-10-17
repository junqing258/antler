import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  currentSession: vi.fn(),
  onSessionChange: vi.fn(
    (_callback: (authenticated: boolean) => void) => () => {},
  ),
}));

vi.mock("@/lib/auth", () => ({
  signIn: mocks.signIn,
  signUp: mocks.signUp,
  currentSession: mocks.currentSession,
  onSessionChange: mocks.onSessionChange,
}));

import { AuthGate } from "@/auth/auth-gate";
import { LoginView } from "@/auth/login-view";

beforeEach(() => {
  mocks.signIn.mockReset();
  mocks.signUp.mockReset();
  mocks.currentSession.mockReset();
  mocks.onSessionChange.mockReset();
  mocks.onSessionChange.mockImplementation(() => () => {});
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

  it("切换注册模式后调用注册", async () => {
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
    expect(
      await screen.findByText(/如开启了邮箱确认请查收邮件后登录/),
    ).toBeInTheDocument();
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
