import { createElement, StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ExternalStoreAdapter,
  ThreadMessageLike,
} from "@assistant-ui/react";
import { useAntlerRuntime } from "../../../src/components/assistant-ui/use-antler-runtime";
import { loadProviderConfig } from "@/lib/provider-config";
const capture = vi.hoisted(() => ({
  adapter: undefined as ExternalStoreAdapter<ThreadMessageLike> | undefined,
  change: undefined as ((value: any) => void) | undefined,
}));
vi.mock("@assistant-ui/react", () => ({
  useExternalStoreRuntime: (
    adapter: ExternalStoreAdapter<ThreadMessageLike>,
  ) => {
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
it("retries a lost acknowledgement with an identical idempotency key", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError("network"));
  mount();
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
        metadata: { custom: { runId: "run", appliedEventId: 1 } },
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
