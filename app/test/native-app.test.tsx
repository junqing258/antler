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
  autoMessage: undefined as string | undefined,
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
// Expo Router 假实现：可驱动的路由状态 + 渲染真实路由组件。
const routerState = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    route: "/",
    params: {} as Record<string, string>,
    listeners,
    emit: () => listeners.forEach((l) => l()),
  };
});
const routerFake = vi.hoisted(() => {
  const normalize = (target: any) => {
    if (typeof target === "string") return { route: target, params: {} };
    const route = String(target.pathname).replace(
      /\[id\]/g,
      String(target.params?.id ?? ""),
    );
    return { route, params: (target.params ?? {}) as Record<string, string> };
  };
  const go = (target: any) => {
    Object.assign(routerState, normalize(target));
    routerState.emit();
  };
  return {
    push: go,
    replace: go,
    back: () => go("/"),
    canDismiss: () => false,
  };
});
vi.mock("../../mobile/node_modules/expo-router", async () => {
  const React = await import("react");
  const { HomeRoute } = await import("../../mobile/src/app/index");
  const { ChatRoute } = await import("../../mobile/src/app/chat/[id]");
  const { RootContext } = await import(
    "../../mobile/src/views/root/root-context"
  );
  function Stack() {
    const route = React.useSyncExternalStore(
      (onStoreChange) => {
        routerState.listeners.add(onStoreChange);
        return () => routerState.listeners.delete(onStoreChange);
      },
      () => routerState.route,
    );
    if (!React.useContext(RootContext)) return null;
    return route.startsWith("/chat/")
      ? React.createElement(ChatRoute)
      : React.createElement(HomeRoute);
  }
  const subscribeParams = (onStoreChange: () => void) => {
    routerState.listeners.add(onStoreChange);
    return () => routerState.listeners.delete(onStoreChange);
  };
  return {
    useRouter: () => routerFake,
    useGlobalSearchParams: () =>
      React.useSyncExternalStore(subscribeParams, () => routerState.params),
    useLocalSearchParams: () =>
      React.useSyncExternalStore(subscribeParams, () => routerState.params),
    Stack,
  };
});
vi.mock("../../mobile/node_modules/expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("../../mobile/src/experiments/probe", () => ({ Probe: () => null }));
vi.mock("../../mobile/node_modules/expo-crypto", () => ({
  randomUUID: () => "new-session",
}));
vi.mock("../../mobile/src/lib/app-config", () => ({
  readAppConfig: () => {
    if (state.bootError) throw new Error(state.bootError);
    return {
      serverUrl: "https://server.example",
      automationEnabled: state.automation,
    };
  },
}));
vi.mock("../../mobile/src/lib/native-storage", () => ({
  loadNativeConfig: async () => state.legacy,
}));
vi.mock("../../mobile/src/lib/native-auth", () => ({
  loadAuthBackendConfig: async () => state.backend,
  currentAccessToken: async () => state.token,
  currentAccountEmail: async () => "user@example.com",
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
vi.mock("../../mobile/src/lib/provider-storage", () => {
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
vi.mock("../../mobile/src/lib/native-platform", () => ({
  createNativePlatform: (config: any) => ({
    connection: async () => {
      state.connection(config);
      return { baseUrl: config.serverUrl, headers: {} };
    },
    request: async () => new Response("{}", { status: state.requestStatus }),
  }),
}));
vi.mock("../../mobile/src/views/home/home-page", () => ({
  HomePage: ({ onOpenAgent }: any) => (
    <button onClick={() => onOpenAgent()}>开始对话</button>
  ),
}));
vi.mock("../../mobile/src/views/chat/native-chat", () => ({
  NativeChat: ({ onConfigure, config, getToken, onUnauthorized, autoMessage }: any) => {
    state.chatConfig = config;
    state.autoMessage = autoMessage;
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
  ConversationList: () => <div>会话列表</div>,
}));
import { AppContainer } from "../../mobile/src/views/root/app-container";
beforeEach(() => {
  routerState.route = "/";
  routerState.params = {};
  state.automation = false;
  state.requestStatus = 200;
  state.token = "";
  state.signedOut = undefined;
  state.chatConfig = null;
  state.autoMessage = undefined;
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
  render(<AppContainer />);
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
  render(<AppContainer />);
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

it("opens settings as a dialog and switches profile and about tabs", async () => {
  state.backend = { mode: "local", requiresAccessToken: false };
  render(<AppContainer />);
  fireEvent.click(await screen.findByText("开始对话"));
  fireEvent.click(screen.getByText("设置"));
  fireEvent.click(screen.getByRole("tab", { name: /个人资料/ }));
  const name = screen.getByLabelText("显示名称");
  fireEvent.change(name, { target: { value: "小安" } });
  expect(name).toHaveValue("小安");
  expect(screen.getByText("小")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: /关于/ }));
  expect(screen.getByText("应用信息与版本")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "关闭设置" }));
  expect(screen.queryByText("应用信息与版本")).not.toBeInTheDocument();
  expect(screen.getByLabelText("草稿")).toBeInTheDocument();
});

it("ignores automation in release and never accepts an endpoint override in test builds", async () => {
  state.backend = { mode: "local", requiresAccessToken: false };
  const initialUrl = vi
    .spyOn(Linking, "getInitialURL")
    .mockResolvedValue(
      "antler://autostart?serverUrl=https%3A%2F%2Fevil.example&message=hello",
    );
  const first = render(<AppContainer />);
  await screen.findByText("开始对话");
  expect(initialUrl).not.toHaveBeenCalled();
  first.unmount();
  state.automation = true;
  render(<AppContainer />);
  await screen.findByLabelText("草稿");
  expect(state.chatConfig.serverUrl).toBe("https://server.example");
});

it("reports a rejected matching legacy token and can retry when it is restored", async () => {
  state.legacy.serverUrl = "https://server.example";
  state.requestStatus = 401;
  render(<AppContainer />);
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
  render(<AppContainer />);
  await screen.findByText("登录表单");
  expect(screen.getByRole("alert")).toHaveTextContent("登录已过期，请重新登录");
  expect(screen.queryByText("开始对话")).not.toBeInTheDocument();
});

it("invalidates an old token source immediately after a rejected credential", async () => {
  state.legacy.serverUrl = "https://server.example";
  render(<AppContainer />);
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
  render(<AppContainer />);
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
  render(<AppContainer />);
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

it("delivers an automation message to the chat without exposing it in route params", async () => {
  state.backend = { mode: "local", requiresAccessToken: false };
  state.automation = true;
  vi.spyOn(Linking, "getInitialURL").mockResolvedValue(
    "antler://autostart?conversationId=conv-1&message=hello",
  );
  render(<AppContainer />);
  await screen.findByLabelText("草稿");
  expect(routerState.route).toBe("/chat/conv-1");
  // 敏感的自动化参数只经内存上下文传递，不进入路由参数或历史。
  expect(routerState.params).toEqual({ id: "conv-1", agentId: "" });
  expect(state.autoMessage).toBe("hello");
});
