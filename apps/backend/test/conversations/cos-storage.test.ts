import { beforeEach, describe, expect, it } from "vitest";
import {
  CosConversationStorage,
  ConversationStorageIntegrityError,
} from "../../src/conversations/cos-storage.js";
import type { CosObjectStore } from "../../src/conversations/cos-storage.js";
import type { StoredRun } from "../../src/runs/run-store.js";
import type { RunEvent } from "../../src/agent/events.js";

const PREFIX = "antler/conversations/v1";

class MemoryObjectStore implements CosObjectStore {
  readonly objects = new Map<string, string>();
  readonly deleted: string[] = [];
  async put(key: string, body: string) {
    this.objects.set(key, body);
  }
  async get(key: string) {
    return this.objects.get(key);
  }
  async delete(key: string) {
    this.objects.delete(key);
    this.deleted.push(key);
  }
}

let objects: MemoryObjectStore;
let storage: CosConversationStorage;

const run = (id = "run", status: StoredRun["status"] = "running"): StoredRun => ({
  id,
  userId: "alice",
  conversationId: "thread",
  projectId: "default",
  input: "hello",
  status,
  createdAt: "2026-11-04T00:00:00.000Z",
});
const delta = (id: number, text: string, runId = "run"): RunEvent => ({
  id,
  runId,
  type: "assistant.delta",
  payload: { delta: text },
  createdAt: "2026-11-04T00:00:00.000Z",
});

beforeEach(() => {
  objects = new MemoryObjectStore();
  storage = new CosConversationStorage(objects, PREFIX);
});

