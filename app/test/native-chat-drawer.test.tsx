import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SafeAreaInsetsContext } from "../../mobile/node_modules/react-native-safe-area-context";
import {
  deleteConversation,
  listConversations,
  renameConversation,
  type ConversationSummary,
} from "../../mobile/src/lib/conversation-service";
import { ChatDrawer } from "../../mobile/src/views/chat/chat-drawer";
import {
  defaultNativeConfig,
  type NativeConfig,
} from "../../mobile/src/lib/native-config";

const { Platform } = await vi.importActual<{ Platform: { OS: string } }>("react-native");

const state = vi.hoisted(() => ({
  changeHandler: undefined as
    | ((change: {
        conversationId: string;
        type: string;
        revision: number;
        changeId: number;
      }) => void)
    | undefined,
  unsubscribe: undefined as (() => void) | undefined,
}));

vi.mock("../../mobile/src/lib/conversation-service", () => ({
  listConversations: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  subscribeConversationChanges: (
    _platform: unknown,
    _cursor: number,
    onChange: (change: {
      conversationId: string;
      type: string;
      revision: number;
      changeId: number;
    }) => void,
  ) => {
    state.changeHandler = onChange;
    state.unsubscribe = vi.fn();
    return state.unsubscribe;
  },
}));

vi.mock("../../mobile/src/lib/native-platform", () => ({
  createNativePlatform: () => ({
    connection: async () => ({
      baseUrl: "https://server.example",
      headers: {},
    }),
    request: async () => new Response("{}", { status: 200 }),
    abortController: () => new AbortController(),
    decoder: () => new TextDecoder(),
    schedule: (callback: () => void, ms: number) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    initialize: async () => {},
    createId: () => "generated",
    onForeground: () => () => {},
  }),
}));

const listMock = vi.mocked(listConversations);
const renameMock = vi.mocked(renameConversation);
const deleteMock = vi.mocked(deleteConversation);

const config: NativeConfig = {
  ...defaultNativeConfig,
  serverUrl: "https://server.example",
};

function row(
  id: string,
  title: string,
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id,
    title,
    agentId: "agent-1",
    revision: 1,
    lastMessageAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function DrawerHarness({
  activeId = "a",
  agentId = "agent-1",
  email,
  onOpenProfile = () => {},
  onNewConversation = () => {},
  onSelectConversation = () => {},
  onActiveTitle = () => {},
  onActiveDeleted = () => {},
}: {
  activeId?: string;
  agentId?: string;
  email?: string;
  onOpenProfile?: () => void;
  onNewConversation?: () => void;
  onSelectConversation?: (id: string, agentId?: string, title?: string) => void;
  onActiveTitle?: (id: string, title: string) => void;
  onActiveDeleted?: () => void;
}) {
  const [visible, setVisible] = useState(true);
  return (
    <ChatDrawer
      visible={visible}
      activeId={activeId}
      agentId={agentId}
      config={config}
      getToken={async () => "token"}
      onUnauthorized={() => {}}
      isCurrent={() => true}
      email={email}
      onClose={() => setVisible(false)}
      onBackHome={() => {}}
      onNewConversation={onNewConversation}
      onSelectConversation={onSelectConversation}
      onActiveTitle={onActiveTitle}
      onActiveDeleted={onActiveDeleted}
      onOpenSettings={() => {}}
      onOpenProfile={onOpenProfile}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.changeHandler = undefined;
  state.unsubscribe = undefined;
  listMock.mockResolvedValue({
    conversations: [row("a", "会话甲"), row("b", "会话乙", { revision: 3 })],
    nextCursor: null,
    lastChangeId: 7,
  });
  renameMock.mockImplementation(async (_p, _id, title, _rev) =>
    row("a", title, { revision: 5 }),
  );
  deleteMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

it("uses the screen safe area when the iOS drawer first opens", () => {
  const originalOS = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  try {
    render(
      <SafeAreaInsetsContext.Provider value={{ top: 59, bottom: 34, left: 0, right: 0 }}>
        <DrawerHarness />
      </SafeAreaInsetsContext.Provider>,
    );
    const column = screen.getByRole("button", { name: "返回 Agent 首页" }).parentElement;
    expect(column).toHaveStyle({ paddingTop: "59px", paddingBottom: "34px" });
  } finally {
    Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
  }
});

it("loads the current agent's conversations and marks the active one", async () => {
  render(<DrawerHarness />);
  expect(await screen.findByText("会话甲")).toBeInTheDocument();
  expect(listMock).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ agentId: "agent-1" }),
  );
  const active = screen.getByRole("button", { name: "会话甲" });
  expect(within(active).getByText("会话甲")).toHaveStyle({
    fontWeight: "600",
  });
});

