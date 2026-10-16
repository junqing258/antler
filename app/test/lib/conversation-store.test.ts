import type { ThreadMessageLike } from "@assistant-ui/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROJECT_ID,
  getConversation,
  deleteConversation,
  renameConversation,
  saveGeneratedConversationTitle,
  saveConversationMessages,
} from "../../src/lib/conversation-store";

const projectId = "workspace:Stock-Analysis";
const messages: ThreadMessageLike[] = [{ role: "user", content: "分析股票" }];

describe("conversation project persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves a new thread under the selected project", async () => {
    await saveConversationMessages("stock-thread", messages, projectId);

    expect(await getConversation("stock-thread")).toMatchObject({
      projectId,
      messages,
    });
  });

  it("preserves an existing thread's project on subsequent saves", async () => {
    await saveConversationMessages("stock-thread", messages, projectId);
    await saveConversationMessages("stock-thread", messages, DEFAULT_PROJECT_ID);

    expect(await getConversation("stock-thread")).toMatchObject({ projectId });
  });

  it("defaults to General when no project is specified", async () => {
    expect(await saveConversationMessages("general-thread", messages))
      .toMatchObject({ projectId: DEFAULT_PROJECT_ID });
  });

  it("keeps empty project drafts out of history", async () => {
    expect(await saveConversationMessages("empty-thread", [], projectId))
      .toBeUndefined();
    expect(await getConversation("empty-thread")).toBeUndefined();
  });

  it("preserves the generated title across concurrent streaming saves", async () => {
    await saveConversationMessages("generated-thread", messages, projectId);
    const updatedMessages: ThreadMessageLike[] = [
      ...messages,
      { role: "assistant", content: "分析结果" },
    ];
    await Promise.all([
      saveConversationMessages("generated-thread", updatedMessages, projectId),
      saveGeneratedConversationTitle("generated-thread", "股票投资分析"),
    ]);
    expect(await getConversation("generated-thread")).toMatchObject({
      title: "股票投资分析",
      isTitleGenerated: true,
      messages: updatedMessages,
    });
    await saveConversationMessages("generated-thread", messages, projectId);
    expect((await getConversation("generated-thread"))?.title).toBe("股票投资分析");
  });

  it.each(["before", "after"])("gives manual renames priority %s title generation", async (order) => {
    await saveConversationMessages("manual-thread", messages, projectId);
    const rename = () => renameConversation("manual-thread", "我的投资计划");
    const generate = () => saveGeneratedConversationTitle("manual-thread", "股票分析");
    await Promise.all(order === "before" ? [rename(), generate()] : [generate(), rename()]);
    await saveConversationMessages("manual-thread", messages, projectId);
    expect(await getConversation("manual-thread")).toMatchObject({
      title: "我的投资计划",
      isTitleManuallySet: true,
    });
  });

  it("ignores empty titles and repeated generation without reordering history", async () => {
    const original = await saveConversationMessages("stable-thread", messages, projectId);
    expect(await saveGeneratedConversationTitle("stable-thread", "  ")).toBeUndefined();
    await saveGeneratedConversationTitle("stable-thread", "股票分析");
    expect(await saveGeneratedConversationTitle("stable-thread", "替换标题")).toBeUndefined();
    expect(await getConversation("stable-thread")).toMatchObject({
      title: "股票分析",
      updatedAt: original!.updatedAt,
    });
  });

  it("does not recreate a deleted conversation when a title arrives", async () => {
    await saveConversationMessages("deleted-thread", messages, projectId);
    await Promise.all([
      saveGeneratedConversationTitle("deleted-thread", "股票分析"),
      deleteConversation("deleted-thread"),
    ]);
    expect(await saveGeneratedConversationTitle("deleted-thread", "迟到的标题")).toBeUndefined();
    expect(await getConversation("deleted-thread")).toBeUndefined();
  });
});
