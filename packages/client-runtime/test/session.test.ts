import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, RunEvent } from "@antler/chat-core";
import { ChatSession, type SessionDependencies } from "../src";

function fixture() {
  let onEvent: ((event: RunEvent) => void) | undefined;
  let onChange:
    ((change: { conversationId: string; type: string }) => void) | undefined;
  const stopRun = vi.fn();
  const stopChanges = vi.fn();
  const post = vi.fn().mockResolvedValue({ ok: true, data: { runId: "run" } });
  const cancel = vi.fn().mockResolvedValue(undefined);
  const deps: SessionDependencies = {
    initialize: vi.fn().mockResolvedValue(undefined),
    listChangesCursor: vi.fn().mockResolvedValue(8),
    getConversation: vi
      .fn()
      .mockResolvedValue({ messages: [], revision: 2, activeRunId: null }),
    getEarlier: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
    subscribeChanges: vi.fn((_cursor, callback) => {
      onChange = callback;
      return stopChanges;
    }),
    subscribeRun: vi.fn((_id, callback) => {
      onEvent = callback;
      return stopRun;
    }),
    prepareSend: vi.fn().mockResolvedValue(post),
    prepareCancel: vi.fn().mockResolvedValue(cancel),
    getProvider: () => ({
      apiKey: "key",
      protocol: "local",
      baseUrl: "new",
      model: "new",
    }),
    createId: () => "same-request",
    delay: vi.fn().mockResolvedValue(undefined),
    onSaved: vi.fn(),
  };
  const session = new ChatSession(
    {
      conversationId: "thread",
      workingDirectory: "/work",
      initialMessages: [],
    },
    deps,
  );
  return {
    session,
    deps,
    post,
    cancel,
    stopRun,
    stopChanges,
    event: (event: RunEvent) => onEvent?.(event),
    change: () => onChange?.({ conversationId: "thread", type: "updated" }),
  };
}