it("creates a conversation and reports selection with the row title", async () => {
  const onNewConversation = vi.fn();
  const onSelectConversation = vi.fn();
  const first = render(
    <DrawerHarness
      onNewConversation={onNewConversation}
      onSelectConversation={onSelectConversation}
    />,
  );
  await screen.findByText("会话甲");
  fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
  await waitFor(() => expect(onNewConversation).toHaveBeenCalledTimes(1));
  first.unmount();
  render(<DrawerHarness onSelectConversation={onSelectConversation} />);
  await screen.findByText("会话乙");
  fireEvent.click(screen.getByRole("button", { name: "会话乙" }));
  await waitFor(() => expect(onSelectConversation).toHaveBeenCalledWith("b", "agent-1", "会话乙"));
});

it("dismisses the drawer when its backdrop is pressed", async () => {
  render(<DrawerHarness />);
  await screen.findByText("会话甲");
  fireEvent.click(screen.getByRole("button", { name: "关闭会话菜单" }));
  await waitFor(() => expect(screen.queryByText("会话甲")).not.toBeInTheDocument());
});

it("renames through the dialog, rejects empty input and updates the row", async () => {
  const onActiveTitle = vi.fn();
  render(<DrawerHarness onActiveTitle={onActiveTitle} />);
  await screen.findByText("会话甲");
  fireEvent.click(screen.getByRole("button", { name: "重命名 会话甲" }));
  const input = await screen.findByLabelText("会话名称");
  const confirm = screen.getByRole("button", { name: "重命名" });
  fireEvent.change(input, { target: { value: "   " } });
  expect(confirm).toHaveAttribute("disabled");
  fireEvent.change(input, { target: { value: "改名后" } });
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(renameMock).toHaveBeenCalledWith(
      expect.anything(),
      "a",
      "改名后",
      1,
    ),
  );
  expect(await screen.findByText("改名后")).toBeInTheDocument();
  expect(onActiveTitle).toHaveBeenCalledWith("a", "改名后");
});

it("keeps the row and reports an error when the rename fails", async () => {
  renameMock.mockRejectedValueOnce(
    new Error("会话已在其他设备更新，请刷新后重试。"),
  );
  render(<DrawerHarness />);
  await screen.findByText("会话甲");
  fireEvent.click(screen.getByRole("button", { name: "重命名 会话甲" }));
  const input = await screen.findByLabelText("会话名称");
  fireEvent.change(input, { target: { value: "冲突改名" } });
  fireEvent.click(screen.getByRole("button", { name: "重命名" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "会话已在其他设备更新",
  );
  expect(screen.getByText("会话甲")).toBeInTheDocument();
  expect(screen.queryByText("冲突改名")).not.toBeInTheDocument();
});

it("deletes a non-active conversation after confirmation without switching", async () => {
  const onActiveDeleted = vi.fn();
  render(<DrawerHarness onActiveDeleted={onActiveDeleted} />);
  await screen.findByText("会话乙");
  fireEvent.click(screen.getByRole("button", { name: "删除 会话乙" }));
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  await waitFor(() =>
    expect(deleteMock).toHaveBeenCalledWith(expect.anything(), "b"),
  );
  await waitFor(() =>
    expect(screen.queryByText("会话乙")).not.toBeInTheDocument(),
  );
  expect(onActiveDeleted).not.toHaveBeenCalled();
});

it("keeps the conversation and reports an error when the delete fails", async () => {
  deleteMock.mockRejectedValueOnce(new Error("删除失败，请重试。"));
  render(<DrawerHarness />);
  await screen.findByText("会话乙");
  fireEvent.click(screen.getByRole("button", { name: "删除 会话乙" }));
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("删除失败");
  expect(screen.getByText("会话乙")).toBeInTheDocument();
});

it("starts a new conversation after deleting the active one", async () => {
  const onActiveDeleted = vi.fn();
  render(<DrawerHarness onActiveDeleted={onActiveDeleted} />);
  await screen.findByText("会话甲");
  fireEvent.click(screen.getByRole("button", { name: "删除 会话甲" }));
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  await waitFor(() => expect(onActiveDeleted).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("会话甲")).not.toBeInTheDocument();
});

it("merges later pages without duplicating rows", async () => {
  listMock.mockImplementation(async (_platform, options) => ({
    conversations: options?.cursor
      ? [
          row("a", "会话甲"),
          row("c", "会话丙", { lastMessageAt: "2025-12-01T00:00:00Z" }),
        ]
      : [row("a", "会话甲"), row("b", "会话乙", { revision: 3 })],
    nextCursor: options?.cursor ? null : "cursor-1",
    lastChangeId: 7,
  }));
  render(<DrawerHarness />);
  fireEvent.click(await screen.findByRole("button", { name: "加载更多会话" }));
  await screen.findByText("会话丙");
  expect(screen.getAllByText("会话甲")).toHaveLength(1);
  expect(listMock).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ cursor: "cursor-1" }),
  );
});

