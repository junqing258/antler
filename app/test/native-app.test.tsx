import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
// Vite resolves this to react-native-web; the native types live in the mobile workspace.
// @ts-expect-error The app workspace does not directly depend on react-native.
import { Linking } from "react-native";
const state = vi.hoisted(() => ({
  automation: false,
  requestStatus: 200,
  token: "",
  signedOut: undefined as (() => void) | undefined,
  chatConfig: null as any,
  chatGetToken: undefined as (() => Promise<string>) | undefined,
  bootError: "",
  backend: { mode: "local", requiresAccessToken: true } as any,
  legacy: {
    serverUrl: "https://old.example",
    authMode: "local",
    accessToken: "old-token",
  },
  connection: vi.fn(),
  listener: undefined as (() => void) | undefined,
}));
vi.mock("../../mobile/node_modules/expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("../../mobile/src/probe", () => ({ Probe: () => null }));
vi.mock("../../mobile/node_modules/expo-crypto", () => ({
  randomUUID: () => "new-session",
}));
vi.mock("../../mobile/src/app-config", () => ({
  readAppConfig: () => {
    if (state.bootError) throw new Error(state.bootError);
    return {
      serverUrl: "https://server.example",
      automationEnabled: state.automation,
    };
  },
}));
vi.mock("../../mobile/src/native-storage", () => ({
  loadNativeConfig: async () => state.legacy,
}));
vi.mock("../../mobile/src/native-auth", () => ({
  loadAuthBackendConfig: async () => state.backend,
  currentAccessToken: async () => state.token,
  disposeNativeAuth: () => {},
  onNativeSignedOut: (_url: string, _key: string, callback: () => void) => {
    state.signedOut = callback;
    return () => {
      state.signedOut = undefined;
    };
  },
  createNativeAuthActions: () => ({ actions: {}, clear: () => {} }),
  signOut: async () => {},
}));
vi.mock("../../mobile/src/provider-storage", () => {
  const value = {
    name: "OpenAI",
    protocol: "openai-responses",
    baseUrl: "",
    apiKey: "",
    models: [],
    model: "",
  };
  return {
    defaultProvider: value,
    loadProviderConfig: async () => value,
    saveProviderConfig: async () => {},
    subscribeProviderConfig: (listener: () => void) => {
      state.listener = listener;
      return () => {};
    },
  };
});
vi.mock("../../mobile/src/native-platform", () => ({
  createNativePlatform: (config: any) => ({
    connection: async () => {
      state.connection(config);
      return { baseUrl: config.serverUrl, headers: {} };
    },
    request: async () => new Response("{}", { status: state.requestStatus }),
  }),
}));
vi.mock("../../mobile/src/home-page", () => ({
  HomePage: ({ onOpenAgent }: any) => (
    <button onClick={() => onOpenAgent()}>开始对话</button>
  ),
}));
vi.mock("../../mobile/src/native-chat", () => ({
  NativeChat: ({ onConfigure, config, getToken, onUnauthorized }: any) => {
    state.chatConfig = config;
    state.chatGetToken = getToken;
    return (
      <div>
        <input aria-label="草稿" />
        <button onClick={() => onConfigure()}>设置</button>
        <button onClick={() => onUnauthorized()}>模拟认证失效</button>
      </div>
    );
  },
}));
vi.mock("@antler/ui", () => ({
  AuthForm: () => <div>登录表单</div>,
  ProviderConfigForm: ({ onSubmit, value }: any) => (
    <button onClick={() => onSubmit(value)}>保存供应商</button>
  ),
}));
import { App } from "../../mobile/src/app";
beforeEach(() => {
  state.automation = false;
  state.requestStatus = 200;
  state.token = "";
  state.signedOut = undefined;
  state.chatConfig = null;
  state.chatGetToken = undefined;
  state.bootError = "";
  state.backend = { mode: "local", requiresAccessToken: true };
  state.legacy = {
    serverUrl: "https://old.example",
    authMode: "local",
    accessToken: "old-token",
  };
  state.connection.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("rejects a token bound to another endpoint and permits retry", async () => {
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("不支持");
  expect(state.connection).not.toHaveBeenCalled();
  state.legacy.serverUrl = "https://server.example/";
  fireEvent.click(screen.getByText("重试"));
  await screen.findByText("开始对话");
  expect(state.connection).toHaveBeenCalledWith(
    expect.objectContaining({
      serverUrl: "https://server.example",
      accessToken: "old-token",
    }),
  );
});
it("keeps the chat and draft mounted while saving settings", async () => {
  state.backend = { mode: "local", requiresAccessToken: false };
  render(<App />);
  fireEvent.click(await screen.findByText("开始对话"));
  fireEvent.change(screen.getByLabelText("草稿"), {
    target: { value: "尚未发送" },
  });
  fireEvent.click(screen.getByText("设置"));
  fireEvent.click(screen.getByText("保存供应商"));
  await waitFor(() =>
    expect(screen.queryByText("保存供应商")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("草稿")).toHaveValue("尚未发送");
});

it("ignores automation in release and never accepts an endpoint override in test builds", async () => {
  state.backend = { mode: "local", requiresAccessToken: false };
  const initialUrl = vi
    .spyOn(Linking, "getInitialURL")
    .mockResolvedValue(
      "antler://autostart?serverUrl=https%3A%2F%2Fevil.example&message=hello",
    );
  const first = render(<App />);
  await screen.findByText("开始对话");
  expect(initialUrl).not.toHaveBeenCalled();
  first.unmount();
  state.automation = true;
  render(<App />);
  await screen.findByLabelText("草稿");
  expect(state.chatConfig.serverUrl).toBe("https://server.example");
});

it("reports a rejected matching legacy token and can retry when it is restored", async () => {
  state.legacy.serverUrl = "https://server.example";
  state.requestStatus = 401;
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "旧访问令牌已被拒绝",
  );
  expect(screen.queryByText("开始对话")).not.toBeInTheDocument();
  state.requestStatus = 200;
  fireEvent.click(screen.getByText("重试"));
  await screen.findByText("开始对话");
});

it("explains a rejected restored Supabase session on the login screen", async () => {
  state.backend = {
    mode: "supabase",
    url: "https://auth.example",
    publishableKey: "pk",
  };
  state.token = "expired-token";
  state.requestStatus = 401;
  render(<App />);
  await screen.findByText("登录表单");
  expect(screen.getByRole("alert")).toHaveTextContent("登录已过期，请重新登录");
  expect(screen.queryByText("开始对话")).not.toBeInTheDocument();
});

it("invalidates an old token source immediately after a rejected credential", async () => {
  state.legacy.serverUrl = "https://server.example";
  render(<App />);
  fireEvent.click(await screen.findByText("开始对话"));
  const oldGetToken = state.chatGetToken!;
  expect(await oldGetToken()).toBe("old-token");
  fireEvent.click(screen.getByText("模拟认证失效"));
  await expect(oldGetToken()).rejects.toThrow("认证配置已更改");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "服务端拒绝了访问",
  );
});

it("returns to login and rejects old token readers after Supabase signs out", async () => {
  state.backend = {
    mode: "supabase",
    url: "https://auth.example",
    publishableKey: "pk",
  };
  state.token = "project-token";
  render(<App />);
  fireEvent.click(await screen.findByText("开始对话"));
  const oldGetToken = state.chatGetToken!;
  expect(await oldGetToken()).toBe("project-token");
  await act(async () => state.signedOut?.());
  expect(await screen.findByText("登录表单")).toBeInTheDocument();
  await expect(oldGetToken()).rejects.toThrow("认证配置已更改");
});

it("closes the previous conversation if the current Supabase session disappears", async () => {
  state.backend = {
    mode: "supabase",
    url: "https://auth.example",
    publishableKey: "pk",
  };
  state.token = "project-token";
  render(<App />);
  fireEvent.click(await screen.findByText("开始对话"));
  const oldGetToken = state.chatGetToken!;
  state.token = "";
  await act(async () => {
    await expect(oldGetToken()).rejects.toThrow("登录已过期");
  });
  expect(await screen.findByText("登录表单")).toBeInTheDocument();
  expect(screen.queryByLabelText("草稿")).not.toBeInTheDocument();
  await expect(oldGetToken()).rejects.toThrow("认证配置已更改");
});
