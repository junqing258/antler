import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentListPage } from "@/views/platform/agent-list";
import { AgentEditPage } from "@/views/platform/agent-edit";
import { SkillLibraryPage } from "@/views/platform/skill-library";
import { platformApi } from "@/lib/platform-api";
import { getConversation } from "@/lib/conversation-store";
vi.mock("@/lib/platform-api", () => ({
  platformApi: vi.fn(),
  agentWorkspace: () => "",
}));
vi.mock("@/lib/conversation-store", () => ({
  listConversations: async () => [],
  getConversation: vi.fn().mockResolvedValue(undefined),
}));
const api = vi.mocked(platformApi);
const skill = {
  id: "skill-uuid",
  name: "example",
  description: "Skill description",
  state: "ready",
  bindable: true,
  editable: true,
  fileCount: 2,
  sizeBytes: 512,
  createdAt: new Date().toISOString(),
};
const agent = {
  id: "agent-id",
  ownerId: "owner",
  name: "Research",
  description: "Research helper",
  systemPrompt: "Investigate",
  status: "draft",
  editable: true,
  skills: [],
  _count: { skills: 0 },
};
beforeEach(() => {
  localStorage.clear();
  api.mockReset();
  vi.mocked(getConversation).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
});
function mount(page: React.ReactNode, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={page} />
        <Route path="/chat" element={page} />
        <Route path="/agents/:id" element={<p>Bound Agent conversation</p>} />
        <Route path="/agents/:id/edit" element={page} />
      </Routes>
    </MemoryRouter>,
  );
}
describe("Agent platform pages", () => {
  it("opens profile and settings from the home navigation and persists configuration", async () => {
    api.mockResolvedValue({ agents: [] });
    mount(<AgentListPage />);
    await screen.findByText(/还没有 Agent/);
    fireEvent.click(screen.getByRole("button", { name: "用户信息" }));
    expect(screen.getByRole("tab", { name: "个人资料" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "关闭设置" }));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("tab", { name: "供应商配置" })).toHaveAttribute("aria-selected", "true");
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }), { target: { value: "My provider" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(screen.queryByRole("heading", { name: "设置" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue("My provider");
    expect(JSON.parse(localStorage.getItem("antler.provider-config.v1")!)).toMatchObject({ name: "My provider" });
  });

  it("automatically fills and stores the generated workspace after creation", async () => {
    const defaultWorkspace = "/workspace/agents/agent-agent-id";
    api.mockImplementation(async (path) =>
      path === "/skills" ? { skills: [] } : { ...agent, defaultWorkspace },
    );
    mount(<AgentEditPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled());
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }), { target: { value: "Research" } });
    fireEvent.change(screen.getByRole("textbox", { name: "描述" }), { target: { value: "Research helper" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: /默认工作目录/ })).toHaveValue(defaultWorkspace));
    expect(localStorage.getItem("antler.agent.workspace.agent-id")).toBe(defaultWorkspace);
  });

  it("restores a bound conversation from the legacy chat URL", async () => {
    vi.mocked(getConversation).mockResolvedValue({
      id: "old", agentId: "bound", title: "Old", messages: [], createdAt: 1, updatedAt: 1,
    });
    mount(<AgentListPage />, "/chat?conversationId=old");
    expect(await screen.findByText("Bound Agent conversation")).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });
  it("returns unbound legacy chat URLs to the Agent list", async () => {
    api.mockResolvedValue({ agents: [] });
    mount(<AgentListPage />, "/chat?conversationId=unbound");
    expect(await screen.findByText(/还没有 Agent/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "普通聊天 / 历史会话" })).not.toBeInTheDocument();
  });
  it("shows preset assistants alongside editable Agents without builtin labels", async () => {
    api.mockResolvedValue({ agents: [
      { ...agent, id: "default", name: "默认助手", builtin: true, editable: true, status: "published" },
      { ...agent, id: "stocks", name: "股票分析师", builtin: true, editable: true, status: "published" },
    ] });
    mount(<AgentListPage />);
    expect(await screen.findByText("默认助手")).toBeInTheDocument();
    expect(screen.getByText("股票分析师")).toBeInTheDocument();
    expect(screen.queryByText("内置 Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("内置")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "我的 Agent" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "编辑" }).map((link) => link.getAttribute("href"))).toEqual(["/agents/default/edit", "/agents/stocks/edit"]);
    expect(screen.getAllByRole("link", { name: "开始对话 →" }).map((link) => link.getAttribute("href"))).toEqual(["/agents/default", "/agents/stocks"]);
  });
  it("shows Agent creation without an ordinary chat entrance", async () => {
    api.mockResolvedValue({ agents: [] });
    mount(<AgentListPage />);
    expect(await screen.findByText(/还没有 Agent/)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "普通聊天 / 历史会话" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新建 Agent" })).toHaveAttribute(
      "href",
      "/agents/new",
    );
  });
  it("groups owned and public Agents and shows editing only for owned Agents", async () => {
    api.mockResolvedValue({
      agents: [
        agent,
        {
          ...agent,
          id: "public",
          name: "Public",
          editable: false,
          status: "published",
        },
      ],
    });
    mount(<AgentListPage />);
    await screen.findByText("Research");
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "编辑" })).toHaveLength(1);
  });
  it("disables non-bindable skills and submits database UUIDs rather than skill names", async () => {
    api.mockImplementation(async (path) =>
      path === "/skills"
        ? {
            skills: [
              skill,
              {
                ...skill,
                id: "disabled",
                name: "unavailable",
                bindable: false,
                unbindableReason: "tampered",
              },
            ],
          }
        : agent,
    );
    mount(<AgentEditPage />, "/agents/agent-id/edit");
    const more = await screen.findByRole("button", { name: "更多" });
    await waitFor(() => expect(more).not.toBeDisabled());
    expect(screen.queryByText("example")).not.toBeInTheDocument();
    fireEvent.click(more);
    const available = screen.getByRole("button", { name: "添加 example" });
    expect(
      screen.getByRole("button", { name: "添加 unavailable" }),
    ).toBeDisabled();
    fireEvent.click(available);
    expect(screen.queryByRole("button", { name: "添加 example" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除 example" }));
    expect(screen.queryByRole("button", { name: "移除 example" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加 example" }));
    fireEvent.click(more);
    expect(screen.queryByText("unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除 example" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/agents/agent-id",
        "PUT",
        expect.objectContaining({ skillIds: ["skill-uuid"] }),
      ),
    );
  });
  it("surfaces server publish validation and does not publish unsaved edits", async () => {
    api.mockImplementation(async (path, method) => {
      if (path === "/skills") return { skills: [] };
      if (method === "POST") throw new Error("agent_prompt_required");
      return agent;
    });
    mount(<AgentEditPage />, "/agents/agent-id/edit");
    const publish = await screen.findByRole("button", { name: "发布" });
    await waitFor(() => expect(publish).not.toBeDisabled());
    fireEvent.click(publish);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "agent_prompt_required",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }), {
      target: { value: "Edited" },
    });
    expect(publish).toBeDisabled();
  });
  it("rejects oversized uploads before invoking the server", async () => {
    api.mockResolvedValue({ skills: [] });
    mount(<SkillLibraryPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "技能名称" }), {
      target: { value: "example" },
    });
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.zip", {
      type: "application/zip",
    });
    fireEvent.change(screen.getByLabelText("上传技能 ZIP"), {
      target: { files: [file] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "skill_too_large",
    );
    expect(api.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(0);
  });
});
