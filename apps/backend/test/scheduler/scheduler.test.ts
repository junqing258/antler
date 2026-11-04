import cron from "node-cron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { TaskExecutor } from "../../src/scheduler/executor.js";
import {
  CronScheduler,
  TaskRunningError,
  MAX_DELAY_MS,
  validateSchedule,
} from "../../src/scheduler/scheduler.js";
import { SchedulerService } from "../../src/scheduler/service.js";
import {
  TaskValidationError,
  type CreateTaskDto,
} from "../../src/scheduler/types.js";
import { deferred, schedulerDatabase } from "./helpers.js";

let prisma: PrismaClient;
let scheduler: CronScheduler;
let service: SchedulerService;
let run: ReturnType<typeof vi.fn>;
let release: (() => void) | undefined;
const input: CreateTaskDto = {
  name: "scheduled",
  type: "service",
  schedule: "0 * * * *",
  payload: { service: "test", method: "run" },
  timeout: 1000,
};
beforeEach(async () => {
  prisma = await schedulerDatabase();
  run = vi.fn(() => "done");
  release = undefined;
  scheduler = new CronScheduler(
    new TaskExecutor(prisma, new Map([["test", { run }]])),
    prisma,
  );
  service = new SchedulerService(prisma, scheduler);
  await scheduler.start();
});
afterEach(async () => {
  release?.();
  await scheduler.stop();
  await prisma.$disconnect();
});
function blockRun() {
  const gate = deferred();
  release = () => gate.resolve("done");
  run.mockImplementation(() => gate.promise);
}
const complete = (id: string) =>
  expect
    .poll(async () => (await service.getTask(id))?.lastExecutedAt, {
      interval: 10,
    })
    .not.toBeNull();

