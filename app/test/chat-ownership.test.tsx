import {
  useParams,
  MemoryRouter,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  getConversation,
} from "@/lib/conversation-store";
import { installConversationFixture, saveConversationMessages } from "./conversation-fixture";
import { ChatView } from "@/views/chat";
import type { ComponentProps } from "react";
import type { Chat } from "@/views/chat/chat";
vi.mock("@/views/chat/chat", () => ({
  Chat: (props: ComponentProps<typeof Chat>) => (
    <section>
      <h1>{props.conversationId}</h1>
      <div data-testid="messages">{JSON.stringify(props.initialMessages)}</div>
      <div data-testid="agent">{props.agentId ?? "ordinary"}</div>
      <div data-testid="conversations">
        {props.conversations.map((c) => c.id).join(",")}
      </div>
      <button onClick={() => props.onNewThread()}>新建会话</button>
    </section>
  ),
}));
vi.mock("@/lib/server-info", () => ({
  serverInfo: async () => ({ baseUrl: "", token: "" }),
  authHeaders: () => ({}),
}));
function AgentRoute() {
  const { id } = useParams();
  return <ChatView key={id} agentId={id!} />;
}
function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Link to="/agents/B">Agent B</Link>
      <Location />
      <Routes>
        <Route path="/agents/:id" element={<AgentRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  installConversationFixture();
  for (const [id, agent] of [
    ["ordinary-thread", undefined],
    ["A-thread", "A"],
    ["B-thread", "B"],
  ] as const)
    await saveConversationMessages(
      id,
      [{ role: "user", content: `${id} history` }],
      agent,
    );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("conversation Agent ownership", () => {
  it("shows an accessible loading state until the conversation is ready", async () => {
    const fetchFixture = globalThis.fetch;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).includes("/api/conversations/A-thread")) await pending;
      return fetchFixture(...args);
    }));

    mount("/agents/A?conversationId=A-thread");
    expect(screen.getByText("正在加载会话…")).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("messages")).not.toBeInTheDocument();
    await act(async () => { release(); });
    await screen.findByRole("heading", { name: "A-thread" });
    expect(screen.queryByText("正在加载会话…")).not.toBeInTheDocument();
  });

  it("allows retrying a failed conversation load", async () => {
    const fetchFixture = globalThis.fetch;
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => {
      if (fail && String(args[0]).includes("/api/conversations/A-thread")) {
        throw new Error("offline");
      }
      return fetchFixture(...args);
    }));

    mount("/agents/A?conversationId=A-thread");
    expect(await screen.findByRole("alert")).toHaveTextContent("历史加载失败");
    expect(screen.queryByText("正在加载会话…")).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "A-thread" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("discards an unrelated conversation URL without rebinding or exposing its messages", async () => {
    mount("/agents/A?conversationId=B-thread");
    await waitFor(() =>
      expect(screen.getByTestId("agent")).toHaveTextContent("A"),
    );
    expect(screen.getByTestId("messages")).not.toHaveTextContent(
      "B-thread history",
    );
    expect(screen.getByTestId("conversations")).toHaveTextContent("A-thread");
    expect(screen.getByTestId("conversations")).not.toHaveTextContent(
      "B-thread",
    );
    expect((await getConversation("B-thread"))?.agentId).toBe("B");
  });
  it("resets the conversation ID and messages when switching between Agents", async () => {
    mount("/agents/A?conversationId=A-thread");
    await screen.findByRole("heading", { name: "A-thread" });
    fireEvent.click(screen.getByRole("link", { name: "Agent B" }));
    await waitFor(() =>
      expect(screen.getByTestId("agent")).toHaveTextContent("B"),
    );
    expect(
      screen.queryByRole("heading", { name: "A-thread" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("messages")).toHaveTextContent("[]");
  });
  it("persists Agent association once and never rebinds existing conversations", async () => {
    await saveConversationMessages(
      "new-agent-thread",
      [{ role: "user", content: "new" }],
      "A",
    );
    await saveConversationMessages(
      "new-agent-thread",
      [{ role: "user", content: "another save" }],
      "B",
    );
    expect((await getConversation("new-agent-thread"))?.agentId).toBe("A");
    await saveConversationMessages(
      "ordinary-thread",
      [{ role: "user", content: "keep ordinary" }],
      "A",
    );
    expect((await getConversation("ordinary-thread"))?.agentId).toBeUndefined();
  });
});
