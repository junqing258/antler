import { createElement, StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExternalStoreAdapter } from "@assistant-ui/react";
import type { ChatMessage } from "@antler/chat-core";
import { useAntlerRuntime } from "../../../src/components/assistant-ui/use-antler-runtime";
import { loadProviderConfig } from "@/lib/provider-config";
const capture = vi.hoisted(() => ({
  adapter: undefined as ExternalStoreAdapter<ChatMessage> | undefined,
  change: undefined as ((value: any) => void) | undefined,
  reset: undefined as (() => void) | undefined,
}));
vi.mock("@assistant-ui/react", () => ({
  useExternalStoreRuntime: (adapter: ExternalStoreAdapter<ChatMessage>) => {
    capture.adapter = adapter;
    return {};
  },
}));
vi.mock("@/lib/conversation-store", () => ({
  listConversationPage: vi.fn().mockResolvedValue({ lastChangeId: 0 }),
  getConversation: vi.fn().mockResolvedValue(undefined),
  subscribeConversationChanges: vi.fn(
    (_cursor: number, callback: (change: any) => void) => {
      capture.change = callback;
      return vi.fn();
    },
  ),
  subscribeConversationSessionReset: vi.fn((callback: () => void) => {
    capture.reset = callback;
    return vi.fn();
  }),
}));
import {
  getConversation,
  subscribeConversationChanges,
} from "@/lib/conversation-store";
const server = async () => ({ baseUrl: "http://localhost", token: "test" });
const saved = vi.fn();
const mount = () =>
  renderHook(() =>
    useAntlerRuntime(
      server,
      "thread",
      "/srv/workspace",
      loadProviderConfig,
      [],
      saved,
    ),
  );
beforeEach(() => {
  vi.mocked(getConversation).mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("{}", { status: 202 })),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("does not upload messages or cancel runs on unmount", async () => {
  const { unmount } = mount();
  await waitFor(() => expect(getConversation).toHaveBeenCalled());
  unmount();
  expect(fetch).not.toHaveBeenCalled();
});
it("stops a run subscription immediately when the account session resets", async () => {
  vi.mocked(getConversation).mockResolvedValue({
    id: "thread",
    title: "t",
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    revision: 1,
    activeRunId: "run",
  });
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  vi.mocked(fetch).mockResolvedValue(new Response(stream));
  mount();
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/events"),
      expect.anything(),
    ),
  );
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal;
  act(() => capture.reset!());
  expect(signal.aborted).toBe(true);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).endsWith("/cancel")),
  ).toBe(false);
});
it("disables the composer when a client-bound conversation lacks credentials", async () => {
  vi.mocked(getConversation).mockResolvedValue({
    id: "thread",
    title: "t",
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    revision: 1,
    executionConfig: {
      credentialSource: "client",
      protocol: "anthropic-messages",
      baseUrl: "https://bound.example",
      model: "bound-model",
    },
  });
  const { result } = mount();
  await waitFor(() =>
    expect(result.current.credentialNotice).toContain("API Key"),
  );
  expect(capture.adapter?.isSendDisabled).toBe(true);
  expect(result.current.boundCredential).toEqual({
    protocol: "anthropic-messages",
    baseUrl: "https://bound.example",
    model: "bound-model",
  });
});
it("continues the bound conversation after matching credentials are configured", async () => {
  vi.mocked(getConversation).mockResolvedValue({
    id: "thread",
    title: "t",
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    revision: 1,
    executionConfig: {
      credentialSource: "client",
      protocol: "anthropic-messages",
      baseUrl: "https://bound.example",
      model: "bound-model",
    },
  });
  let provider = { ...loadProviderConfig(), apiKey: "" };
  const { result, rerender } = renderHook(() =>
    useAntlerRuntime(server, "thread", "/workspace", () => provider, [], saved),
  );
  await waitFor(() =>
    expect(result.current.credentialNotice).toContain("API Key"),
  );
  provider = {
    ...provider,
    apiKey: "matching-key",
    protocol: "anthropic-messages",
    baseUrl: "https://bound.example/",
    model: "local-default",
  };
  rerender();
  await waitFor(() => expect(capture.adapter?.isSendDisabled).toBe(false));
  expect(result.current.credentialNotice).toBe("");
  await act(async () =>
    capture.adapter!.onNew({
      role: "user",
      content: [{ type: "text", text: "continue" }],
      parentId: null,
      sourceId: null,
      attachments: [],
    } as any),
  );
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
  expect(body).toMatchObject({
    conversationId: "thread",
    provider: {
      apiKey: "matching-key",
      protocol: "anthropic-messages",
      baseUrl: "https://bound.example",
      model: "bound-model",
    },
  });
});
it("retries a lost acknowledgement with an identical idempotency key", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError("network"));
  mount();
  await waitFor(() => expect(capture.adapter?.isSendDisabled).toBe(false));
  await act(async () => {
    await capture.adapter!.onNew({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      parentId: null,
      sourceId: null,
      attachments: [],
    } as any);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBe(
    vi.mocked(fetch).mock.calls[1][1]?.body,
  );
});
it("rejects old snapshots and only cancels on an explicit stop", async () => {
  vi.mocked(getConversation).mockResolvedValue({
    id: "thread",
    title: "t",
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    revision: 5,
    activeRunId: "run",
  });
  mount();
  await waitFor(() => expect(capture.adapter?.isRunning).toBe(true));
  vi.mocked(getConversation).mockResolvedValue({
    id: "thread",
    title: "old",
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    revision: 4,
  });
  await act(async () => capture.change!({ conversationId: "thread" }));
  expect(capture.adapter?.isRunning).toBe(true);
  await act(async () => capture.adapter!.onCancel!());
  expect(fetch).toHaveBeenCalledWith(
    "http://localhost/api/runs/run/cancel",
    expect.objectContaining({ method: "POST" }),
  );
});

