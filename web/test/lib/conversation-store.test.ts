import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConversation,
  listConversations,
  renameConversation,
  deleteConversation,
  resetConversationSession,
  conversationRequest,
} from "../../src/lib/conversation-store";
import {
  installConversationFixture,
  saveConversationMessages,
} from "../conversation-fixture";
vi.mock("@/lib/server-info", () => ({
  serverInfo: async () => ({ baseUrl: "", token: "test" }),
  authHeaders: () => ({ "x-antler-token": "test" }),
}));
beforeEach(() => {
  resetConversationSession();
  installConversationFixture();
});
afterEach(() => vi.unstubAllGlobals());
describe("server conversation storage", () => {
  it("loads server summaries, adapts versioned messages and uses revision for renaming", async () => {
    await saveConversationMessages(
      "one",
      [{ role: "user", content: "hello" }],
      "agent",
    );
    expect((await listConversations())[0].messages).toEqual([]);
    expect((await getConversation("one"))?.messages[0].content).toEqual([
      { type: "text", text: "hello" },
    ]);
    await renameConversation("one", "manual");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/one"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "manual", expectedRevision: 1 }),
      }),
    );
    await deleteConversation("one");
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.headers).not.toHaveProperty(
      "content-type",
    );
    expect(await getConversation("one")).toBeUndefined();
  });
  it("does not open legacy IndexedDB", async () => {
    const open = vi.fn(() => {
      throw new Error("must not read legacy data");
    });
    vi.stubGlobal("indexedDB", { open });
    expect(await listConversations()).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });
  it("rejects late responses after an account switch", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      ),
    );
    const pending = conversationRequest("");
    await Promise.resolve();
    resetConversationSession();
    resolve(new Response("{}"));
    await expect(pending).rejects.toThrow("账号已切换");
  });
  it("does not turn service failure into an empty history", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":"unavailable"}', { status: 503 }),
        ),
    );
    await expect(listConversations()).rejects.toThrow("unavailable");
  });
});
