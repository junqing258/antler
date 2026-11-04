import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schedulerDatabase } from "../scheduler/helpers.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { CosConversationStorage, type CosObjectStore } from "../../src/conversations/cos-storage.js";
import { StagingJournal, type StagedRecord } from "../../src/conversations/staging.js";
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
const PREFIX = "antler/conversations/v1";

const run = (id = "run", status: StoredRun["status"] = "queued"): StoredRun => ({
  id,
  userId: "alice",
  conversationId: "thread",
  projectId: "default",
  input: "hello",
  status,
  createdAt: new Date().toISOString(),
  clientRequestId: id,
  requestHash: id,
  executionConfig: { schemaVersion: 1, model: "test" },
});

const store = () =>
  new ConversationStore(db, storageRoot, {
    conversationStorage: "cos",
    cosObjectStore: cosObjects,
    journal,
    gcGraceMs: 0,
  });

const keyOf = (conversationId: string) =>
  new CosConversationStorage(cosObjects, PREFIX).conversationKey(
    "alice",
    conversationId,
  );
const manifestOf = (conversationId: string) =>
  JSON.parse(
    cosObjects.objects.get(`${PREFIX}/${keyOf(conversationId)}/manifest.json`)!,
  );

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

describe("staged crash recovery", () => {
  it("replays a staged batch after a crash before the COS commit", async () => {
    const first = store();
    await first.create(run());
    const manifest = manifestOf("thread");
    const batchKey = `${PREFIX}/x/batches/0/crash-batch.json`;
    const batch = {
      version: 1,
      messages: [],
      events: [
        {
          id: 1,
          runId: "run",
          type: "assistant.delta",
          payload: { delta: "he" },
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const target = {
      ...manifest,
      batches: [
        ...manifest.batches,
        { seq: manifest.batches.length + 1, key: batchKey, lastEventId: 1 },
      ],
      commitSeq: manifest.commitSeq + 1,
    };
    const conversationKey = keyOf("thread");
    await journal.append(conversationKey, {
      commitId: "crash-1",
      userId: "alice",
      conversationId: "thread",
      objects: [{ key: batchKey, payload: batch }],
      manifest: target,
      run: { ...run(), status: "running" },
    });
    // 重启：重放先于中断标记，事件不乱序、不重复。
    await store().recover();
    expect(cosObjects.objects.has(batchKey)).toBe(true);
    expect(manifestOf("thread").commitSeq).toBe(target.commitSeq);
    expect(await journal.records()).toEqual([]);
    const events = await store().getEvents("run", 0);
    expect(events.map((event) => event.id)).toEqual([1]);
    const row = await db.conversation.findUnique({ where: { id: "thread" } });
    expect(row?.storageGeneration).toBe(target.commitSeq);
  });

  it("reconciles a staged terminal intent without generating interrupted", async () => {
    const first = store();
    await first.create(run());
    // 模拟崩溃窗口：COS 已提交终态，数据库仍是 running，暂存保留终态意图。
    const terminalRecord: StagedRecord = {
      commitId: "terminal-1",
      userId: "alice",
      conversationId: "thread",
      objects: [],
      run: { ...run(), status: "succeeded", finishedAt: new Date().toISOString() },
      terminal: {
        id: 99,
        runId: "run",
        type: "run.completed",
        payload: { status: "succeeded" },
        createdAt: new Date().toISOString(),
      },
    };
    await journal.append(keyOf("thread"), terminalRecord);
    await store().recover();
    const after = await store().get("run");
    expect(after?.status).toBe("succeeded");
    const row = await db.conversation.findUnique({ where: { id: "thread" } });
    expect(row?.activeRunId).toBeNull();
    // 终态意图已对账：recoverInterrupted 不得再生成 interrupted 事件。
    await store().recoverInterrupted();
    const events = await store().getEvents("run", 0);
    expect(
      events.filter((event) => event.type === "run.failed" && event.payload.error),
    ).toEqual([]);
  });

  it("does not double-apply a terminal intent that the database already confirmed", async () => {
    const first = store();
    await first.create(run());
    await first.update({
      ...run(),
      status: "succeeded",
      finishedAt: new Date().toISOString(),
    });
    const revisionAfter = (
      await db.conversation.findUnique({ where: { id: "thread" } })
    )?.revision;
    // 崩溃发生在数据库事务之后、暂存清除之前。
    await journal.append(keyOf("thread"), {
      commitId: "terminal-2",
      userId: "alice",
      conversationId: "thread",
      objects: [],
      run: { ...run(), status: "succeeded", finishedAt: new Date().toISOString() },
      terminal: {
        id: 99,
        runId: "run",
        type: "run.completed",
        payload: { status: "succeeded" },
        createdAt: new Date().toISOString(),
      },
    });
    await store().recover();
    expect(
      (await db.conversation.findUnique({ where: { id: "thread" } }))?.revision,
    ).toBe(revisionAfter);
    expect(await journal.records()).toEqual([]);
  });
});

describe("persistent deletion tasks", () => {
  it("deletes reachable objects and the manifest after the tombstone, resumable per stage", async () => {
    const first = store();
    await first.create(run());
    await first.remove("alice", "thread");
    // 任务与墓碑同事务创建，工作器完成所有阶段。
    const task = await db.conversationDeletionTask.findFirst({
      where: { conversationId: "thread" },
    });
    expect(task?.stage).toBe("done");
    expect(cosObjects.objects.size).toBe(0);
    // 幂等重跑。
    await first.processDeletionTasks("thread");
    expect(cosObjects.objects.size).toBe(0);
  });

  it("keeps the task pending when reading the manifest fails", async () => {
    const first = store();
    await first.create(run());
    const conversationKey = keyOf("thread");
    // 注入一个损坏的 manifest：读取失败必须保持待重试，不当空会话。
    const manifestKey = `${PREFIX}/${conversationKey}/manifest.json`;
    cosObjects.objects.set(manifestKey, "{not-json");
    await first.remove("alice", "thread");
    const task = await db.conversationDeletionTask.findFirst({
      where: { conversationId: "thread" },
    });
    expect(task?.stage).not.toBe("done");
    expect(cosObjects.objects.size).toBeGreaterThan(0);
  });
});

describe("coordinated garbage collection", () => {
  it("deletes unreferenced candidates after the grace period and keeps reachable ones", async () => {
    const first = store();
    await first.create(run());
    await first.update({
      ...run("run", "succeeded"),
      finishedAt: new Date().toISOString(),
    });
    // 终态紧凑把旧 batch 记为候选。
    const candidates = await db.storageGarbageCandidate.findMany();
    expect(candidates.length).toBeGreaterThan(0);
    const conversationKey = keyOf("thread");
    const manifest = JSON.parse(
      cosObjects.objects.get(`${PREFIX}/${conversationKey}/manifest.json`)!,
    );
    const snapshotKey = manifest.snapshot.key as string;
    // 宽限期内不删除。
    await first.collectGarbage();
    expect(cosObjects.objects.has(snapshotKey)).toBe(true);
    // 宽限期过后：候选删除，可达 snapshot 保留。
    await db.storageGarbageCandidate.updateMany({
      data: { firstSeenAt: new Date(Date.now() - 10_000) },
    });
    await first.collectGarbage();
    expect(cosObjects.objects.has(snapshotKey)).toBe(true);
    const candidateKeys = candidates.map((candidate) => candidate.key);
    for (const key of candidateKeys)
      expect(cosObjects.objects.has(key)).toBe(false);
    expect(await db.storageGarbageCandidate.count()).toBe(0);
  });
});
