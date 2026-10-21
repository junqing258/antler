import type { ReactNode } from "react";
import type { Root } from "react-dom/client";
import type { ThreadMessageLike } from "@assistant-ui/react";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getConversation,
  listConversations,
  renameConversation,
  saveConversationMessages,
} from "@/lib/conversation-store";

const captured = vi.hoisted(() => ({
  root: undefined as Root | undefined,
  initialMessages: [] as ThreadMessageLike[][],
  pendingSaves: [] as Promise<unknown>[],
}));

vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      captured.root = actual.createRoot(...args);
      return captured.root;
    },
  };
});
vi.mock("@assistant-ui/react", async () => {
  const { useMemo } = await import("react");
  return {
    AssistantRuntimeProvider: ({ children }: { children: ReactNode }) =>
      children,
    useLocalRuntime: (
      _adapter: unknown,
      options: { initialMessages: ThreadMessageLike[] },
    ) => {
      captured.initialMessages.push(options.initialMessages);
      return useMemo(
        () => ({
          thread: {
            getState: () => ({ messages: options.initialMessages }),
            subscribe: () => () => {},
          },
        }),
        [],
      );
    },
  };
});
vi.mock("@/components/assistant-ui/thread", () => ({
  AssistantThread: ({
    title,
    model,
    navigation,
  }: {
    title: string;
    model: string;
    navigation?: ReactNode;
  }) => (
    <>
      {navigation}
      <h1>{title}</h1>
      <span data-testid="current-model">{model}</span>
    </>
  ),
}));
vi.mock("@/components/knowledge-configuration-link", () => ({
  KnowledgeConfigurationLink: () => null,
}));
vi.mock("@/lib/platform-api", () => ({
  platformApi: async () => ({ id: "test-agent", name: "新会话" }),
  agentWorkspace: () => "/srv/workspace",
}));

afterEach(async () => {
  await act(async () => captured.root?.unmount());
  await Promise.all(captured.pendingSaves.splice(0));
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("New Thread", () => {
  it("starts empty without copying the previous messages or creating a duplicate title", async () => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ model: "configured-server-model" }),
      }),
    );
    vi.stubGlobal("indexedDB", new IDBFactory());
    const messages: ThreadMessageLike[] = [
      { role: "user", content: "上一条会话内容" },
    ];
    await saveConversationMessages("previous-thread", messages, "test-agent");
    await renameConversation("previous-thread", "上一条会话标题");
    window.history.replaceState(null, "", "/?conversationId=previous-thread");
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);

    await act(async () => {
      await import("../src/main");
    });
    await screen.findByRole("heading", { name: "上一条会话标题" });
    await waitFor(() =>
      expect(screen.getByTestId("current-model")).toHaveTextContent(
        "configured-server-model",
      ),
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ tasks: [], total: 0, page: 1, limit: 20 })),
    );
    const conversationUrl = window.location.href;
    fireEvent.click(screen.getByRole("button", { name: "定时任务" }));
    await screen.findByRole("dialog", { name: "定时任务" });
    await screen.findByText("暂无定时任务");
    expect(window.location.href).toBe(conversationUrl);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "定时任务" }),
      ).not.toBeInTheDocument(),
    );
    const previousRenderCount = captured.initialMessages.length;

    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    await screen.findByRole("heading", { name: "新会话" });

    const newId = new URLSearchParams(window.location.search).get(
      "conversationId",
    )!;
    expect(newId).not.toBe("previous-thread");
    expect(
      captured.initialMessages.slice(previousRenderCount).length,
    ).toBeGreaterThan(0);
    expect(
      captured.initialMessages
        .slice(previousRenderCount)
        .every((initial) => initial.length === 0),
    ).toBe(true);
    await waitFor(async () => {
      expect(await getConversation(newId)).toBeUndefined();
      expect(await listConversations()).toEqual([
        expect.objectContaining({
          id: "previous-thread",
          title: "上一条会话标题",
          agentId: "test-agent",
        }),
      ]);
    });
    expect(
      captured.initialMessages
        .slice(previousRenderCount)
        .every((initial) => initial.length === 0),
    ).toBe(true);
    expect(await listConversations()).toHaveLength(1);
  });
});

describe("Mobile navigation", () => {
  it("opens and dismisses the drawer, navigates, and restores the desktop sidebar on resize", async () => {
    vi.resetModules();
    localStorage.clear();
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ model: "test-model" }),
      }),
    );
    const listeners = new Set<() => void>();
    const media = {
      matches: true,
      addEventListener: (_event: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) =>
        listeners.delete(listener),
    };
    vi.stubGlobal("matchMedia", () => media);
    const store = await import("@/lib/conversation-store");
    await store.saveConversationMessages("mobile-history", [
      { role: "user", content: "历史消息" },
    ], "test-agent");
    await store.renameConversation("mobile-history", "历史会话");
    const saveMessages = store.saveConversationMessages;
    vi.spyOn(store, "saveConversationMessages").mockImplementation(
      (...args) => {
        const pending = saveMessages(...args);
        captured.pendingSaves.push(pending);
        return pending;
      },
    );
    window.history.replaceState(null, "", "/agents/test-agent");
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    await act(async () => {
      await import("../src/main");
    });

    const trigger = await screen.findByRole("button", { name: "打开导航" });
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    let drawer = await screen.findByRole("dialog", { name: "会话导航" });
    expect(
      within(drawer).getByRole("navigation", { name: "会话历史" }),
    ).toBeVisible();
    expect(
      within(drawer).getByRole("button", { name: "历史会话" }),
    ).toBeVisible();
    expect(within(drawer).queryByText("项目")).not.toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    drawer = await screen.findByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "关闭导航" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(trigger);
    drawer = await screen.findByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "新建会话" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("heading", { name: "新会话" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    drawer = await screen.findByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "历史会话" }));
    await screen.findByRole("heading", { name: "历史会话" });
    expect(
      new URLSearchParams(window.location.search).get("conversationId"),
    ).toBe("mobile-history");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    drawer = await screen.findByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "设置中心" }));
    await screen.findByRole("heading", { name: "设置" });
    expect(
      screen.queryByRole("dialog", { name: "会话导航" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭设置" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    await screen.findByRole("dialog");
    await act(async () => {
      media.matches = false;
      listeners.forEach((listener) => listener());
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "打开导航" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "会话历史" }),
    ).toBeVisible();

    await act(async () => {
      media.matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(screen.getByRole("button", { name: "打开导航" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
