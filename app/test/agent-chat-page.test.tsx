import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AgentChatPage } from "@/views/platform/agent-chat";
import { platformApi } from "@/lib/platform-api";

vi.mock("@/lib/platform-api", () => ({ platformApi: vi.fn() }));
vi.mock("@/views/chat", () => ({ ChatView: () => <p>Agent conversation</p> }));
afterEach(cleanup);

function mount() {
  render(
    <MemoryRouter initialEntries={["/agents/example"]}>
      <Routes>
        <Route path="/agents/:id" element={<AgentChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

it("does not show home navigation while loading a directly opened Agent", async () => {
  let resolveAgent!: (agent: unknown) => void;
  vi.mocked(platformApi).mockReturnValue(new Promise((resolve) => { resolveAgent = resolve; }));
  mount();
  expect(screen.getByRole("status")).toHaveTextContent("正在加载");
  expect(screen.queryByRole("navigation", { name: "平台导航" })).not.toBeInTheDocument();
  resolveAgent({ id: "example", name: "Example" });
  expect(await screen.findByText("Agent conversation")).toBeInTheDocument();
});

it("shows an error and return link without home navigation when loading fails", async () => {
  vi.mocked(platformApi).mockRejectedValue(new Error("Agent unavailable"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Agent unavailable");
  expect(screen.getByRole("link", { name: "返回 Agent 列表" })).toHaveAttribute("href", "/");
  expect(screen.queryByRole("navigation", { name: "平台导航" })).not.toBeInTheDocument();
});