it("applies server-side changes: updates titles and removes deleted rows", async () => {
  render(<DrawerHarness />);
  await screen.findByText("会话甲");
  await waitFor(() => expect(state.changeHandler).toBeDefined());
  listMock.mockResolvedValueOnce({
    conversations: [
      row("a", "会话甲"),
      row("b", "服务端新标题", { revision: 4 }),
    ],
    nextCursor: null,
    lastChangeId: 8,
  });
  await act(async () => {
    state.changeHandler?.({
      conversationId: "b",
      type: "updated",
      revision: 4,
      changeId: 8,
    });
  });
  await screen.findByText("服务端新标题");
  await act(async () => {
    state.changeHandler?.({
      conversationId: "b",
      type: "deleted",
      revision: 5,
      changeId: 9,
    });
  });
  await waitFor(() =>
    expect(screen.queryByText("服务端新标题")).not.toBeInTheDocument(),
  );
});

it("reports the active conversation title when it changes on the server", async () => {
  const onActiveTitle = vi.fn();
  render(<DrawerHarness onActiveTitle={onActiveTitle} />);
  await screen.findByText("会话甲");
  await waitFor(() => expect(state.changeHandler).toBeDefined());
  listMock.mockResolvedValueOnce({
    conversations: [
      row("a", "自动生成的标题", { revision: 2 }),
      row("b", "会话乙", { revision: 3 }),
    ],
    nextCursor: null,
    lastChangeId: 9,
  });
  await act(async () => {
    state.changeHandler?.({
      conversationId: "a",
      type: "updated",
      revision: 2,
      changeId: 9,
    });
  });
  await waitFor(() =>
    expect(onActiveTitle).toHaveBeenCalledWith("a", "自动生成的标题"),
  );
});

it("unsubscribes the change stream when the drawer closes", async () => {
  const props = {
    activeId: "a",
    agentId: "agent-1",
    config,
    getToken: async () => "token",
    onUnauthorized: () => {},
    isCurrent: () => true,
    onClose: () => {},
    onBackHome: () => {},
    onNewConversation: () => {},
    onSelectConversation: () => {},
    onActiveTitle: () => {},
    onActiveDeleted: () => {},
    onOpenSettings: () => {},
    onOpenProfile: () => {},
  };
  const { rerender } = render(<ChatDrawer visible {...props} />);
  await screen.findByText("会话甲");
  await waitFor(() => expect(state.unsubscribe).toBeDefined());
  rerender(<ChatDrawer visible={false} {...props} />);
  expect(state.unsubscribe).toHaveBeenCalled();
});

it("shows the account details and opens the profile from the footer", async () => {
  const onOpenProfile = vi.fn();
  render(<DrawerHarness email="junqing258@126.com" onOpenProfile={onOpenProfile} />);
  await screen.findByText("会话甲");
  expect(screen.getByText("junqing258")).toBeInTheDocument();
  expect(screen.getByText("junqing258@126.com")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "个人资料" }));
  await waitFor(() => expect(onOpenProfile).toHaveBeenCalledTimes(1));
});

it("shows a neutral placeholder and hides sign-out when no account or email exists", async () => {
  render(<DrawerHarness email={undefined} />);
  await screen.findByText("会话甲");
  expect(screen.getByText("本地模式")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "打开设置" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "退出登录" }),
  ).not.toBeInTheDocument();
});