describe("ChatSession", () => {
  it("retries initial loading and establishes the change subscription after a transient failure", async () => {
    const f = fixture();
    vi.mocked(f.deps.listChangesCursor).mockRejectedValueOnce(
      new Error("offline"),
    );
    f.session.start();
    await vi.waitFor(() =>
      expect(f.deps.subscribeChanges).toHaveBeenCalledTimes(1),
    );
    expect(f.deps.initialize).toHaveBeenCalledTimes(2);
    expect(f.deps.delay).toHaveBeenCalledWith(500);
    expect(f.session.getSnapshot().ready).toBe(true);
    f.session.stop();
  });

  it("does not retry initial loading after the session is stopped during backoff", async () => {
    const f = fixture();
    let resume!: () => void;
    vi.mocked(f.deps.initialize).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(f.deps.delay).mockReturnValueOnce(
      new Promise((resolve) => {
        resume = resolve;
      }),
    );
    f.session.start();
    await vi.waitFor(() => expect(f.deps.delay).toHaveBeenCalled());
    expect(f.session.getSnapshot().ready).toBe(false);
    f.session.stop();
    resume();
    await Promise.resolve();
    expect(f.deps.initialize).toHaveBeenCalledTimes(1);
    expect(f.deps.subscribeChanges).not.toHaveBeenCalled();
  });

  it("retries a lost acknowledgement with the same body, restores bound model, and only explicitly cancels", async () => {
    const f = fixture();
    f.deps.getProvider = () => ({
      apiKey: "key",
      protocol: "bound-protocol",
      baseUrl: "bound-url/",
      model: "local-default",
    });
    vi.mocked(f.deps.getConversation).mockResolvedValue({
      messages: [],
      revision: 2,
      executionConfig: {
        credentialSource: "client",
        protocol: "bound-protocol",
        baseUrl: "bound-url",
        model: "bound-model",
      },
    });
    f.session.start();
    await vi.waitFor(() => expect(f.session.getSnapshot().revision).toBe(2));
    f.post.mockRejectedValueOnce(new Error("offline"));
    await f.session.send("hello");
    expect(f.post).toHaveBeenCalledTimes(2);
    expect(f.post.mock.calls[0][0]).toBe(f.post.mock.calls[1][0]);
    expect(JSON.parse(f.post.mock.calls[0][0])).toMatchObject({
      clientRequestId: "same-request",
      expectedRevision: 2,
      provider: {
        protocol: "bound-protocol",
        baseUrl: "bound-url",
        model: "bound-model",
      },
    });
    expect(f.deps.subscribeRun).toHaveBeenCalledWith(
      "run",
      expect.any(Function),
      expect.any(Function),
    );
    await f.session.cancel();
    expect(f.cancel).toHaveBeenCalledWith("run");
    f.session.stop();
    expect(f.stopChanges).toHaveBeenCalled();
    expect(f.stopRun).toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });

  it("replays live events, keeps newer output against a snapshot, and merges earlier pages", async () => {
    const f = fixture();
    const snapshot: ChatMessage = {
      id: "run:assistant",
      role: "assistant",
      content: [],
      runId: "run",
      appliedEventId: 1,
      status: { type: "running" },
    };
    vi.mocked(f.deps.getConversation).mockResolvedValue({
      messages: [snapshot],
      revision: 2,
      activeRunId: "run",
      firstSeq: 10,
      hasMoreMessages: true,
    });
    vi.mocked(f.deps.getEarlier).mockResolvedValue({
      messages: [
        { id: "old", role: "user", content: [{ type: "text", text: "old" }] },
        snapshot,
      ],
      firstSeq: 1,
      hasMore: false,
    });
    f.session.start();
    await vi.waitFor(() => expect(f.deps.subscribeRun).toHaveBeenCalled());
    f.event({ id: 2, type: "assistant.delta", payload: { delta: "live" } });
    f.event({ id: 2, type: "assistant.delta", payload: { delta: "live" } });
    f.change();
    await vi.waitFor(() =>
      expect(f.deps.getConversation).toHaveBeenCalledTimes(2),
    );
    await f.session.loadEarlier();
    expect(f.session.getSnapshot().messages.map((item) => item.id)).toEqual([
      "old",
      "run:assistant",
    ]);
    expect(f.session.getSnapshot().messages[1].content).toEqual([
      { type: "text", text: "live" },
    ]);
    expect(f.deps.getEarlier).toHaveBeenCalledWith("thread", 10);
    f.session.stop();
  });

  it("discards responses and subscriptions from a stopped generation", async () => {
    const f = fixture();
    let release!: (value: {
      messages: ChatMessage[];
      revision: number;
    }) => void;
    vi.mocked(f.deps.getConversation).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    f.session.start();
    await vi.waitFor(() => expect(f.deps.getConversation).toHaveBeenCalled());
    f.session.stop();
    release({
      messages: [{ id: "old", role: "user", content: [] }],
      revision: 5,
    });
    await Promise.resolve();
    expect(f.session.getSnapshot().messages).toEqual([]);
    expect(f.deps.subscribeChanges).not.toHaveBeenCalled();
    f.session.start();
    await vi.waitFor(() => expect(f.session.getSnapshot().revision).toBe(2));
    expect(f.session.getSnapshot().messages).toEqual([]);
    f.session.stop();
  });

  it("does not retry or apply a late send acknowledgement after disposal", async () => {
    const f = fixture();
    let reject!: (error: Error) => void;
    f.post.mockReturnValueOnce(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
    );
    f.session.start();
    await vi.waitFor(() => expect(f.session.getSnapshot().revision).toBe(2));
    const pending = f.session.send("hello");
    await vi.waitFor(() => expect(f.post).toHaveBeenCalledTimes(1));
    f.session.stop();
    reject(new Error("connection lost"));
    await pending;
    expect(f.post).toHaveBeenCalledTimes(1);
    expect(f.deps.delay).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().messages).toEqual([]);
    expect(f.deps.onSaved).not.toHaveBeenCalled();
  });

  it("blocks sending while the authoritative context is unavailable", async () => {
    const f = fixture();
    vi.mocked(f.deps.getConversation).mockResolvedValue({
      messages: [],
      revision: 1,
      contextState: "unavailable",
      contextReason: "上下文不可用",
    });
    f.session.start();
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().contextReason).toBe("上下文不可用"),
    );
    await f.session.send("hello");
    expect(f.deps.prepareSend).not.toHaveBeenCalled();
    f.session.stop();
  });

  it("does not send a pending cancellation after the session is stopped", async () => {
    const f = fixture();
    vi.mocked(f.deps.getConversation).mockResolvedValue({
      messages: [],
      revision: 1,
      activeRunId: "run",
    });
    let release!: (cancel: (runId: string) => Promise<void>) => void;
    vi.mocked(f.deps.prepareCancel).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    f.session.start();
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().activeRunId).toBe("run"),
    );
    const pending = f.session.cancel();
    f.session.stop();
    release(f.cancel);
    await pending;
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it("requires matching local credentials and continues the same bound conversation", async () => {
    const f = fixture();
    let provider = {
      apiKey: "",
      protocol: "openai-responses",
      baseUrl: "https://other.example",
      model: "local-default",
    };
    f.deps.getProvider = () => provider;
    vi.mocked(f.deps.getConversation).mockResolvedValue({
      messages: [
        {
          id: "history",
          role: "user",
          content: [{ type: "text", text: "previous" }],
        },
      ],
      revision: 4,
      executionConfig: {
        credentialSource: "client",
        protocol: "anthropic-messages",
        baseUrl: "https://bound.example/v1",
        model: "bound-model",
      },
    });
    f.session.start();
    await vi.waitFor(() => expect(f.session.getSnapshot().ready).toBe(true));
    expect(f.session.getSnapshot().messages[0].id).toBe("history");
    expect(f.session.credentialProblem()).toContain("API Key");
    await f.session.send("test");
    expect(f.post).not.toHaveBeenCalled();
    provider = { ...provider, apiKey: "key" };
    f.session.providerChanged();
    expect(f.session.credentialProblem()).toContain("不匹配");
    await f.session.send("test");
    expect(f.post).not.toHaveBeenCalled();
    provider = {
      ...provider,
      protocol: "anthropic-messages",
      baseUrl: "https://bound.example/v1/",
    };
    f.session.providerChanged();
    expect(f.session.credentialProblem()).toBe("");
    await f.session.send("continue");
    expect(JSON.parse(f.post.mock.calls[0][0])).toMatchObject({
      conversationId: "thread",
      provider: {
        protocol: "anthropic-messages",
        baseUrl: "https://bound.example/v1",
        model: "bound-model",
        apiKey: "key",
      },
    });
    expect(f.post).toHaveBeenCalledTimes(1);
    f.session.stop();
  });

  it("keeps server credentials independent of the current device", async () => {
    const f = fixture();
    f.deps.getProvider = () => ({
      apiKey: "",
      protocol: "different",
      baseUrl: "",
    });
    vi.mocked(f.deps.getConversation).mockResolvedValue({
      messages: [],
      revision: 1,
      executionConfig: { credentialSource: "server" },
    });
    f.session.start();
    await vi.waitFor(() => expect(f.session.getSnapshot().ready).toBe(true));
    await f.session.send("hello");
    expect(JSON.parse(f.post.mock.calls[0][0])).not.toHaveProperty("provider");
    f.session.stop();
  });

  it("restores a running conversation even when its client credential is absent", async () => {
    const f = fixture();
    f.deps.getProvider = () => ({
      apiKey: "",
      protocol: "openai-responses",
      baseUrl: "",
    });
    vi.mocked(f.deps.getConversation).mockResolvedValue({
      messages: [],
      revision: 1,
      activeRunId: "run",
      executionConfig: {
        credentialSource: "client",
        protocol: "openai-responses",
        baseUrl: "",
        model: "bound",
      },
    });
    f.session.start();
    await vi.waitFor(() => expect(f.deps.subscribeRun).toHaveBeenCalled());
    f.event({ id: 1, type: "assistant.delta", payload: { delta: "恢复中" } });
    expect(f.session.getSnapshot().messages[0].content).toEqual([
      { type: "text", text: "恢复中" },
    ]);
    expect(f.session.credentialProblem()).toContain("API Key");
    f.session.stop();
  });

  it("blocks sending until the initial configuration has loaded", async () => {
    const f = fixture();
    let release!: (value: undefined) => void;
    vi.mocked(f.deps.getConversation).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    f.session.start();
    await vi.waitFor(() => expect(f.deps.getConversation).toHaveBeenCalled());
    await f.session.send("too early");
    expect(f.post).not.toHaveBeenCalled();
    release(undefined);
    await vi.waitFor(() => expect(f.session.getSnapshot().ready).toBe(true));
    await f.session.send("ready");
    expect(f.post).toHaveBeenCalledTimes(1);
    f.session.stop();
  });

  it("waits for platform configuration hydration before contacting the server", async () => {
    const f = fixture();
    let finish!: () => void;
    vi.mocked(f.deps.initialize).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    f.session.start();
    await f.session.send("too early");
    expect(f.deps.listChangesCursor).not.toHaveBeenCalled();
    expect(f.post).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(f.session.getSnapshot().ready).toBe(true));
    expect(f.deps.listChangesCursor).toHaveBeenCalledTimes(1);
    f.session.stop();
  });

  it("surfaces credential_required until the provider configuration changes", async () => {
    const f = fixture();
    f.session.start();
    await vi.waitFor(() => expect(f.session.getSnapshot().ready).toBe(true));
    f.post.mockResolvedValueOnce({
      ok: false,
      data: { error: "credential_required" },
    });
    await f.session.send("hello");
    expect(f.session.credentialProblem()).toContain("模型凭据");
    await f.session.send("blocked");
    expect(f.post).toHaveBeenCalledTimes(1);
    f.session.providerChanged();
    expect(f.session.credentialProblem()).toBe("");
    f.session.stop();
  });
});
