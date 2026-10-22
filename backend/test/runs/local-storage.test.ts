import {
  mkdtemp,
  readFile,
  appendFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { LocalConversationStorage } from "../../src/conversations/local-storage.js";
import type { StoredRun } from "../../src/runs/run-store.js";
import type { RunEvent } from "../../src/agent/events.js";

let root: string;
let storage: LocalConversationStorage;
const run: StoredRun = {
  id: "run",
  userId: "alice",
  conversationId: "thread",
  projectId: "default",
  input: "hello",
  status: "running",
  createdAt: "2026-10-22T00:00:00.000Z",
};
const event = (id: number, delta: string): RunEvent => ({
  id,
  runId: run.id,
  type: "assistant.delta",
  payload: { delta },
  createdAt: run.createdAt,
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "antler-local-history-"));
  storage = new LocalConversationStorage(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("restores message snapshots and event replay after compaction and restart", async () => {
  await storage.create(run);
  await storage.persist(run, [event(1, "first"), event(2, " second")]);
  await storage.persist({ ...run, status: "succeeded" }, [
    {
      ...event(3, ""),
      type: "run.completed",
      payload: { status: "succeeded" },
    },
  ]);
  const restarted = new LocalConversationStorage(root);
  const messages = await restarted.messages("alice", "thread");
  expect(messages.map((message) => [message.id, message.seq])).toEqual([
    ["run:user", 1],
    ["run:assistant", 2],
  ]);
  expect(messages[1]).toMatchObject({
    status: "succeeded",
    appliedEventId: 3,
    content: { parts: [{ type: "text", text: "first second" }] },
  });
  expect(
    (await restarted.events("alice", "thread", "run", 1)).map(
      (item) => item.id,
    ),
  ).toEqual([2, 3]);
  const path = join(storage.directory("alice", "thread"), "messages.jsonl");
  const batches = (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(batches.flatMap((batch) => batch.messages)).toHaveLength(2);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

it("serializes simultaneous batches and ignores already applied events", async () => {
  await storage.create(run);
  await Promise.all([
    storage.persist(run, [event(1, "one")]),
    storage.persist(run, [event(2, "two")]),
  ]);
  await storage.persist(run, [event(2, "duplicate")]);
  expect((await storage.messages("alice", "thread"))[1].content.parts).toEqual([
    { type: "text", text: "onetwo" },
  ]);
  expect(await storage.events("alice", "thread", "run", 0)).toHaveLength(2);
});

it("ignores a torn tail and repairs it before the next append", async () => {
  await storage.create(run);
  await storage.persist(run, [event(1, "before")]);
  const path = join(storage.directory("alice", "thread"), "messages.jsonl");
  await appendFile(path, '{"version":1,"messages":[{"content":"截断');
  const restarted = new LocalConversationStorage(root);
  expect(
    (await restarted.messages("alice", "thread"))[1].content.parts,
  ).toEqual([{ type: "text", text: "before" }]);
  await restarted.persist(run, [event(2, " after")]);
  const again = new LocalConversationStorage(root);
  expect((await again.messages("alice", "thread"))[1].content.parts).toEqual([
    { type: "text", text: "before after" },
  ]);
  expect(
    (await again.events("alice", "thread", "run", 0)).map((item) => item.id),
  ).toEqual([1, 2]);
});

it("isolates accounts and prevents identifiers from escaping the storage directory", async () => {
  const suspicious = {
    ...run,
    conversationId: "../../outside",
    userId: "../../alice",
  };
  await storage.create(suspicious);
  const directory = storage.directory(
    suspicious.userId,
    suspicious.conversationId,
  );
  expect(relative(root, directory)).toMatch(/^[a-f0-9]{64}$/);
  expect(await storage.messages("bob", suspicious.conversationId)).toEqual([]);
  expect(
    await storage.messages(suspicious.userId, suspicious.conversationId),
  ).toHaveLength(2);
});

it("atomically replaces checkpoints and removes all local data on deletion", async () => {
  await storage.create(run);
  await storage.saveCheckpoint(
    "alice",
    "thread",
    { messages: ["old"] },
    "available",
  );
  await storage.saveCheckpoint(
    "alice",
    "thread",
    { messages: ["new"] },
    "available",
  );
  const restarted = new LocalConversationStorage(root);
  expect(await restarted.checkpoint("alice", "thread")).toEqual({
    checkpoint: { messages: ["new"] },
    contextState: "available",
  });
  expect((await readdir(storage.directory("alice", "thread"))).sort()).toEqual([
    "checkpoint.json",
    "messages.jsonl",
  ]);
  await storage.remove("alice", "thread");
  expect(await storage.messages("alice", "thread")).toEqual([]);
  expect(await storage.checkpoint("alice", "thread")).toBeUndefined();
});

it("restores provider failure details from old event batches without message error fields", async () => {
  await storage.create(run);
  const path = join(storage.directory("alice", "thread"), "messages.jsonl");
  await appendFile(
    path,
    `${JSON.stringify({
      version: 1,
      messages: [],
      events: [
        {
          id: 1,
          runId: run.id,
          type: "run.failed",
          payload: {
            error: {
              code: "provider_error",
              message: "403 Access to model denied",
            },
          },
          createdAt: run.createdAt,
        },
      ],
    })}\n`,
  );
  const restarted = new LocalConversationStorage(root);
  expect((await restarted.messages("alice", "thread"))[1].error).toEqual({
    code: "provider_error",
    message: "403 Access to model denied",
  });
});
