import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schedulerDatabase } from "../scheduler/helpers.js";
import { ConversationStore } from "../../src/conversations/store.js";
import type { StoredRun } from "../../src/runs/run-store.js";
let db: Awaited<ReturnType<typeof schedulerDatabase>>;
let store: ConversationStore;
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
  store = new ConversationStore(db);
});
afterEach(async () => {
  await db.$disconnect();
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
    expect(await db.conversationMessage.count()).toBe(2);
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
