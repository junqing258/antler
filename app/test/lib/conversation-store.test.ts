import type { ThreadMessageLike } from "@assistant-ui/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConversation,
  deleteConversation,
  renameConversation,
  saveGeneratedConversationTitle,
  saveConversationMessages,
} from "../../src/lib/conversation-store";

const agentId = "stock-analyst";
const messages: ThreadMessageLike[] = [{ role: "user", content: "分析股票" }];

describe("conversation Agent persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads legacy project records without grouping or rebinding them", async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("antler", 3);
      request.onupgradeneeded = () => request.result.createObjectStore("conversations", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = database.transaction("conversations", "readwrite");
      transaction.objectStore("conversations").put({
        id: "legacy", projectId: "old-project", agentId,
        title: "Old", messages, createdAt: 1, updatedAt: 1,
      });
      transaction.oncomplete = () => resolve();
    });
    database.close();
    const conversation = await getConversation("legacy");
    expect(conversation).toMatchObject({ agentId, messages });
    expect(conversation).not.toHaveProperty("projectId");
  });

  it("saves a new thread under the selected Agent", async () => {
    await saveConversationMessages("stock-thread", messages, agentId);

    expect(await getConversation("stock-thread")).toMatchObject({
      agentId,
      messages,
    });
  });

  it("preserves an existing thread's Agent on subsequent saves", async () => {
    await saveConversationMessages("stock-thread", messages, agentId);
    await saveConversationMessages("stock-thread", messages, "other-agent");

    expect(await getConversation("stock-thread")).toMatchObject({ agentId });
  });

  it("preserves unbound legacy conversations", async () => {
    expect(await saveConversationMessages("general-thread", messages))
      .toMatchObject({ agentId: undefined });
  });

  it("keeps empty drafts out of history", async () => {
    expect(await saveConversationMessages("empty-thread", [], agentId))
      .toBeUndefined();
    expect(await getConversation("empty-thread")).toBeUndefined();
  });

  it("preserves the generated title across concurrent streaming saves", async () => {
    await saveConversationMessages("generated-thread", messages, agentId);
    const updatedMessages: ThreadMessageLike[] = [
      ...messages,
      { role: "assistant", content: "分析结果" },
    ];
    await Promise.all([
      saveConversationMessages("generated-thread", updatedMessages, agentId),
      saveGeneratedConversationTitle("generated-thread", "股票投资分析"),
    ]);
    expect(await getConversation("generated-thread")).toMatchObject({
      title: "股票投资分析",
      isTitleGenerated: true,
      messages: updatedMessages,
    });
    await saveConversationMessages("generated-thread", messages, agentId);
    expect((await getConversation("generated-thread"))?.title).toBe("股票投资分析");
  });

  it.each(["before", "after"])("gives manual renames priority %s title generation", async (order) => {
    await saveConversationMessages("manual-thread", messages, agentId);
    const rename = () => renameConversation("manual-thread", "我的投资计划");
    const generate = () => saveGeneratedConversationTitle("manual-thread", "股票分析");
    await Promise.all(order === "before" ? [rename(), generate()] : [generate(), rename()]);
    await saveConversationMessages("manual-thread", messages, agentId);
    expect(await getConversation("manual-thread")).toMatchObject({
      title: "我的投资计划",
      isTitleManuallySet: true,
    });
  });

  it("ignores empty titles and repeated generation without reordering history", async () => {
    const original = await saveConversationMessages("stable-thread", messages, agentId);
    expect(await saveGeneratedConversationTitle("stable-thread", "  ")).toBeUndefined();
    await saveGeneratedConversationTitle("stable-thread", "股票分析");
    expect(await saveGeneratedConversationTitle("stable-thread", "替换标题")).toBeUndefined();
    expect(await getConversation("stable-thread")).toMatchObject({
      title: "股票分析",
      updatedAt: original!.updatedAt,
    });
  });

  it("does not recreate a deleted conversation when a title arrives", async () => {
    await saveConversationMessages("deleted-thread", messages, agentId);
    await Promise.all([
      saveGeneratedConversationTitle("deleted-thread", "股票分析"),
      deleteConversation("deleted-thread"),
    ]);
    expect(await saveGeneratedConversationTitle("deleted-thread", "迟到的标题")).toBeUndefined();
    expect(await getConversation("deleted-thread")).toBeUndefined();
  });
});
