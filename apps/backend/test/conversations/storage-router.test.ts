import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schedulerDatabase } from "../scheduler/helpers.js";
import { ConversationStore } from "../../src/conversations/store.js";
import type { CosObjectStore } from "../../src/conversations/cos-storage.js";
import { StagingJournal } from "../../src/conversations/staging.js";
import type { StoredRun } from "../../src/runs/run-store.js";

class MemoryObjectStore implements CosObjectStore {
  readonly objects = new Map<string, string>();
  async put(key: string, body: string) {
    this.objects.set(key, body);
  }
  async get(key: string) {
    return this.objects.get(key);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

let db: Awaited<ReturnType<typeof schedulerDatabase>>;
let storageRoot: string;
let cosObjects: MemoryObjectStore;
let journal: StagingJournal;

const run = (
  id = "run",
  userId = "alice",
  conversationId = "thread",
): StoredRun => ({
  id,
  userId,
  conversationId,
  projectId: "default",
  input: "hello",
  status: "queued",
  createdAt: new Date().toISOString(),
  clientRequestId: id,
  requestHash: id,
  executionConfig: { schemaVersion: 1, model: "test" },
  expectedRevision: 0,
});

const cosStore = () =>
  new ConversationStore(db, storageRoot, {
    conversationStorage: "cos",
    cosObjectStore: cosObjects,
    journal,
    gcGraceMs: 0,
  });

beforeEach(async () => {
  db = await schedulerDatabase();
  storageRoot = await mkdtemp(join(tmpdir(), "antler-history-"));
  cosObjects = new MemoryObjectStore();
  journal = new StagingJournal(
    await mkdtemp(join(tmpdir(), "antler-staging-")),
    1024 * 1024,
  );
});

afterEach(async () => {
  await db.$disconnect();
  await rm(storageRoot, { recursive: true, force: true });
  await rm(journal.root, { recursive: true, force: true });
});

describe("conversation storage router", () => {
  it("targets new conversations at the configured medium and keeps reads routed", async () => {
    const store = cosStore();
    await store.create(run());
    expect(
      (await db.conversation.findUnique({ where: { id: "thread" } }))
        ?.messageStorage,
    ).toBe("cos-v1");
    // 正文进入 COS，而不是本地 JSONL。
    expect(cosObjects.objects.size).toBeGreaterThan(0);
    await expect(stat(join(storageRoot, "objects"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const page = await store.messages("alice", "thread", 10);
    expect(page.messages.map((m) => m.id)).toEqual([
      "run:user",
      "run:assistant",
    ]);
  });

  it("keeps existing local-jsonl conversations on local storage", async () => {
    const localStore = new ConversationStore(db, storageRoot);
    await localStore.create(run());
    await localStore.update({
      ...run(),
      status: "succeeded",
      finishedAt: new Date().toISOString(),
    });
    expect(
      (await db.conversation.findUnique({ where: { id: "thread" } }))
        ?.messageStorage,
    ).toBe("local-jsonl");
    const store = cosStore();
    // 终态 transition 已推进会话 revision；这里不携带旧 expectedRevision。
    const { expectedRevision: _drop, ...second } = run("run-2");
    await store.create(second);
    const page = await store.messages("alice", "thread", 10);
    expect(page.messages.map((m) => m.id)).toEqual([
      "run:user",
      "run:assistant",
      "run-2:user",
      "run-2:assistant",
    ]);
    // 新 run 的正文仍写入本地来源（路由不迁移已有会话）。
    expect(cosObjects.objects.size).toBe(0);
  });

  it("imports legacy database conversations into the configured medium", async () => {
    await db.conversation.create({
      data: {
        id: "legacy",
        userId: "alice",
        title: "legacy",
        executionConfig: {},
        messageStorage: "database",
      },
    });
    await db.run.create({
      data: {
        id: "legacy-run",
        userId: "alice",
        conversationId: "legacy",
        projectId: "default",
        input: "old input",
      },
    });
    await db.conversationMessage.create({
      data: {
        id: "legacy-run:user",
        conversationId: "legacy",
        userId: "alice",
        runId: "legacy-run",
        seq: 1,
        role: "user",
        status: "complete",
        content: { schemaVersion: 1, parts: [{ type: "text", text: "old input" }] },
      },
    });
    const store = cosStore();
    const page = await store.messages("alice", "legacy", 10);
    expect(page.messages[0].content.parts).toEqual([
      { type: "text", text: "old input" },
    ]);
    expect(
      (await db.conversation.findUnique({ where: { id: "legacy" } }))
        ?.messageStorage,
    ).toBe("cos-v1");
    expect(cosObjects.objects.size).toBeGreaterThan(0);
    // 标记更新后重读仍正常。
    expect((await store.messages("alice", "legacy", 10)).messages).toHaveLength(
      1,
    );
  });

  it("refuses cos-v1 conversations instead of returning empty history when COS is unconfigured", async () => {
    const store = cosStore();
    await store.create(run());
    // 模拟未配置 COS 的进程：没有 cos 实现。
    const withoutCos = new ConversationStore(db, storageRoot);
    await expect(
      withoutCos.messages("alice", "thread", 10),
    ).rejects.toMatchObject({ code: "storage_unavailable", statusCode: 503 });
    await expect(
      withoutCos.getExecution("alice", "thread"),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
    // 详情（纯元数据）仍可读，但 contextState 不假装可用。
    expect(await withoutCos.detail("alice", "thread")).toMatchObject({
      id: "thread",
    });
  });
});
