import { useEffect, useState, useSyncExternalStore } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedThread } from "../src/views/chat/shared-thread";
import {
  ChatSession,
  type SessionDependencies,
} from "@antler/client-runtime";

afterEach(cleanup);

function fixture(overrides: Partial<SessionDependencies> = {}) {
  const post = vi.fn().mockResolvedValue({ ok: true, data: { runId: "run" } });
  const deps: SessionDependencies = {
    initialize: vi.fn().mockResolvedValue(undefined),
    listChangesCursor: vi.fn().mockResolvedValue(8),
    getConversation: vi
      .fn()
      .mockResolvedValue({ messages: [], revision: 2, activeRunId: null }),
    getEarlier: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
    subscribeChanges: vi.fn(() => () => {}),
    subscribeRun: vi.fn(() => () => {}),
    prepareSend: vi.fn().mockResolvedValue(post),
    prepareCancel: vi.fn().mockResolvedValue(undefined),
    getProvider: () => ({
      apiKey: "key",
      protocol: "local",
      baseUrl: "new",
      model: "new",
    }),
    createId: () => "same-request",
    delay: vi.fn().mockResolvedValue(undefined),
    onSaved: vi.fn(),
    ...overrides,
  };
  return { deps, post };
}

function Harness({
  deps,
  model = "m-a",
  models = ["m-a", "m-b"],
  onModelChange,
}: {
  deps: SessionDependencies;
  model?: string;
  models?: string[];
  onModelChange: (model: string) => void;
}) {
  const [session] = useState(
    () =>
      new ChatSession(
        {
          conversationId: "thread",
          workingDirectory: "/work",
          initialMessages: [],
        },
        deps,
      ),
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);
  return (
    <SharedThread
      session={session}
      state={state}
      model={model}
      models={models}
      onModelChange={onModelChange}
    />
  );
}

describe("shared chat view on the web host", () => {
  it("shows the welcome state and sends through the shared session", async () => {
    const onModelChange = vi.fn();
    const { deps, post } = fixture();
    render(
      <Harness
        deps={deps}
        onModelChange={onModelChange}
      />,
    );
    await vi.waitFor(() =>
      expect(screen.getByText("今天我能帮你做什么？")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "选择模型" })).toBeEnabled();
    const input = screen.getByRole("textbox", { name: "消息" });
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post.mock.calls[0][0]).toContain("你好");
    await vi.waitFor(() =>
      expect(screen.getByText("你好")).toBeInTheDocument(),
    );
    // 欢迎分支切换为列表分支后是新的输入框；运行中草稿应已清空并切换为停止
    const activeInput = screen.getByRole("textbox", { name: "消息" });
    expect(activeInput).not.toBe(input);
    expect(activeInput).toHaveValue("");
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();
  });

  it("loads earlier messages through the shared session", async () => {
    const { deps } = fixture({
      getConversation: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "m1",
            role: "user" as const,
            content: [{ type: "text" as const, text: "旧消息" }],
          },
        ],
        revision: 2,
        activeRunId: null,
        hasMoreMessages: true,
      }),
    });
    render(
      <Harness deps={deps} models={[]} onModelChange={vi.fn()} />,
    );
    await vi.waitFor(() =>
      expect(screen.getByText("旧消息")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }));
    await vi.waitFor(() => expect(deps.getEarlier).toHaveBeenCalledOnce());
  });

  it("offers model selection through the shared picker", async () => {
    const onModelChange = vi.fn();
    const { deps } = fixture();
    render(<Harness deps={deps} onModelChange={onModelChange} />);
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "选择模型" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    fireEvent.click(screen.getByRole("button", { name: "m-b" }));
    expect(onModelChange).toHaveBeenCalledWith("m-b");
  });
});