it("releases StrictMode's abandoned async effect before it can subscribe", async () => {
  renderHook(
    () =>
      useAntlerRuntime(
        server,
        "thread",
        "/srv/workspace",
        loadProviderConfig,
        [],
        saved,
      ),
    { wrapper: ({ children }) => createElement(StrictMode, null, children) },
  );
  await waitFor(() =>
    expect(subscribeConversationChanges).toHaveBeenCalledTimes(1),
  );
});

it("shows live replies before disk flush and does not replace them with stale snapshots", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const snapshot = {
    id: "thread",
    title: "t",
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    activeRunId: "run",
    executionConfig: { credentialSource: "server" },
    messages: [
      {
        id: "run:assistant",
        role: "assistant" as const,
        content: [],
        status: { type: "running" as const },
        runId: "run",
        appliedEventId: 1,
      },
    ],
  };
  vi.mocked(getConversation).mockResolvedValue(snapshot);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
  const { unmount } = mount();
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/runs/run/events"),
      expect.anything(),
    ),
  );
  const encoder = new TextEncoder();
  await act(async () =>
    controller.enqueue(
      encoder.encode(
        'id: 2\nevent: assistant.delta\ndata: {"delta":"实时回复"}\n\n',
      ),
    ),
  );
  await waitFor(() =>
    expect(capture.adapter?.messages?.[0].content).toEqual([
      { type: "text", text: "实时回复" },
    ]),
  );
  await act(async () => capture.change!({ conversationId: "thread" }));
  expect(capture.adapter?.messages?.[0].content).toEqual([
    { type: "text", text: "实时回复" },
  ]);
  await act(async () =>
    controller.enqueue(
      encoder.encode(
        'id: 3\nevent: run.failed\ndata: {"error":{"message":"403 Access to model denied"}}\n\n',
      ),
    ),
  );
  await waitFor(() => expect(capture.adapter?.isRunning).toBe(false));
  expect(capture.adapter?.messages?.[0].status).toMatchObject({
    type: "incomplete",
    reason: "error",
    error: expect.stringContaining("403"),
  });
  unmount();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).endsWith("/cancel")),
  ).toBe(false);
});

it("adapts domain messages for the old interface without dropping tool data", async () => {
  mount();
  await waitFor(() => expect(capture.adapter).toBeDefined());
  const message: ChatMessage = {
    id: "run:assistant",
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "step",
        toolName: "read",
        args: { path: "a", options: { recursive: true } },
        argsText: "{}",
        result: { output: "done" },
        isError: true,
      },
      { type: "unknown", value: { type: "future" } },
    ],
    runId: "run",
    appliedEventId: 5,
  };
  expect(capture.adapter!.convertMessage(message, 0)).toMatchObject({
    metadata: { custom: { runId: "run", appliedEventId: 5 } },
    content: [
      {
        type: "tool-call",
        args: { path: "a", options: { recursive: true } },
        result: { output: "done" },
        isError: true,
      },
      { type: "text", text: "[不支持的消息内容]" },
    ],
  });
});
