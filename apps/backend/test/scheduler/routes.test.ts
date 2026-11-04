import Fastify from "fastify";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { createApp } from "../../src/app.js";
import { createDatabase } from "../../src/plugins/database.js";
import { TaskExecutor } from "../../src/scheduler/executor.js";
import { CronScheduler } from "../../src/scheduler/scheduler.js";
import { SchedulerService } from "../../src/scheduler/service.js";
import { registerSchedulerRoutes } from "../../src/routes/scheduler.js";
import { deferred, migratedWorkspace, schedulerDatabase } from "./helpers.js";

const input = {
  name: "API test",
  type: "service",
  schedule: "0 * * * *",
  payload: { service: "test", method: "run" },
  timeout: 1000,
};
let prisma: PrismaClient;
let scheduler: CronScheduler;
let app: ReturnType<typeof Fastify>;
let run: ReturnType<typeof vi.fn>;
let release: (() => void) | undefined;
beforeEach(async () => {
  prisma = await schedulerDatabase();
  run = vi.fn(() => "done");
  release = undefined;
  scheduler = new CronScheduler(
    new TaskExecutor(prisma, new Map([["test", { run }]])),
    prisma,
  );
  await scheduler.start();
  app = Fastify();
  registerSchedulerRoutes(app, new SchedulerService(prisma, scheduler));
});
afterEach(async () => {
  release?.();
  await app.close();
  await scheduler.stop();
  await prisma.$disconnect();
});

describe("scheduler REST API", () => {
  it("supports creation, queries, edits, enable/disable and deletion", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/scheduled-tasks",
      payload: input,
    });
    expect(created.statusCode).toBe(201);
    const path = `/api/scheduled-tasks/${created.json().id}`;
    expect((await app.inject(path)).json().name).toBe(input.name);
    expect(
      (
        await app.inject(
          "/api/scheduled-tasks?enabled=true&type=service&page=1&limit=1",
        )
      ).json(),
    ).toMatchObject({ total: 1, page: 1, limit: 1 });
    expect(
      (
        await app.inject({
          method: "PUT",
          url: path,
          payload: { name: "edited" },
        })
      ).json().name,
    ).toBe("edited");
    expect(
      (await app.inject({ method: "POST", url: `${path}/disable` })).json()
        .enabled,
    ).toBe(false);
    expect(
      (await app.inject({ method: "POST", url: `${path}/enable` })).json()
        .enabled,
    ).toBe(true);
    expect((await app.inject({ method: "DELETE", url: path })).statusCode).toBe(
      204,
    );
    expect((await app.inject(path)).statusCode).toBe(404);
  });
  it("returns 202 immediately and 409 on overlapping trigger, with queryable history", async () => {
    const gate = deferred();
    release = () => gate.resolve("done");
    run.mockReturnValue(gate.promise);
    const task = (
      await app.inject({
        method: "POST",
        url: "/api/scheduled-tasks",
        payload: input,
      })
    ).json();
    const path = `/api/scheduled-tasks/${task.id}`;
    const responses = await Promise.all([
      app.inject({ method: "POST", url: `${path}/trigger` }),
      app.inject({ method: "POST", url: `${path}/trigger` }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      202, 409,
    ]);
    const accepted = responses
      .find((response) => response.statusCode === 202)!
      .json();
    expect(accepted.status).toBe("running");
    const detail = `/api/task-executions/${accepted.executionId}`;
    expect((await app.inject(detail)).json()).toMatchObject({
      taskId: task.id,
      status: "running",
    });
    expect(
      (await app.inject(`${path}/executions?limit=1`)).json().executions,
    ).toHaveLength(1);
    release!();
    await expect
      .poll(async () => (await app.inject(detail)).json().status)
      .toBe("succeeded");
  });
  it.each([
    null,
    [],
    {},
    { ...input, payload: null },
    { ...input, timeout: 0 },
  ])("returns 400 on invalid creation %j", async (payload) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/scheduled-tasks",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
    expect(response.statusCode).toBe(400);
    expect(await prisma.scheduledTask.count()).toBe(0);
  });
  it.each([
    "page=0",
    "page=NaN",
    "limit=-1",
    "limit=1.5",
    "enabled=maybe",
    "type=other",
  ])("rejects malformed query %s", async (query) => {
    expect((await app.inject(`/api/scheduled-tasks?${query}`)).statusCode).toBe(
      400,
    );
  });
  it("returns 404 for missing tasks and executions", async () => {
    const path = "/api/scheduled-tasks/missing";
    for (const response of await Promise.all([
      app.inject(path),
      app.inject({ method: "PUT", url: path, payload: {} }),
      app.inject({ method: "DELETE", url: path }),
      ...["trigger", "enable", "disable"].map((action) =>
        app.inject({ method: "POST", url: `${path}/${action}` }),
      ),
      app.inject(`${path}/executions`),
      app.inject("/api/task-executions/missing"),
    ]))
      expect(response.statusCode).toBe(404);
  });
  it("returns 500 for database failures instead of treating them as validation errors", async () => {
    vi.spyOn(prisma.scheduledTask, "create").mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/scheduled-tasks",
          payload: input,
        })
      ).statusCode,
    ).toBe(500);
  });
});

it("integrates migrated persistence, authentication, startup recovery and shutdown before disconnect", async () => {
  const { root, file } = await migratedWorkspace();
  const setup = createDatabase(`file:${file}`);
  await setup.scheduledTask.create({
    data: {
      name: "startup",
      type: "service",
      schedule: "delay:0",
      runAt: new Date(),
      payload: { service: "taskService", method: "get", args: ["missing"] },
    },
  });
  await setup.$disconnect();
  const integrated = createApp({
    host: "127.0.0.1",
    port: 3210,
    workspaceRoot: root,
    databaseUrl: `file:${file}`,
    accessToken: "scheduler-test",
    provider: "openai",
    model: "test",
    maxRunDurationMs: 1000,
    schedulerEnableScript: true,
  });
  const headers = { "x-antler-token": "scheduler-test" };
  try {
    await integrated.ready();
    expect((await integrated.inject("/api/scheduled-tasks")).statusCode).toBe(
      401,
    );
    const authenticated = headers;
    expect(
      (
        await integrated.inject({
          url: "/api/scheduled-tasks",
          headers: authenticated,
        })
      ).statusCode,
    ).toBe(200);
    await expect
      .poll(() =>
        integrated.prisma.taskExecution.count({
          where: { status: "succeeded" },
        }),
      )
      .toBe(1);
    const created = await integrated.inject({
      method: "POST",
      url: "/api/scheduled-tasks",
      headers: authenticated,
      payload: {
        name: "shutdown",
        type: "script",
        schedule: "0 * * * *",
        timeout: 2000,
        payload: {
          command: process.execPath,
          args: ["-e", "setTimeout(()=>process.stdout.write('done'),100)"],
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const accepted = await integrated.inject({
      method: "POST",
      url: `/api/scheduled-tasks/${created.json().id}/trigger`,
      headers: authenticated,
    });
    expect(accepted.statusCode).toBe(202);
    await integrated.close();
    const reopened = createDatabase(`file:${file}`);
    try {
      expect(
        await reopened.taskExecution.findUnique({
          where: { id: accepted.json().executionId },
        }),
      ).toMatchObject({ status: "succeeded", result: { stdout: "done" } });
    } finally {
      await reopened.$disconnect();
    }
  } finally {
    await integrated.close();
    await rm(root, { recursive: true, force: true });
  }
});
