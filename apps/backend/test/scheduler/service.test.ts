import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { TaskExecutor } from "../../src/scheduler/executor.js";
import { CronScheduler, MAX_DELAY_MS } from "../../src/scheduler/scheduler.js";
import { SchedulerService } from "../../src/scheduler/service.js";
import {
  TaskNotFoundError,
  TaskValidationError,
  type CreateTaskDto,
  type UpdateTaskDto,
} from "../../src/scheduler/types.js";
import { schedulerDatabase } from "./helpers.js";

let prisma: PrismaClient;
let scheduler: CronScheduler;
let service: SchedulerService;
const input: CreateTaskDto = {
  name: "test",
  type: "service",
  schedule: "0 * * * *",
  payload: { service: "test", method: "run" },
};
beforeEach(async () => {
  prisma = await schedulerDatabase();
  scheduler = new CronScheduler(
    new TaskExecutor(prisma, new Map([["test", { run: () => "done" }]])),
    prisma,
  );
  service = new SchedulerService(prisma, scheduler);
  await scheduler.start();
});
afterEach(async () => {
  await scheduler.stop();
  await prisma.$disconnect();
});

describe("SchedulerService", () => {
  it("creates defaults, filters and paginates", async () => {
    const first = await service.createTask(input);
    expect(first).toMatchObject({
      enabled: true,
      retryCount: 0,
      retryDelay: 60000,
      timeout: 300000,
      runAt: null,
    });
    await service.createTask({ ...input, enabled: false });
    await service.createTask({
      ...input,
      type: "http",
      payload: { url: "http://localhost", method: "GET" },
    });
    expect(
      await service.listTasks({ enabled: true, type: "service" }),
    ).toMatchObject({ total: 1, tasks: [{ id: first.id }] });
    expect(await service.listTasks({ page: 2, limit: 1 })).toMatchObject({
      total: 3,
      page: 2,
      limit: 1,
    });
    expect((await service.listTasks({ limit: 500 })).limit).toBe(200);
  });
  it("persists runAt, preserves it on edits and resets it only when schedule is supplied", async () => {
    const first = await service.createTask({
      ...input,
      schedule: "delay:10000",
    });
    expect(first.runAt!.getTime()).toBeGreaterThan(Date.now() + 9000);
    expect(
      (await service.updateTask(first.id, { name: "renamed" })).runAt,
    ).toEqual(first.runAt);
    const changed = await service.updateTask(first.id, {
      schedule: "delay:20000",
    });
    expect(changed.runAt!.getTime()).toBeGreaterThan(first.runAt!.getTime());
    expect(
      (await service.updateTask(first.id, { schedule: "0 * * * *" })).runAt,
    ).toBeNull();
  });
  it("enables, disables and cascade-deletes execution history", async () => {
    const task = await service.createTask({ ...input, enabled: false });
    expect((await service.enableTask(task.id)).enabled).toBe(true);
    await service.triggerTask(task.id);
    await expect
      .poll(async () => (await service.getExecutions(task.id))[0]?.status)
      .toBe("succeeded");
    expect((await service.disableTask(task.id)).enabled).toBe(false);
    await service.deleteTask(task.id);
    expect(await service.getTask(task.id)).toBeNull();
    expect(await prisma.taskExecution.count()).toBe(0);
  });
  it.each([
    { name: "" },
    { type: "unknown" },
    { schedule: "" },
    { schedule: "not cron" },
    { schedule: "delay:" },
    { schedule: "delay:-1" },
    { schedule: `delay:${MAX_DELAY_MS + 1}` },
    { enabled: "true" },
    { retryCount: 11 },
    { retryCount: 1.5 },
    { retryDelay: -1 },
    { timeout: 0 },
    { timeout: MAX_DELAY_MS + 1 },
    { payload: null },
    { payload: { service: "test", method: "run", args: {} } },
    { type: "http", payload: { url: "http://", method: "GET" } },
    { type: "http", payload: { url: "https://example.com", method: "BAD" } },
    {
      type: "http",
      payload: {
        url: "https://example.com",
        method: "GET",
        expectedStatus: [],
      },
    },
    { type: "script", payload: { command: "echo", args: [1] } },
    { type: "script", payload: { command: "echo", env: { SECRET: 1 } } },
  ])("rejects invalid creation before persistence: %j", async (changes) => {
    await expect(
      service.createTask({ ...input, ...changes } as CreateTaskDto),
    ).rejects.toBeInstanceOf(TaskValidationError);
    expect(await prisma.scheduledTask.count()).toBe(0);
  });
  it("validates updates against the existing task type before mutating or rescheduling", async () => {
    const task = await service.createTask(input);
    const reschedule = vi.spyOn(scheduler, "rescheduleTask");
    for (const patch of [
      { payload: { command: "echo" } },
      { payload: null },
      { type: "http" },
      { schedule: "" },
    ]) {
      await expect(
        service.updateTask(task.id, patch as UpdateTaskDto),
      ).rejects.toBeInstanceOf(TaskValidationError);
    }
    expect(await service.getTask(task.id)).toEqual(task);
    expect(reschedule).not.toHaveBeenCalled();
  });
  it("reports missing tasks consistently", async () => {
    for (const operation of [
      service.updateTask("missing", {}),
      service.deleteTask("missing"),
      service.enableTask("missing"),
      service.disableTask("missing"),
      service.triggerTask("missing"),
      service.getExecutions("missing"),
    ]) {
      await expect(operation).rejects.toBeInstanceOf(TaskNotFoundError);
    }
    expect(await prisma.taskExecution.count()).toBe(0);
  });
  it("requires rescheduling to reenable a consumed one-time task", async () => {
    const task = await service.createTask({
      ...input,
      schedule: "delay:10000",
    });
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: { runAt: null, enabled: false },
    });
    await expect(service.enableTask(task.id)).rejects.toBeInstanceOf(
      TaskValidationError,
    );
    await service.updateTask(task.id, { schedule: "delay:10000" });
    expect((await service.enableTask(task.id)).enabled).toBe(true);
  });
});
