import type { ReactNode } from "react";
import type { Root } from "react-dom/client";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureWorkspaceProject,
  getConversation,
  listConversations,
  renameConversation,
  saveConversationMessages,
} from "@/lib/conversation-store";

const captured = vi.hoisted(() => ({
  root: undefined as Root | undefined,
  initialMessages: [] as ThreadMessageLike[][],
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
    AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => children,
    useLocalRuntime: (_adapter: unknown, options: { initialMessages: ThreadMessageLike[] }) => {
      captured.initialMessages.push(options.initialMessages);
      return useMemo(() => ({
        thread: {
          getState: () => ({ messages: options.initialMessages }),
          subscribe: () => () => {},
        },
      }), []);
    },
  };
});
vi.mock("@/components/assistant-ui/thread", () => ({
  AssistantThread: ({ title, model }: { title: string; model: string }) => (
    <><h1>{title}</h1><span data-testid="current-model">{model}</span></>
  ),
}));
vi.mock("@/components/knowledge-configuration-link", () => ({
  KnowledgeConfigurationLink: () => null,
}));
vi.mock("@/lib/workspace-projects", () => ({
  initializeWorkspaceProjects: async () => undefined,
}));

afterEach(async () => {
  await act(async () => captured.root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("New Thread", () => {
  it("starts empty without copying the previous messages or creating a duplicate title", async () => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: "configured-server-model" }),
    }));
    vi.stubGlobal("indexedDB", new IDBFactory());
    const project = await ensureWorkspaceProject("Stock-Analysis", "/srv/workspace/Stock-Analysis");
    const messages: ThreadMessageLike[] = [{ role: "user", content: "上一条会话内容" }];
    await saveConversationMessages("previous-thread", messages, project.id);
    await renameConversation("previous-thread", "上一条会话标题");
    window.history.replaceState(null, "", "/?conversationId=previous-thread");
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);

    await act(async () => { await import("../src/main"); });
    await screen.findByRole("heading", { name: "上一条会话标题" });
    await waitFor(() => expect(screen.getByTestId("current-model"))
      .toHaveTextContent("configured-server-model"));
    const previousRenderCount = captured.initialMessages.length;

    fireEvent.click(screen.getByRole("button", { name: "New Thread" }));
    await screen.findByRole("heading", { name: "New Chat" });

    const newId = new URLSearchParams(window.location.search).get("conversationId")!;
    expect(newId).not.toBe("previous-thread");
    expect(captured.initialMessages.slice(previousRenderCount).length).toBeGreaterThan(0);
    expect(captured.initialMessages.slice(previousRenderCount).every((initial) => initial.length === 0))
      .toBe(true);
    await waitFor(async () => {
      expect(await getConversation(newId)).toBeUndefined();
      expect(await listConversations()).toEqual([
        expect.objectContaining({ id: "previous-thread", title: "上一条会话标题", projectId: project.id }),
      ]);
    });
    expect(document.querySelector('[data-active="true"]')).toHaveTextContent("Stock-Analysis");

    let previousId = newId;
    for (const projectName of ["General", "Stock-Analysis"]) {
      fireEvent.click(screen.getByRole("button", { name: `New Thread in ${projectName}` }));
      await screen.findByRole("heading", { name: "New Chat" });

      const projectThreadId = new URLSearchParams(window.location.search).get("conversationId")!;
      expect(projectThreadId).not.toBe(previousId);
      expect(projectThreadId).not.toBe("previous-thread");
      expect(document.querySelector('[data-active="true"]')).toHaveTextContent(projectName);
      expect(await getConversation(projectThreadId)).toBeUndefined();
      previousId = projectThreadId;
    }
    expect(captured.initialMessages.slice(previousRenderCount).every((initial) => initial.length === 0))
      .toBe(true);
    expect(await listConversations()).toHaveLength(1);
  });
});
