import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveConversationMessages } from "@/lib/conversation-store";
import { loadProviderConfig } from "@/lib/provider-config";
import { useAntlerRuntime } from "./use-antler-runtime";

const { runtime, subscribe } = vi.hoisted(() => {
  const subscribe = vi.fn();
  return {
    subscribe,
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
  useLocalRuntime: () => runtime,
}));
vi.mock("@/lib/conversation-store", () => ({
  saveConversationMessages: vi.fn().mockResolvedValue(undefined),
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
