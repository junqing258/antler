import { createElement, StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChatSession } from "../../../src/views/chat/use-chat-session";
import { loadProviderConfig } from "@/lib/provider-config";
const capture = vi.hoisted(() => ({
  change: undefined as ((value: any) => void) | undefined,
  reset: undefined as (() => void) | undefined,
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
  displayMessages: (page: { messages: unknown[] }) => page.messages,
  getMessagePage: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
}));
import {
  getConversation,
  subscribeConversationChanges,
} from "@/lib/conversation-store";
const server = async () => ({ baseUrl: "http://localhost", token: "test" });
const saved = vi.fn();
const mount = () =>
  renderHook(() =>
    useChatSession(
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
it("surfaces credential problems for client-bound conversations without credentials", async () => {
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
  expect(result.current.session.credentialProblem()).toContain("API Key");
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
    useChatSession(server, "thread", "/workspace", () => provider, [], saved),
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
  await waitFor(() =>
    expect(result.current.session.credentialProblem()).toBe(""),
  );
  await act(async () => {
    await result.current.session.send("continue");
  });
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
  const { result } = mount();
  await waitFor(() => expect(result.current.state.ready).toBe(true));
  await act(async () => {
    await result.current.session.send("hello");
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
  const { result } = mount();
  await waitFor(() => expect(result.current.state.running).toBe(true));
  vi.mocked(getConversation).mockResolvedValue({
    id: "thread",
    title: "old",
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    revision: 4,
  });
  await act(async () => capture.change!({ conversationId: "thread" }));
  expect(result.current.state.running).toBe(true);
  await act(async () => result.current.session.cancel());
  expect(fetch).toHaveBeenCalledWith(
    "http://localhost/api/runs/run/cancel",
    expect.objectContaining({ method: "POST" }),
  );
});

it("releases StrictMode's abandoned async effect before it can subscribe", async () => {
  renderHook(
    () =>
      useChatSession(
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
  const { result } = mount();
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
    expect(
      result.current.state.messages.at(-1)?.content.at(-1),
    ).toMatchObject({ text: "实时回复" }),
  );
  // 迟到的旧快照（同 revision、无内容）不能擦除 live 内容
  await act(async () => capture.change!({ conversationId: "thread" }));
  expect(
    result.current.state.messages.at(-1)?.content.at(-1),
  ).toMatchObject({ text: "实时回复" });
  result.current.session.stop();
});
