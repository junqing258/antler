import type { ThreadMessageLike } from "@assistant-ui/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROJECT_ID,
  getConversation,
  saveConversationMessages,
} from "./conversation-store";

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
});
