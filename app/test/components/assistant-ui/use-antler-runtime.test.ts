import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatModelAdapter } from "@assistant-ui/react";
import { saveConversationMessages, saveGeneratedConversationTitle } from "@/lib/conversation-store";
import { loadProviderConfig } from "@/lib/provider-config";
import { useAntlerRuntime } from "../../../src/components/assistant-ui/use-antler-runtime";

const { runtime, subscribe, captureAdapter } = vi.hoisted(() => {
  const subscribe = vi.fn();
  return {
    subscribe,
    captureAdapter: vi.fn(),
    runtime: {
      thread: {
        getState: () => ({
          messages: [{ role: "user", content: "分析股票" }],
        }),
        subscribe,
      },
    },
  };
});

vi.mock("@assistant-ui/react", () => ({
  useLocalRuntime: (adapter: ChatModelAdapter) => {
    captureAdapter(adapter);
    return runtime;
  },
}));
vi.mock("@/lib/conversation-store", () => ({
  saveConversationMessages: vi.fn().mockResolvedValue(undefined),
  saveGeneratedConversationTitle: vi.fn().mockResolvedValue(undefined),
}));

const getServerInfo = async () => ({ baseUrl: "http://localhost:3210", token: "test" });
const onConversationSaved = vi.fn();
const projectId = "workspace:Stock-Analysis";

describe("runtime conversation project persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    subscribe.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each(["debounce", "unmount"])("passes the selected project on %s saves", async (trigger) => {
    const { unmount } = renderHook(() => useAntlerRuntime(
      getServerInfo,
      "stock-thread",
      projectId,
      "/srv/antler/workspace/Stock-Analysis",
      loadProviderConfig,
      [],
      onConversationSaved,
    ));

    if (trigger === "unmount") {
      unmount();
    } else {
      act(() => subscribe.mock.calls[0][0]());
      await act(() => vi.advanceTimersByTimeAsync(250));
    }

    expect(saveConversationMessages).toHaveBeenCalledWith(
      "stock-thread",
      [{ role: "user", content: "分析股票" }],
      projectId,
    );
  });
});

describe("AI conversation titles", () => {
  beforeEach(() => {
    subscribe.mockReturnValue(vi.fn());
    vi.mocked(saveConversationMessages).mockResolvedValue({
      id: "title-thread", projectId, title: "分析股票", messages: [],
      createdAt: 1, updatedAt: 1,
    });
    vi.mocked(saveGeneratedConversationTitle).mockResolvedValue({
      id: "title-thread", projectId, title: "股票投资分析", messages: [],
      createdAt: 1, updatedAt: 1, isTitleGenerated: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function reply(message = "分析股票") {
    renderHook(() => useAntlerRuntime(
      getServerInfo, "title-thread", projectId, "", loadProviderConfig, [], onConversationSaved,
    ));
    const adapter = captureAdapter.mock.lastCall![0] as ChatModelAdapter;
    const results = [];
    const output = adapter.run({
      messages: [{ role: "user", content: [{ type: "text", text: message }] }],
      abortSignal: new AbortController().signal,
    } as unknown as Parameters<ChatModelAdapter["run"]>[0]);
    if (!(Symbol.asyncIterator in output)) throw new Error("Expected a streaming adapter");
    for await (const result of output) results.push(result);
    return results;
  }

  function mockFetch(event = "run.completed", titleResponse: Promise<Response> | Response = Response.json({ title: "股票投资分析" })) {
    const stream = `event: assistant.delta\ndata: {"delta":"分析结果"}\n\nevent: ${event}\ndata: {}\n\n`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ eventsUrl: "/events", runId: "run-1" }))
      .mockResolvedValueOnce(new Response(stream))
      .mockImplementationOnce(() => titleResponse);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("finishes the reply while the title is pending and refreshes history when it arrives", async () => {
    let resolveTitle!: (response: Response) => void;
    const fetchMock = mockFetch("run.completed", new Promise((resolve) => { resolveTitle = resolve; }));
    expect(await reply()).toContainEqual({ content: [{ type: "text", text: "分析结果" }] });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.lastCall).toEqual([
      "http://localhost:3210/api/runs/run-1/title",
      expect.objectContaining({ method: "POST", headers: { "x-antler-token": "test" } }),
    ]);
    expect(saveGeneratedConversationTitle).not.toHaveBeenCalled();
    resolveTitle(Response.json({ title: "股票投资分析" }));
    await vi.waitFor(() => expect(saveGeneratedConversationTitle).toHaveBeenCalledWith("title-thread", "股票投资分析"));
    expect(onConversationSaved).toHaveBeenCalledTimes(2);
  });

  it.each(["manual", "generated", "deleted"])("skips title requests for a %s conversation", async (state) => {
    const fetchMock = mockFetch();
    if (state === "deleted") vi.mocked(saveConversationMessages).mockResolvedValue(undefined);
    else vi.mocked(saveConversationMessages).mockResolvedValue({
      id: "title-thread", projectId, title: "保留标题", messages: [], createdAt: 1, updatedAt: 1,
      isTitleManuallySet: state === "manual", isTitleGenerated: state === "generated",
    });
    await reply();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saveGeneratedConversationTitle).not.toHaveBeenCalled();
  });

  it.each(["run.failed", "run.cancelled"])("does not generate titles for %s", async (event) => {
    const fetchMock = mockFetch(event);
    await reply();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saveGeneratedConversationTitle).not.toHaveBeenCalled();
  });

  it("skips context compaction", async () => {
    const fetchMock = mockFetch();
    await reply("/compact");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the reply and fallback title when generation fails, then retries on the next reply", async () => {
    mockFetch("run.completed", new Response(null, { status: 503 }));
    expect(await reply()).toHaveLength(1);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(saveGeneratedConversationTitle).not.toHaveBeenCalled();
    mockFetch();
    await reply();
    await vi.waitFor(() => expect(saveGeneratedConversationTitle).toHaveBeenCalledWith("title-thread", "股票投资分析"));
  });
});