describe("CronScheduler", () => {
  it("keeps an active one-time task enabled through non-schedule edits and retries", async () => {
    const gate = deferred();
    release = () => gate.resolve(undefined);
    run
      .mockImplementationOnce(async () => {
        await gate.promise;
        throw new Error("retry me");
      })
      .mockReturnValue("retried");
    const task = await service.createTask({
      ...input,
      schedule: "delay:10000",
      retryCount: 1,
      retryDelay: 10,
    });
    await service.triggerTask(task.id);
    const edited = await service.updateTask(task.id, {
      name: "renamed while running",
    });
    expect(edited).toMatchObject({ enabled: true, runAt: null });
    expect((await service.getTask(task.id))?.enabled).toBe(true);
    release();
    await expect
      .poll(async () => (await service.getTask(task.id))?.enabled)
      .toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("discards a cron callback superseded during its database lookup", async () => {
    const task = await service.createTask(input);
    const cronJob = [...cron.getTasks().values()][0];
    const gate = deferred<typeof task>();
    const entered = deferred<void>();
    release = () => gate.resolve(task);
    vi.spyOn(prisma.scheduledTask, "findUnique").mockImplementationOnce(() => {
      entered.resolve(undefined);
      return gate.promise as unknown as ReturnType<
        typeof prisma.scheduledTask.findUnique
      >;
    });
    void cronJob.execute();
    await entered.promise;
    await service.updateTask(task.id, { schedule: "delay:10000" });
    release();
    await scheduler.stop();
    expect(run).not.toHaveBeenCalled();
    expect((await service.getTask(task.id))?.runAt).not.toBeNull();
    expect(await prisma.taskExecution.count()).toBe(0);
  });
  it("shares the lock between simultaneous manual triggers before the first database await", async () => {
    blockRun();
    const task = await service.createTask(input);
    const outcomes = await Promise.allSettled([
      service.triggerTask(task.id),
      service.triggerTask(task.id),
    ]);
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1]).toMatchObject({
      status: "rejected",
      reason: expect.any(TaskRunningError),
    });
    expect(await prisma.taskExecution.count()).toBe(1);
    await expect.poll(() => run.mock.calls.length).toBe(1);
    expect((await service.getExecutions(task.id))[0].status).toBe("running");
    release!();
    await complete(task.id);
  });
  it("keeps the lock across rescheduling", async () => {
    blockRun();
    const task = await service.createTask(input);
    await service.triggerTask(task.id);
    await service.updateTask(task.id, {
      name: "new name",
      schedule: "1 * * * *",
    });
    await expect(service.triggerTask(task.id)).rejects.toBeInstanceOf(
      TaskRunningError,
    );
    release!();
    await complete(task.id);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("executes cron ticks, disables scheduling and destroys cron registry entries", async () => {
    const baseline = cron.getTasks().size;
    const task = await service.createTask({
      ...input,
      schedule: "* * * * * *",
    });
    expect(cron.getTasks().size).toBe(baseline + 1);
    await expect
      .poll(() => run.mock.calls.length, { timeout: 2500, interval: 10 })
      .toBeGreaterThan(0);
    await service.disableTask(task.id);
    expect(cron.getTasks().size).toBe(baseline);
  });
  it("retries failures with separate linked executions", async () => {
    run
      .mockImplementationOnce(() => {
        throw new Error("temporary");
      })
      .mockReturnValue("recovered");
    const task = await service.createTask({
      ...input,
      retryCount: 2,
      retryDelay: 10,
    });
    const initial = await service.triggerTask(task.id);
    await complete(task.id);
    const executions = await service.getExecutions(task.id);
    expect(executions).toHaveLength(2);
    expect(
      executions.find((execution) => execution.id === initial.id),
    ).toMatchObject({ status: "failed", retryAttempt: 0, taskId: task.id });
    expect(
      executions.find((execution) => execution.retryAttempt === 1),
    ).toMatchObject({ status: "succeeded", taskId: task.id });
  });
  it("uses updated retry payload and retry count", async () => {
    blockRun();
    const updated = vi.fn(() => "new config");
    // Replace the registry via a separately constructed executor, not scheduler internals.
    await scheduler.stop();
    scheduler = new CronScheduler(
      new TaskExecutor(prisma, new Map([["test", { run, updated }]])),
      prisma,
    );
    service = new SchedulerService(prisma, scheduler);
    await scheduler.start();
    const task = await service.createTask({
      ...input,
      timeout: 40,
      retryCount: 2,
      retryDelay: 30,
    });
    await service.triggerTask(task.id);
    await service.updateTask(task.id, {
      payload: { service: "test", method: "updated" },
      retryCount: 1,
    });
    await complete(task.id);
    expect(updated).toHaveBeenCalledOnce();
    expect(
      (await service.getExecutions(task.id)).map(
        (execution) => execution.status,
      ),
    ).toContain("timeout");
  });
  it.each(["disable", "delete"])(
    "stops pending retries on %s",
    async (action) => {
      run.mockImplementation(() => {
        throw new Error("failed");
      });
      const task = await service.createTask({
        ...input,
        retryCount: 3,
        retryDelay: 10000,
      });
      await service.triggerTask(task.id);
      await expect
        .poll(async () => (await service.getExecutions(task.id))[0].status)
        .toBe("failed");
      if (action === "disable") await service.disableTask(task.id);
      else await service.deleteTask(task.id);
      await scheduler.stop();
      expect(run).toHaveBeenCalledOnce();
      if (action === "delete")
        expect(await prisma.taskExecution.count()).toBe(0);
    },
  );
  it("does not wait a retry interval if disabled during execution", async () => {
    blockRun();
    const task = await service.createTask({
      ...input,
      timeout: 30,
      retryCount: 2,
      retryDelay: 10000,
    });
    await service.triggerTask(task.id);
    await service.disableTask(task.id);
    await expect
      .poll(async () => (await service.getTask(task.id))?.lastExecutedAt, {
        timeout: 500,
      })
      .not.toBeNull();
    expect(run).toHaveBeenCalledOnce();
  });
  it("stop waits for accepted work and rejects new triggers", async () => {
    blockRun();
    const task = await service.createTask(input);
    // Begin shutdown while the manual trigger is still preparing its database record.
    const accepted = service.triggerTask(task.id);
    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    const execution = await accepted;
    expect(stopped).toBe(false);
    await expect(service.triggerTask(task.id)).rejects.toBeInstanceOf(
      TaskValidationError,
    );
    release!();
    await stopping;
    expect((await service.getExecution(execution.id))?.status).toBe(
      "succeeded",
    );
  });
  it("does not register timers after stop and restores enabled jobs on restart", async () => {
    const task = await service.createTask(input);
    await scheduler.stop();
    await service.updateTask(task.id, { schedule: "* * * * * *" });
    expect(cron.getTasks().size).toBe(0);
    await scheduler.start();
    await expect
      .poll(() => run.mock.calls.length, { timeout: 2500 })
      .toBeGreaterThan(0);
  });
  it("runs a delay once, consumes runAt, disables it and never replays it after restart", async () => {
    const task = await service.createTask({ ...input, schedule: "delay:20" });
    await expect
      .poll(async () => (await service.getTask(task.id))?.enabled)
      .toBe(false);
    expect((await service.getTask(task.id))?.runAt).toBeNull();
    expect(run).toHaveBeenCalledOnce();
    await scheduler.stop();
    await scheduler.start();
    expect(run).toHaveBeenCalledOnce();
    expect(await prisma.taskExecution.count()).toBe(1);
  });
  it("restores one-time jobs using persisted remaining time, including overdue ones", async () => {
    const task = await service.createTask({
      ...input,
      schedule: "delay:10000",
    });
    await scheduler.stop();
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: { runAt: new Date(Date.now() - 100) },
    });
    await scheduler.start();
    await expect
      .poll(async () => (await service.getTask(task.id))?.enabled, {
        timeout: 500,
      })
      .toBe(false);
    expect(run).toHaveBeenCalledOnce();
  });
  it("disables consumed jobs and finalizes interrupted execution rows on startup", async () => {
    const task = await service.createTask({
      ...input,
      schedule: "delay:10000",
    });
    await scheduler.stop();
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: { runAt: null },
    });
    const interrupted = await prisma.taskExecution.create({
      data: { taskId: task.id },
    });
    await scheduler.start();
    expect((await service.getTask(task.id))?.enabled).toBe(false);
    expect(await service.getExecution(interrupted.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("interrupted"),
    });
    expect(run).not.toHaveBeenCalled();
  });
  it("preserves a new delay schedule while the previous one-time execution finishes", async () => {
    blockRun();
    const task = await service.createTask({
      ...input,
      schedule: "delay:10000",
    });
    await service.triggerTask(task.id);
    await service.updateTask(task.id, { schedule: "delay:20" });
    await expect.poll(() => run.mock.calls.length).toBe(1);
    run.mockReturnValue("next execution");
    release!();
    await expect.poll(() => run.mock.calls.length, { timeout: 1000 }).toBe(2);
    await expect
      .poll(async () => (await service.getTask(task.id))?.enabled)
      .toBe(false);
    expect(await prisma.taskExecution.count()).toBe(2);
  });
  it("rejects disabled manual triggers without creating dangling executions", async () => {
    const task = await service.createTask({ ...input, enabled: false });
    await expect(service.triggerTask(task.id)).rejects.toBeInstanceOf(
      TaskValidationError,
    );
    expect(await prisma.taskExecution.count()).toBe(0);
  });
  it("accepts valid bounds and rejects coercible invalid delays", () => {
    for (const schedule of [
      "delay:0",
      `delay:${MAX_DELAY_MS}`,
      "*/5 * * * *",
      "* * * * * *",
    ])
      expect(() => validateSchedule(schedule)).not.toThrow();
    for (const schedule of [
      "delay:",
      "delay: ",
      "delay:1e3",
      "delay:1.2",
      "delay:-1",
      `delay:${MAX_DELAY_MS + 1}`,
    ])
      expect(() => validateSchedule(schedule)).toThrow(TaskValidationError);
  });
});