describe("CosConversationStorage", () => {
  it("round-trips create, persist, messages, page, input and events", async () => {
    await storage.create(run());
    expect(await storage.input("alice", "thread", "run")).toBe("hello");
    await storage.persist(run(), [delta(1, "he"), delta(2, "llo")]);
    const messages = await storage.messages("alice", "thread");
    expect(messages.map((m) => [m.id, m.seq])).toEqual([
      ["run:user", 1],
      ["run:assistant", 2],
    ]);
    expect(messages[1].content.parts).toEqual([
      { type: "text", text: "hello" },
    ]);
    const page = await storage.page("alice", "thread", 1);
    expect(page.messages).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(await storage.events("alice", "thread", "run", 0)).toHaveLength(2);
    expect(await storage.events("alice", "thread", "run", 1)).toHaveLength(1);
    expect(await storage.events("alice", "thread", "other", 0)).toEqual([]);
  });

  it("keeps events of concurrent runs separate and replays snapshots with batches", async () => {
    await storage.create(run("a"));
    await storage.persist(run("a"), [delta(1, "a1", "a"), delta(2, "a2", "a")]);
    await storage.create(run("b"));
    await storage.persist(run("b"), [delta(1, "b1", "b")]);
    expect(await storage.events("alice", "thread", "a", 0)).toHaveLength(2);
    expect(await storage.events("alice", "thread", "b", 0)).toHaveLength(1);
  });

  it("compacts on terminal persist: manifest references only the new snapshot", async () => {
    await storage.create(run());
    await storage.persist(run(), [delta(1, "he")]);
    await storage.persist(run("run", "succeeded"), [
      delta(2, "llo"),
      {
        id: 3,
        runId: "run",
        type: "run.completed",
        payload: { status: "succeeded" },
        createdAt: "2026-11-04T00:00:01.000Z",
      },
    ]);
    const key = storage.conversationKey("alice", "thread");
    const manifest = JSON.parse(
      objects.objects.get(`${PREFIX}/${key}/manifest.json`)!,
    );
    expect(manifest.batches).toEqual([]);
    expect(manifest.snapshot).toBeDefined();
    expect(manifest.generation).toBe(1);
    // 紧凑前后消息投影与事件保持一致。
    expect(await storage.messages("alice", "thread")).toMatchObject([
      { id: "run:user" },
      { id: "run:assistant" },
    ]);
    expect(await storage.events("alice", "thread", "run", 0)).toHaveLength(3);
  });

  it("writes a new checkpoint object per save without revision and points the manifest at the latest", async () => {
    await storage.create(run());
    const key = storage.conversationKey("alice", "thread");
    const keysBefore = new Set(objects.objects.keys());
    await storage.saveCheckpoint("alice", "thread", { schemaVersion: 1 }, "available");
    await storage.saveCheckpoint("alice", "thread", { schemaVersion: 2 }, "available");
    const checkpointKeys = [...objects.objects.keys()].filter(
      (key) => key.includes("/checkpoints/") && !keysBefore.has(key),
    );
    expect(new Set(checkpointKeys).size).toBe(2);
    expect(await storage.checkpoint("alice", "thread")).toEqual({
      checkpoint: { schemaVersion: 2 },
      contextState: "available",
    });
    const manifest = JSON.parse(
      objects.objects.get(`${PREFIX}/${key}/manifest.json`)!,
    );
    expect(manifest.checkpoint.key).toBe(checkpointKeys.at(-1));
  });

  it("imports legacy payloads and exports them unchanged", async () => {
    const messages = [
      {
        id: "legacy:user",
        conversationId: "thread",
        userId: "alice",
        seq: 1,
        runId: "legacy",
        role: "user",
        status: "complete",
        appliedEventId: 0,
        content: { schemaVersion: 1 as const, parts: [{ type: "text" as const, text: "old" }] },
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
    ];
    await storage.importLegacy(
      "alice",
      "thread",
      messages,
      [delta(1, "old", "legacy")],
      { schemaVersion: 1 },
      "available",
    );
    const exported = await storage.exportAll("alice", "thread");
    expect(exported.messages).toHaveLength(1);
    expect(exported.messages[0].id).toBe("legacy:user");
    expect(exported.events).toHaveLength(1);
    expect(exported.checkpoint).toEqual({
      checkpoint: { schemaVersion: 1 },
      contextState: "available",
    });
    expect(await storage.input("alice", "thread", "legacy")).toBe("old");
  });

  it("reports integrity errors instead of empty history for a missing manifest", async () => {
    await storage.create(run());
    const key = storage.conversationKey("alice", "thread");
    objects.objects.delete(`${PREFIX}/${key}/manifest.json`);
    await expect(storage.messages("alice", "thread")).rejects.toBeInstanceOf(
      ConversationStorageIntegrityError,
    );
    await expect(storage.checkpoint("alice", "thread")).rejects.toBeInstanceOf(
      ConversationStorageIntegrityError,
    );
  });

  it("detects corrupted objects via the recorded payload hash", async () => {
    await storage.create(run());
    const key = storage.conversationKey("alice", "thread");
    const manifest = JSON.parse(
      objects.objects.get(`${PREFIX}/${key}/manifest.json`)!,
    );
    const batchKey = manifest.batches.at(-1).key as string;
    const parsed = JSON.parse(objects.objects.get(batchKey)!);
    parsed.messages[0].content.parts[0].text = "tampered";
    objects.objects.set(batchKey, JSON.stringify(parsed));
    // 缓存有效时不重读对象；新实例必须重新加载并校验哈希。
    const fresh = new CosConversationStorage(objects, PREFIX);
    await expect(fresh.messages("alice", "thread")).rejects.toThrow(
      /hash_mismatch/,
    );
  });

  it("reports a missing snapshot or batch as an integrity error", async () => {
    await storage.create(run());
    const key = storage.conversationKey("alice", "thread");
    const manifest = JSON.parse(
      objects.objects.get(`${PREFIX}/${key}/manifest.json`)!,
    );
    objects.objects.delete(manifest.batches.at(-1).key);
    const fresh = new CosConversationStorage(objects, PREFIX);
    await expect(fresh.messages("alice", "thread")).rejects.toThrow(
      /batch_missing/,
    );
  });

  it("removes every reachable object and the manifest, treating 404 as deleted", async () => {
    await storage.create(run());
    await storage.saveCheckpoint("alice", "thread", { schemaVersion: 1 }, "available");
    const key = storage.conversationKey("alice", "thread");
    const manifest = JSON.parse(
      objects.objects.get(`${PREFIX}/${key}/manifest.json`)!,
    );
    await storage.remove("alice", "thread");
    expect(objects.objects.size).toBe(0);
    expect(objects.deleted).toContain(manifest.checkpoint.key);
    expect(objects.deleted).toContain(`${PREFIX}/${key}/manifest.json`);
    // 幂等重跑：全部 404 不报错。
    await expect(storage.remove("alice", "thread")).resolves.toBeUndefined();
  });

  it("caches the projection between operations but reloads after foreign commits", async () => {
    await storage.create(run());
    await storage.persist(run(), [delta(1, "he")]);
    const second = new CosConversationStorage(objects, PREFIX);
    // 另一个实例提交后，原实例读取时仍以 manifest 为准。
    await second.persist(run(), [delta(2, "llo")]);
    const messages = await storage.messages("alice", "thread");
    expect(messages[1].content.parts).toEqual([
      { type: "text", text: "hello" },
    ]);
  });
});
