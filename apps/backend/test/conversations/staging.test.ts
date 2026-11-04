import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StagingCapacityError,
  StagingJournal,
  type StagedRecord,
} from "../../src/conversations/staging.js";
import type { StoredRun } from "../../src/runs/run-store.js";

const run = (id = "run"): StoredRun => ({
  id,
  userId: "alice",
  conversationId: "thread",
  projectId: "default",
  input: "hello",
  status: "running",
  createdAt: "2026-11-04T00:00:00.000Z",
});

const record = (commitId = "c1"): StagedRecord => ({
  commitId,
  userId: "alice",
  conversationId: "thread",
  objects: [{ key: "p/k/batch.json", payload: { version: 1 } }],
  run: run(),
});

let root: string;
let journal: StagingJournal;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "antler-staging-"));
  journal = new StagingJournal(root, 1024 * 1024);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("StagingJournal", () => {
  it("validates writability and reports capacity exhaustion", async () => {
    await journal.validate();
    const tiny = new StagingJournal(root, 1);
    await expect(tiny.append("k", record())).rejects.toBeInstanceOf(
      StagingCapacityError,
    );
  });

  it("appends, replays in order and removes confirmed records", async () => {
    await journal.append("k", record("c1"));
    await journal.append("k", record("c2"));
    expect((await journal.records()).map((r) => r.commitId)).toEqual([
      "c1",
      "c2",
    ]);
    await journal.remove("k", "c1");
    expect((await journal.records()).map((r) => r.commitId)).toEqual(["c2"]);
    await journal.remove("k", "c2");
    expect(await journal.records()).toEqual([]);
  });

  it("ignores an uncommitted (newline-incomplete) tail left by a crash", async () => {
    const file = journal.file("k");
    await writeFile(file, `${JSON.stringify(record("c1"))}\n`, "utf8");
    await writeFile(file, JSON.stringify(record("c2")).slice(0, 20), {
      encoding: "utf8",
      flag: "a",
    });
    expect((await journal.records()).map((r) => r.commitId)).toEqual(["c1"]);
    // 下一次追加截断不完整尾行，不破坏已提交记录。
    await journal.append("k", record("c3"));
    expect((await journal.records()).map((r) => r.commitId)).toEqual([
      "c1",
      "c3",
    ]);
  });

  it("detects object references for GC coordination", async () => {
    await journal.append("k", record("c1"));
    expect(await journal.references("p/k/batch.json")).toBe(true);
    expect(await journal.references("p/k/other.json")).toBe(false);
    await journal.removeConversation("k");
    expect(await journal.references("p/k/batch.json")).toBe(false);
  });
});
