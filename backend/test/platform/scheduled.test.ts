import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/app.js";
import { PiAgentAdapter } from "../../src/agent/pi-agent-adapter.js";
import { schedulerDatabase } from "../scheduler/helpers.js";

let app: ReturnType<typeof createApp>, root: string;
let conversation = "";
let model: ReturnType<typeof vi.spyOn>;
const agentInput = {
  name: "Scheduled Agent",
  description: "Description",
  systemPrompt: "Use these instructions",
};
const taskInput = (payload: object) => ({
  name: "Frozen task",
  type: "service",
  schedule: "0 0 1 1 *",
  retryCount: 3,
  retryDelay: 0,
  payload,
});
async function agent() {
  const created = await app.inject({
    method: "POST",
    url: "/api/agents",
    payload: agentInput,
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().id as string;
  expect(
    (await app.inject({ method: "POST", url: `/api/agents/${id}/publish` }))
      .statusCode,
  ).toBe(200);
  return id;
}
async function bind(id: string, conversationId = conversation) {
  const result = await app.inject({
    method: "POST",
    url: "/api/runs",
    payload: {
      message: "first",
      projectId: "default",
      conversationId,
      agentId: id,
    },
  });
  expect(result.statusCode).toBe(202);
  await vi.waitFor(async () =>
    expect(
      (await app.prisma.run.findUnique({ where: { id: result.json().runId } }))
        ?.status,
    ).toBe("succeeded"),
  );
  await new Promise((r) => setTimeout(r, 5));
}
async function save(payload: object) {
  const result = await app.inject({
    method: "POST",
    url: "/api/scheduled-tasks",
    payload: taskInput(payload),
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json() as {
    id: string;
    payload: { agentId?: string; agentFingerprint?: string };
  };
}
async function execute(id: string) {
  const trigger = await app.inject({
    method: "POST",
    url: `/api/scheduled-tasks/${id}/trigger`,
  });
  expect(trigger.statusCode, trigger.body).toBe(202);
  await vi.waitFor(async () =>
    expect(
      (
        await app.prisma.taskExecution.findUnique({
          where: { id: trigger.json().executionId },
        })
      )?.status,
    ).not.toBe("running"),
  );
  // stop/retry-chain bookkeeping runs after the record is finalized.
  await new Promise((r) => setTimeout(r, 40));
  return app.prisma.taskExecution.findMany({
    where: { taskId: id },
    orderBy: { startedAt: "asc" },
  });
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "antler-frozen-integration-"));
  const url = `file:${join(root, "db")}`;
  await (await schedulerDatabase(url)).$disconnect();
  app = createApp({
    host: "127.0.0.1",
    port: 3210,
    authMode: "local",
    provider: "openai",
    model: "test",
    maxRunDurationMs: 5000,
    workspaceRoot: join(root, "workspace"),
    platformRoot: join(root, "platform"),
    databaseUrl: url,
  });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await app.prisma.scheduledTask.deleteMany();
  await app.prisma.run.deleteMany();
  await app.prisma.agent.deleteMany();
  conversation = randomUUID();
  model = vi.spyOn(PiAgentAdapter.prototype, "run").mockResolvedValue([]);
  vi.spyOn(PiAgentAdapter.prototype, "exportContext").mockReturnValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("frozen Agent tasks through the real app.ts service wrapper", () => {
  it("freezes inherited bindings on save and passes Agent ID and fingerprint through execution", async () => {
    const id = await agent();
    await bind(id);
    const task = await save({
      service: "taskService",
      method: "create",
      args: ["scheduled", conversation],
    });
    expect(task.payload).toMatchObject({
      agentId: id,
      agentFingerprint: expect.stringMatching(/^sha256:/),
    });
    const executions = await execute(task.id);
    expect(executions).toHaveLength(1);
    expect(executions[0]!.status).toBe("succeeded");
    await vi.waitFor(async () => expect(await app.prisma.run.count()).toBe(2));
    expect(
      (await app.prisma.run.findMany()).every((r) => r.agentId === id),
    ).toBe(true);
    const explicit = await save({
      service: "taskService",
      method: "create",
      agentId: id,
      args: ["new scheduled conversation"],
    });
    expect((await execute(explicit.id))[0]!.status).toBe("succeeded");
    await vi.waitFor(async () =>
      expect(await app.prisma.run.count({ where: { agentId: id } })).toBe(3),
    );
  });
  it.each(["id", "fingerprint", "both"])(
    "rejects missing frozen %s with one execution, including inherited Agent bindings",
    async (missing) => {
      const id = await agent();
      await bind(id);
      const task = await save({
        service: "taskService",
        method: "create",
        agentId: id,
        args: ["scheduled", conversation],
      });
      const payload: Record<string, unknown> = {
        service: "taskService",
        method: "create",
        args: [
          "scheduled",
          conversation,
          { requireFrozenAgentFields: false, requirePublished: false },
        ],
        ...task.payload,
      };
      if (missing !== "fingerprint") delete payload.agentId;
      if (missing !== "id") delete payload.agentFingerprint;
      await app.prisma.scheduledTask.update({
        where: { id: task.id },
        data: {
          payload:
            payload as import("../../src/generated/prisma/client.js").Prisma.InputJsonObject,
        },
      });
      model.mockClear();
      const executions = await execute(task.id);
      expect(executions).toHaveLength(1);
      expect(executions[0]).toMatchObject({
        status: "failed",
        error: "agent_frozen_fields_missing",
      });
      expect(await app.prisma.run.count()).toBe(1);
      expect(model).not.toHaveBeenCalled();
    },
  );
  it.each(["delete", "unpublish", "content"])(
    "classifies %s errors as non-retryable and never writes a dirty run",
    async (action) => {
      const id = await agent();
      const task = await save({
        service: "taskService",
        method: "create",
        agentId: id,
        args: ["scheduled"],
      });
      if (action === "delete")
        await app.inject({ method: "DELETE", url: `/api/agents/${id}` });
      if (action === "unpublish")
        await app.inject({
          method: "POST",
          url: `/api/agents/${id}/unpublish`,
        });
      if (action === "content")
        await app.inject({
          method: "PUT",
          url: `/api/agents/${id}`,
          payload: { systemPrompt: "new instructions" },
        });
      const executions = await execute(task.id);
      expect(executions).toHaveLength(1);
      expect(executions[0]).toMatchObject({
        status: "failed",
        error:
          action === "delete"
            ? "agent_not_found"
            : action === "unpublish"
              ? "agent_not_published"
              : "agent_context_changed",
      });
      expect(await app.prisma.run.count()).toBe(0);
      expect(model).not.toHaveBeenCalled();
      if (action === "content") {
        const refreshed = await app.inject({
          method: "PUT",
          url: `/api/scheduled-tasks/${task.id}`,
          payload: { name: "Refresh frozen context" },
        });
        expect(refreshed.statusCode).toBe(200);
        expect(refreshed.json().payload.agentFingerprint).not.toBe(
          task.payload.agentFingerprint,
        );
        const restored = await execute(task.id);
        expect(restored.at(-1)!.status).toBe("succeeded");
      }
    },
  );
  it("rejects scheduling drafts, preserves historical no-Agent tasks and rejects stale conversations on resave", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: agentInput,
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/api/scheduled-tasks",
      payload: taskInput({
        service: "taskService",
        method: "create",
        agentId: created.json().id,
        args: ["draft"],
      }),
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toBe("agent_not_published");
    const historical = await save({
      service: "taskService",
      method: "create",
      args: ["ordinary"],
    });
    expect((await execute(historical.id))[0]!.status).toBe("succeeded");
    const id = await agent();
    await bind(id);
    const task = await save({
      service: "taskService",
      method: "create",
      args: ["scheduled", conversation],
    });
    await app.inject({
      method: "PUT",
      url: `/api/agents/${id}`,
      payload: { systemPrompt: "new" },
    });
    const stale = await app.inject({
      method: "PUT",
      url: `/api/scheduled-tasks/${task.id}`,
      payload: { name: "refresh" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("agent_context_changed");
  });
});
