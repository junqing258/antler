import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HomePage } from "../../mobile/src/views/home/home-page";
import { QueryProvider } from "../../mobile/src/views/root/query-provider";
import { defaultNativeConfig } from "../../mobile/src/lib/native-config";

const request = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => new Map<string, string>());
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

it("loads history while agents are pending, and keeps history visible if agents fail", async () => {
  let failAgents!: (reason: Error) => void;
  const pendingAgents = new Promise<Response>((_, reject) => { failAgents = reject; });
  request.mockImplementation((url: string) => url.endsWith("/api/agents")
    ? pendingAgents
    : Promise.resolve(Response.json({ conversations: [{ id: "1", title: "历史记录" }], nextCursor: null })));
  render(<QueryProvider><HomePage
    config={defaultNativeConfig}
    getToken={async () => "token"}
    onUnauthorized={() => {}}
    isCurrent={() => true}
    onOpenAgent={() => {}}
    onOpenSettings={() => {}}
    onOpenConversation={() => {}}
  /></QueryProvider>);
  expect(await screen.findByText("历史记录")).toBeInTheDocument();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  failAgents(new Error("network error"));
  expect(await screen.findByText("Agent 列表加载失败。")).toBeInTheDocument();
  expect(screen.getByText("历史记录")).toBeInTheDocument();
});

it("restores cached lists after remount and isolates another account", async () => {
  request.mockImplementation((url: string) => Promise.resolve(Response.json(
    url.endsWith("/api/agents")
      ? { agents: [{ id: "agent", name: "缓存助手", editable: true }] }
      : { conversations: [{ id: "1", title: "缓存会话" }], nextCursor: null },
  )));
  const home = <HomePage config={defaultNativeConfig} getToken={async () => "token"}
    onUnauthorized={() => {}} isCurrent={() => true} onOpenAgent={() => {}}
    onOpenSettings={() => {}} onOpenConversation={() => {}} />;
  const first = render(<QueryProvider scope="account-a">{home}</QueryProvider>);
  expect(await screen.findByText("缓存会话")).toBeInTheDocument();
  await waitFor(() => {
    const saved = storage.get("antler.mobile.query.v1.account-a") ?? "";
    expect(saved).toContain("缓存会话");
    expect(saved).toContain("缓存助手");
  }, { timeout: 3000 });
  first.unmount();
  request.mockRejectedValue(new Error("offline"));
  const restored = render(<QueryProvider scope="account-a">{home}</QueryProvider>);
  expect(await screen.findByText("缓存会话")).toBeInTheDocument();
  expect(await screen.findByText("缓存助手")).toBeInTheDocument();
  restored.unmount();
  render(<QueryProvider scope="account-b">{home}</QueryProvider>);
  expect(await screen.findByText("历史会话加载失败，请重试。")).toBeInTheDocument();
  expect(screen.queryByText("缓存会话")).not.toBeInTheDocument();
  expect(screen.queryByText("缓存助手")).not.toBeInTheDocument();
});
