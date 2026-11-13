import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HomePage } from "../../mobile/src/views/home/home-page";
import { QueryProvider } from "../../mobile/src/views/root/query-provider";
import { defaultNativeConfig } from "../../mobile/src/lib/native-config";

const request = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => new Map<string, string>());
const focus = vi.hoisted(() => ({ callback: undefined as (() => void) | undefined }));
vi.mock("../../mobile/node_modules/expo-router", async () => {
  const { useEffect } = await import("react");
  return {
    useFocusEffect: (callback: () => void) => useEffect(() => {
      focus.callback = callback;
      callback();
      return () => { focus.callback = undefined; };
    }, [callback]),
  };
});
vi.mock("../../mobile/node_modules/@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); },
    removeItem: async (key: string) => { storage.delete(key); },
  },
}));
vi.mock("../../mobile/src/lib/native-platform", () => ({
  createNativePlatform: () => ({
    connection: async () => ({ baseUrl: "https://server.example", headers: {} }),
    request,
  }),
}));

afterEach(() => { cleanup(); request.mockReset(); storage.clear(); });

it("loads Agents without showing or requesting a separate conversation history list", async () => {
  request.mockResolvedValue(Response.json({ agents: [{ id: "agent", name: "我的助手", editable: true }] }));
  render(<QueryProvider><HomePage
    config={defaultNativeConfig}
    getToken={async () => "token"}
    onUnauthorized={() => {}}
    isCurrent={() => true}
    onOpenAgent={() => {}}
    onOpenSettings={() => {}}
    onOpenConversation={() => {}}
  /></QueryProvider>);
  expect(screen.queryByText("正在加载 Agent…")).not.toBeInTheDocument();
  expect(screen.queryByText("正在加载历史会话…")).not.toBeInTheDocument();
  expect(await screen.findByText("我的助手")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "直接开始对话" })).toBeInTheDocument();
  expect(screen.queryByText("历史会话")).not.toBeInTheDocument();
  expect(screen.queryByText("暂无历史会话")).not.toBeInTheDocument();
  expect(request.mock.calls.map(([url]) => url)).toEqual(["https://server.example/api/agents?includeRecentConversation=1"]);
});

it("restores cached Agents after remount and isolates another account", async () => {
  request.mockResolvedValue(Response.json({ agents: [{ id: "agent", name: "缓存助手", editable: true }] }));
  const home = <HomePage config={defaultNativeConfig} getToken={async () => "token"}
    onUnauthorized={() => {}} isCurrent={() => true} onOpenAgent={() => {}}
    onOpenSettings={() => {}} onOpenConversation={() => {}} />;
  const first = render(<QueryProvider scope="account-a">{home}</QueryProvider>);
  expect(await screen.findByText("缓存助手")).toBeInTheDocument();
  await waitFor(() => {
    const saved = storage.get("antler.mobile.query.v1.account-a") ?? "";
    expect(saved).toContain("缓存助手");
  }, { timeout: 3000 });
  first.unmount();
  request.mockRejectedValue(new Error("offline"));
  const restored = render(<QueryProvider scope="account-a">{home}</QueryProvider>);
  expect(await screen.findByText("缓存助手")).toBeInTheDocument();
  restored.unmount();
  render(<QueryProvider scope="account-b">{home}</QueryProvider>);
  expect(await screen.findByText("Agent 列表加载失败。")).toBeInTheDocument();
  expect(screen.queryByText("缓存助手")).not.toBeInTheDocument();
});

it("opens the matching Agent's recent conversation while keeping start conversation separate", async () => {
  const openConversation = vi.fn();
  const openAgent = vi.fn();
  request.mockResolvedValue(Response.json({ agents: [
    { id: "a", name: "研究助手", recentConversation: { id: "recent-a", title: "项目调研", lastMessageAt: "2026-11-14T00:00:00Z" } },
    { id: "b", name: "写作助手", recentConversation: null },
  ] }));
  render(<QueryProvider><HomePage
    config={defaultNativeConfig} getToken={async () => "token"}
    onUnauthorized={() => {}} isCurrent={() => true}
    onOpenAgent={openAgent} onOpenSettings={() => {}} onOpenConversation={openConversation}
  /></QueryProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "继续与研究助手的最近对话：项目调研" }));
  expect(openConversation).toHaveBeenCalledWith("recent-a", "a", "项目调研");
  expect(openAgent).not.toHaveBeenCalled();
  expect(screen.getByText("暂无对话")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "开始对话 →" })[1]!);
  expect(openAgent).toHaveBeenCalledWith("b");
});

it("refreshes the recent conversation when returning to the home page", async () => {
  request.mockImplementation(() => Promise.resolve(Response.json({ agents: [
    { id: "a", name: "助手", recentConversation: null },
  ] })));
  render(<QueryProvider><HomePage
    config={defaultNativeConfig} getToken={async () => "token"}
    onUnauthorized={() => {}} isCurrent={() => true}
    onOpenAgent={() => {}} onOpenSettings={() => {}} onOpenConversation={() => {}}
  /></QueryProvider>);
  expect(await screen.findByText("暂无对话")).toBeInTheDocument();
  request.mockImplementation(() => Promise.resolve(Response.json({ agents: [
    { id: "a", name: "助手", recentConversation: { id: "new", title: "刚刚的对话", lastMessageAt: "2026-11-14T01:00:00Z" } },
  ] })));
  await act(async () => { focus.callback?.(); });
  expect(await screen.findByText("刚刚的对话")).toBeInTheDocument();
  expect(screen.queryByText("暂无对话")).not.toBeInTheDocument();
});
