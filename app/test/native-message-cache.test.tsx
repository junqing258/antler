import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CachedNativeChat } from "../../mobile/src/views/chat/cached-native-chat";
import { QueryProvider } from "../../mobile/src/views/root/query-provider";
import { defaultNativeConfig } from "../../mobile/src/lib/native-config";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("../../mobile/node_modules/@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); },
    removeItem: async (key: string) => { storage.delete(key); },
  },
}));
vi.mock("../../mobile/src/views/chat/native-chat", () => ({
  NativeChat: ({ cachedMessages, onCacheMessages }: any) => <>
    <div>{cachedMessages?.map((message: any) => message.content[0].text).join(",") || "无缓存"}</div>
    <div>{cachedMessages?.[0]?.createdAt instanceof Date ? "日期已恢复" : ""}</div>
    <button onClick={() => onCacheMessages([{ id: "m", role: "user", seq: 1, content: [{ type: "text", text: "历史消息" }], createdAt: new Date("2025-01-01T00:00:00Z") }])}>保存快照</button>
  </>,
}));

afterEach(() => { cleanup(); storage.clear(); });

it("persists message snapshots per account and conversation and restores dates", async () => {
  const chat = (id: string) => <CachedNativeChat
    config={{ ...defaultNativeConfig, conversationId: id }}
    provider={{ name: "x", protocol: "openai-responses", baseUrl: "", apiKey: "", model: "", models: [] }}
    getToken={async () => ""} onUnauthorized={() => {}} onConfigure={() => {}} onModelSelected={() => {}}
  />;
  const first = render(<QueryProvider scope="a">{chat("c1")}</QueryProvider>);
  fireEvent.click(await screen.findByText("保存快照"));
  await waitFor(() => expect(storage.get("antler.mobile.query.v1.a") ?? "").toContain("历史消息"), { timeout: 3000 });
  first.unmount();
  const restored = render(<QueryProvider scope="a">{chat("c1")}</QueryProvider>);
  expect(await screen.findByText("历史消息")).toBeInTheDocument();
  expect(screen.getByText("日期已恢复")).toBeInTheDocument();
  restored.unmount();
  const differentChat = render(<QueryProvider scope="a">{chat("c2")}</QueryProvider>);
  expect(await screen.findByText("无缓存")).toBeInTheDocument();
  expect(screen.queryByText("历史消息")).not.toBeInTheDocument();
  differentChat.unmount();
  render(<QueryProvider scope="b">{chat("c1")}</QueryProvider>);
  expect(await screen.findByText("无缓存")).toBeInTheDocument();
  expect(screen.queryByText("历史消息")).not.toBeInTheDocument();
});
