import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../plugins/database.js";
import { PrismaRunStore } from "./run-store.js";

describe("PrismaRunStore", () => {
  const clients: ReturnType<typeof createDatabase>[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  });

  it("persists project-scoped runs and replays events by per-run sequence", async () => {
    const prisma = createDatabase();
    clients.push(prisma);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY, projectId TEXT NOT NULL, conversationId TEXT NOT NULL,
        input TEXT NOT NULL, status TEXT NOT NULL, errorCode TEXT,
        createdAt DATETIME NOT NULL, startedAt DATETIME, finishedAt DATETIME
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, runId TEXT NOT NULL, seq INTEGER NOT NULL,
        type TEXT NOT NULL, payload JSON NOT NULL, createdAt DATETIME NOT NULL,
        UNIQUE(runId, seq)
      );
    `);
    const store = new PrismaRunStore(prisma);
    await store.create({
      id: "run-1", projectId: "project-1", conversationId: "conversation-1",
      input: "hello", status: "queued", createdAt: new Date(0).toISOString(),
    });
    await store.appendEvent({
      id: 1, runId: "run-1", type: "knowledge.retrieved",
      payload: { mode: "disabled", hits: [] }, createdAt: new Date(0).toISOString(),
    });
    await store.appendEvent({
      id: 2, runId: "run-1", type: "run.started",
      payload: { runId: "run-1", status: "running" }, createdAt: new Date(0).toISOString(),
    });

    await expect(store.get("run-1")).resolves.toMatchObject({ projectId: "project-1" });
    await expect(store.getEvents("run-1", 1)).resolves.toMatchObject([{ id: 2, type: "run.started" }]);
  });
});
