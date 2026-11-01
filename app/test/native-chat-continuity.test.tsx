import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({
  sessions: [] as any[],
  getProvider: undefined as (() => any) | undefined,
  executionConfig: undefined as Record<string, unknown> | undefined,
  providerStatus: 200,
  running: false,
}));
vi.mock("../../mobile/node_modules/expo-clipboard", () => ({
  setStringAsync: vi.fn(),
}));
vi.mock("../../mobile/src/lib/native-platform", () => ({
  createNativePlatform: () => ({
    onForeground: () => () => {},
    connection: async () => ({
      baseUrl: "https://server.example",
      headers: {},
    }),
    request: async () =>
      Response.json(
        { model: "server-model" },
        { status: capture.providerStatus },
      ),
  }),
}));
vi.mock("@antler/client-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@antler/client-runtime")>()),
  createHttpSessionDependencies: (
    _platform: unknown,
    getProvider: () => unknown,
  ) => {
    capture.getProvider = getProvider;
    return {};
  },
  ChatSession: class {
    start = vi.fn();
    stop = vi.fn();
    providerChanged = vi.fn();
    credentialProblem = () => "";
    subscribe = () => () => {};
    getSnapshot = () => this.state;
    state = {
      ready: true,
      running: capture.running,
      sending: false,
      messages: [],
      hasMore: false,
      notice: "",
      contextReason: "",
      executionConfig: capture.executionConfig,
    };
    constructor() {
      capture.sessions.push(this);
    }
  },
}));
vi.mock("@antler/ui", () => ({
  ChatScreen: ({ draft, onDraftChange, model, models, onModelChange }: any) => (
    <>
      <input
        aria-label="聊天输入"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
      />
      <span data-testid="model">{model || "服务端默认模型"}</span>
      <span data-testid="models">{models.join(",")}</span>
      <button onClick={() => onModelChange("other-model")}>选择其他模型</button>
    </>
  ),
}));
import { NativeChat } from "../../mobile/src/views/chat/native-chat";
import { defaultNativeConfig } from "../../mobile/src/lib/native-config";

afterEach(() => {
  cleanup();
  capture.sessions.length = 0;
  capture.getProvider = undefined;
  capture.executionConfig = undefined;
  capture.providerStatus = 200;
  capture.running = false;
});
it("updates provider credentials without stopping the live session or discarding the draft", () => {
  const provider = {
    name: "x",
    protocol: "openai-responses" as const,
    baseUrl: "https://model.example",
    apiKey: "first",
    models: ["m"],
    model: "m",
  };
  const config = {
    ...defaultNativeConfig,
    serverUrl: "https://server.example",
    conversationId: "c",
  };
  const getToken = async () => "";
  const onUnauthorized = () => {};
  const renderChat = (value: typeof provider) => (
    <NativeChat
      config={config}
      provider={value}
      getToken={getToken}
      onUnauthorized={onUnauthorized}
      onConfigure={() => {}}
      onModelSelected={() => {}}
    />
  );
  const { rerender } = render(renderChat(provider));
  fireEvent.change(screen.getByLabelText("聊天输入"), {
    target: { value: "待发送内容" },
  });
  const session = capture.sessions[0];
  rerender(renderChat({ ...provider, apiKey: "second" }));
  expect(capture.sessions).toHaveLength(1);
  expect(session.stop).not.toHaveBeenCalled();
  expect(capture.getProvider?.().apiKey).toBe("second");
  expect(screen.getByLabelText("聊天输入")).toHaveValue("待发送内容");
});

it("displays a bound model and starts a new conversation when another model is chosen", () => {
  capture.executionConfig = {
    credentialSource: "client",
    protocol: "openai-responses",
    baseUrl: "https://model.example",
    model: "bound-model",
  };
  const selected = vi.fn();
  const configure = vi.fn();
  render(
    <NativeChat
      config={{
        ...defaultNativeConfig,
        serverUrl: "https://server.example",
        conversationId: "c",
      }}
      provider={{
        name: "x",
        protocol: "openai-responses",
        baseUrl: "https://model.example",
        apiKey: "key",
        model: "other-model",
        models: ["other-model"],
      }}
      getToken={async () => ""}
      onUnauthorized={() => {}}
      onConfigure={configure}
      onModelSelected={selected}
    />,
  );
  fireEvent.click(screen.getByText("配置"));
  expect(configure).toHaveBeenCalledWith({
    protocol: "openai-responses",
    baseUrl: "https://model.example",
    model: "bound-model",
  });
  expect(screen.getByTestId("model")).toHaveTextContent("bound-model");
  expect(screen.getByTestId("models")).toHaveTextContent(
    "bound-model,other-model",
  );
  fireEvent.click(screen.getByText("选择其他模型"));
  expect(selected).toHaveBeenCalledWith("other-model", true);
});

it("does not render a bare text node when the bound model is empty", async () => {
  capture.executionConfig = { model: "" };
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(
      <NativeChat
        config={{
          ...defaultNativeConfig,
          serverUrl: "https://server.example",
          conversationId: "c",
        }}
        provider={{
          name: "x",
          protocol: "openai-responses",
          baseUrl: "",
          apiKey: "",
          model: "",
          models: [],
        }}
        getToken={async () => ""}
        onUnauthorized={() => {}}
        onConfigure={() => {}}
        onModelSelected={() => {}}
      />,
    );
    await screen.findByTestId("model");
    expect(
      errors.mock.calls.filter((args) =>
        args.some(
          (arg) =>
            typeof arg === "string" &&
            arg.includes("A text node cannot be a child of a <View>"),
        ),
      ),
    ).toEqual([]);
  } finally {
    errors.mockRestore();
  }
});

it("falls back to the server default placeholder when model discovery fails and no local key exists", async () => {
  capture.providerStatus = 503;
  render(
    <NativeChat
      config={{
        ...defaultNativeConfig,
        serverUrl: "https://server.example",
        conversationId: "c",
      }}
      provider={{
        name: "x",
        protocol: "openai-responses",
        baseUrl: "",
        apiKey: "",
        model: "local-model",
        models: ["local-model"],
      }}
      getToken={async () => ""}
      onUnauthorized={() => {}}
      onConfigure={() => {}}
      onModelSelected={() => {}}
    />,
  );
  expect(await screen.findByTestId("model")).toHaveTextContent(
    "服务端默认模型",
  );
  expect(screen.getByTestId("models")).toBeEmptyDOMElement();
});

it("keeps an active run subscribed while provider settings change", () => {
  capture.running = true;
  const provider = {
    name: "x",
    protocol: "openai-responses" as const,
    baseUrl: "",
    apiKey: "old",
    model: "m",
    models: ["m"],
  };
  const config = {
    ...defaultNativeConfig,
    serverUrl: "https://server.example",
    conversationId: "active",
  };
  const getToken = async () => "";
  const onUnauthorized = () => {};
  const renderChat = (value: typeof provider) => (
    <NativeChat
      config={config}
      provider={value}
      getToken={getToken}
      onUnauthorized={onUnauthorized}
      onConfigure={() => {}}
      onModelSelected={() => {}}
    />
  );
  const { rerender } = render(renderChat(provider));
  const active = capture.sessions[0];
  rerender(renderChat({ ...provider, apiKey: "replacement" }));
  expect(capture.sessions).toHaveLength(1);
  expect(active.stop).not.toHaveBeenCalled();
  expect(capture.getProvider?.().apiKey).toBe("replacement");
});
