import { afterEach, describe, expect, it } from "vitest";
import { PrismaRunStore } from "../../src/runs/run-store.js";
import { schedulerDatabase } from "../scheduler/helpers.js";

describe("PrismaRunStore", () => {
  const clients: Awaited<ReturnType<typeof schedulerDatabase>>[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  });

  it("persists project-scoped runs and replays events by per-run sequence", async () => {
    const prisma = await schedulerDatabase();
    clients.push(prisma);
    const store = new PrismaRunStore(prisma);
    await store.create({
      id: "run-1",
userId: "",
      projectId: "project-1",
      conversationId: "conversation-1",
      input: "hello",
      status: "queued",
      createdAt: new Date(0).toISOString(),
    });
    await store.appendEvent({
      id: 1,
      runId: "run-1",
      type: "knowledge.retrieved",
      payload: { mode: "disabled", hits: [] },
      createdAt: new Date(0).toISOString(),
    });
    await store.appendEvent({
      id: 2,
      runId: "run-1",
      type: "run.started",
      payload: { runId: "run-1", status: "running" },
      createdAt: new Date(0).toISOString(),
    });

    await expect(store.get("run-1")).resolves.toMatchObject({
      projectId: "project-1",
    });
    await expect(store.getEvents("run-1", 1)).resolves.toMatchObject([
      { id: 2, type: "run.started" },
    ]);
  });
});
