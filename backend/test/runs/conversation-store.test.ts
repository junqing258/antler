import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schedulerDatabase } from "../scheduler/helpers.js";
import { ConversationStore } from "../../src/conversations/store.js";
import type { StoredRun } from "../../src/runs/run-store.js";
let db: Awaited<ReturnType<typeof schedulerDatabase>>;
let store: ConversationStore;
let storageRoot: string;
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
beforeEach(async () => {
  db = await schedulerDatabase();
  storageRoot = await mkdtemp(join(tmpdir(), "antler-history-"));
  store = new ConversationStore(db, storageRoot);
});
afterEach(async () => {
  await db.$disconnect();
  await rm(storageRoot, { recursive: true, force: true });
});
describe("authoritative conversation store", () => {
  it("commits a run, stable messages and a user cursor together and isolates owners", async () => {
    await store.create(run());
    expect((await store.list("alice", 10)).lastChangeId).toBe(1);
    expect(
      (await store.messages("alice", "thread", 10)).messages.map((m) => [
        m.id,
        m.seq,
      ]),
    ).toEqual([
      ["run:user", 1],
      ["run:assistant", 2],
    ]);
    expect(await store.detail("bob", "thread")).toBeNull();
    expect((await store.list("bob", 10)).conversations).toEqual([]);
    await expect(store.messages("bob", "thread", 10)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(store.create(run("other", "bob"))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await store.findRequest("alice", "run", "run")).toMatchObject({
      id: "run",
    });
    await expect(
      store.findRequest("alice", "run", "different"),
    ).rejects.toMatchObject({ code: "client_request_conflict" });
  });
  it("projects ordered text, reasoning and tool results with a committed event watermark", async () => {
    const r = run();
    await store.create(r);
    const events = [
      ["assistant.thinking.delta", { delta: "think" }],
      ["assistant.delta", { delta: "hello" }],
      [
        "step.started",
        { kind: "tool", stepId: "tool", tool: "read", args: { path: "a" } },
      ],
      [
        "tool.completed",
        { stepId: "tool", result: { text: "data" }, isError: false },
      ],
      ["assistant.delta", { delta: "done" }],
    ] as const;
    for (const [index, [type, payload]] of events.entries())
      await store.appendEvent({
        id: index + 1,
        runId: r.id,
        type,
        payload,
        createdAt: r.createdAt,
      });
    r.status = "succeeded";
    await store.transition(r, {
      id: 6,
      runId: r.id,
      type: "run.completed",
      payload: {},
      createdAt: r.createdAt,
    });
    const page = await store.messages("alice", "thread", 10);
    expect(page.activeRunId).toBeNull();
    expect(page.messages[1]).toMatchObject({
      appliedEventId: 6,
      status: "succeeded",
      content: {
        schemaVersion: 1,
        parts: [
          { type: "reasoning", text: "think" },
          { type: "text", text: "hello" },
          { type: "tool-call", toolCallId: "tool", result: { text: "data" } },
          { type: "text", text: "done" },
        ],
      },
    });
    expect((await store.list("alice", 10)).conversations[0]).not.toHaveProperty(
      "messages",
    );
  });
  it("projects a large event batch with one transaction and one sync revision", async () => {
    const r = run();
    await store.create(r);
    const transaction = vi.spyOn(db, "$transaction");
    try {
      await store.appendEvents(
        Array.from({ length: 200 }, (_, index) => ({
          id: index + 1,
          runId: r.id,
          type: "assistant.delta" as const,
          payload: { delta: "chunk " },
          createdAt: r.createdAt,
        })),
      );
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(await db.runEvent.count()).toBe(0);
      expect(await store.getEvents(r.id, 0)).toHaveLength(200);
      const page = await store.messages("alice", "thread", 10);
      expect(page.messages[1]).toMatchObject({
        appliedEventId: 200,
        content: { parts: [{ type: "text", text: "chunk ".repeat(200) }] },
      });
      expect(page.revision).toBe(2);
      expect((await store.list("alice", 10)).lastChangeId).toBe(2);
    } finally {
      transaction.mockRestore();
    }
  });
  it("keeps deletion tombstones despite late output and rejects stale edits", async () => {
    await store.create(run());
    await expect(
      store.title("alice", "thread", "stale", 0),
    ).rejects.toMatchObject({ code: "conversation_revision_conflict" });
    await store.title("alice", "thread", "manual", 1);
    await store.generatedTitle("alice", "thread", "generated");
    expect((await store.detail("alice", "thread"))?.title).toBe("manual");
    expect(await store.remove("alice", "thread")).toBe("run");
    await store.remove("alice", "thread");
    await store.appendEvent({
      id: 1,
      runId: "run",
      type: "assistant.delta",
      payload: { delta: "late" },
      createdAt: new Date().toISOString(),
    });
    expect((await store.list("alice", 10)).conversations).toEqual([]);
    await expect(
      stat(store.storage.directory("alice", "thread")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await store.changes("alice", 0)).at(-1)?.type).toBe("deleted");
    await expect(store.create(run("new"))).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it("rolls back both cursor and messages if creation fails", async () => {
    await store.create(run());
    await expect(store.create(run("second"))).rejects.toMatchObject({
      code: "conversation_busy",
    });
    expect(await db.run.count()).toBe(1);
    expect((await store.list("alice", 10)).lastChangeId).toBe(1);
    expect(await db.conversationMessage.count()).toBe(0);
    expect((await store.messages("alice", "thread", 10)).messages).toHaveLength(
      2,
    );
  });
  it("recovers interrupted output and advances its terminal projection watermark", async () => {
    await store.create(run());
    await store.appendEvent({
      id: 1,
      runId: "run",
      type: "assistant.delta",
      payload: { delta: "partial" },
      createdAt: new Date().toISOString(),
    });
    await store.recoverInterrupted();
    const page = await store.messages("alice", "thread", 10);
    expect(page.messages[1]).toMatchObject({
      status: "failed",
      appliedEventId: 2,
      content: { parts: [{ type: "text", text: "partial" }] },
    });
    expect(page.activeRunId).toBeNull();
    expect(await store.get("run")).toMatchObject({ errorCode: "interrupted" });
  });
});

it("pages disk messages in both directions without writing payload tables", async () => {
  const first = run();
  await store.create(first);
  first.status = "succeeded";
  await store.transition(first, {
    id: 1,
    runId: first.id,
    type: "run.completed",
    payload: {},
    createdAt: first.createdAt,
  });
  await store.create({ ...run("second"), expectedRevision: undefined });
  expect(
    (await store.messages("alice", "thread", 2)).messages.map(
      (message) => message.seq,
    ),
  ).toEqual([3, 4]);
  expect((await store.messages("alice", "thread", 2)).hasMore).toBe(true);
  expect(
    (await store.messages("alice", "thread", 2, 3)).messages.map(
      (message) => message.seq,
    ),
  ).toEqual([1, 2]);
  expect(
    (await store.messages("alice", "thread", 2, undefined, 2)).messages.map(
      (message) => message.seq,
    ),
  ).toEqual([3, 4]);
  expect((await store.messages("alice", "thread", 2, 0)).messages).toEqual([]);
  expect(await db.conversationMessage.count()).toBe(0);
  expect(await db.runEvent.count()).toBe(0);
  expect((await db.run.findUnique({ where: { id: first.id } }))?.input).toBe(
    "",
  );
  expect((await store.get(first.id))?.input).toBe("hello");
});

it("migrates legacy messages, events and checkpoints lazily and preserves legacy rows", async () => {
  await db.conversation.create({
    data: {
      id: "thread",
      userId: "alice",
      title: "legacy",
      executionConfig: {},
      checkpoint: { schemaVersion: 1, messages: ["memory"] },
      contextState: "available",
    },
  });
  await db.run.create({
    data: {
      id: "legacy",
      userId: "alice",
      conversationId: "thread",
      projectId: "default",
      input: "old input",
    },
  });
  await db.conversationMessage.createMany({
    data: [
      {
        id: "legacy:user",
        conversationId: "thread",
        userId: "alice",
        runId: "legacy",
        seq: 1,
        role: "user",
        status: "complete",
        content: {
          schemaVersion: 1,
          parts: [{ type: "text", text: "old input" }],
        },
      },
      {
        id: "legacy:assistant",
        conversationId: "thread",
        userId: "alice",
        runId: "legacy",
        seq: 2,
        role: "assistant",
        status: "running",
        appliedEventId: 1,
        content: {
          schemaVersion: 1,
          parts: [{ type: "text", text: "old output" }],
        },
      },
    ],
  });
  await db.runEvent.create({
    data: {
      runId: "legacy",
      seq: 1,
      type: "assistant.delta",
      payload: { delta: "old output" },
    },
  });
  const importer = vi
    .spyOn(store.storage, "importLegacy")
    .mockRejectedValueOnce(new Error("disk offline"));
  await expect(store.messages("alice", "thread", 10)).rejects.toThrow(
    "disk offline",
  );
  expect(
    (await db.conversation.findUnique({ where: { id: "thread" } }))
      ?.messageStorage,
  ).toBe("database");
  const page = await store.messages("alice", "thread", 10);
  expect(page.messages[1].content.parts).toEqual([
    { type: "text", text: "old output" },
  ]);
  expect(await store.getEvents("legacy", 0)).toMatchObject([
    { id: 1, payload: { delta: "old output" } },
  ]);
  expect(await store.getExecution("alice", "thread")).toMatchObject({
    checkpoint: { messages: ["memory"] },
    contextState: "available",
  });
  expect(
    await db.conversation.findUnique({ where: { id: "thread" } }),
  ).toMatchObject({ messageStorage: "local-jsonl", checkpoint: null });
  expect(await db.conversationMessage.count()).toBe(2);
  expect(await db.runEvent.count()).toBe(1);
  const restarted = new ConversationStore(db, storageRoot);
  expect(
    (await restarted.messages("alice", "thread", 10)).messages,
  ).toHaveLength(2);
  expect(importer).toHaveBeenCalledTimes(2);
  importer.mockRestore();
  // Once migrated, a missing disk must not resurrect stale database payloads.
  await rm(store.storage.directory("alice", "thread"), {
    recursive: true,
    force: true,
  });
  const missingDisk = new ConversationStore(db, storageRoot);
  expect((await missingDisk.messages("alice", "thread", 10)).messages).toEqual(
    [],
  );
  expect(await missingDisk.getEvents("legacy", 0)).toEqual([]);
  expect(await missingDisk.getExecution("alice", "thread")).toMatchObject({
    checkpoint: null,
    contextState: "not_restored",
  });
  expect((await missingDisk.detail("alice", "thread"))?.contextState).toBe(
    "not_restored",
  );
});

it("commits terminal metadata even if local message writes fail", async () => {
  const r = run();
  await store.create(r);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const persist = vi
    .spyOn(store.storage, "persist")
    .mockRejectedValue(new Error("disk full"));
  try {
    r.status = "succeeded";
    await store.transition(r, {
      id: 1,
      runId: r.id,
      type: "run.completed",
      payload: {},
      createdAt: r.createdAt,
    });
    expect((await store.detail("alice", "thread"))?.activeRunId).toBeNull();
    expect((await store.get(r.id))?.status).toBe("succeeded");
  } finally {
    persist.mockRestore();
    warning.mockRestore();
  }
});
