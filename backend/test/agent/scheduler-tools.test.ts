import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { createSchedulerTools } from "../../src/agent/scheduler-tools.js";
import { REDACTED, SecretGuard } from "../../src/agent/secret-guard.js";
import { TaskExecutor } from "../../src/scheduler/executor.js";
import { CronScheduler, MAX_DELAY_MS } from "../../src/scheduler/scheduler.js";
import { SchedulerService } from "../../src/scheduler/service.js";
import { schedulerDatabase } from "../scheduler/helpers.js";

let prisma: PrismaClient;
let scheduler: CronScheduler;
let service: SchedulerService;
let tools: ReturnType<typeof createSchedulerTools>;
const secret = "scheduler-test-secret-value";
const input = {
  name: "汇总待办",
  message: " 检查默认工作区并汇总待办事项 ",
  schedule: "0 9 * * *",
};
const execute = (args: Record<string, unknown>, signal?: AbortSignal) =>
  tools
    .find((tool) => tool.name === "create_scheduled_task")!
    .execute("create", args, signal);

beforeEach(async () => {
  prisma = await schedulerDatabase();
  scheduler = new CronScheduler(new TaskExecutor(prisma), prisma);
  service = new SchedulerService(prisma, scheduler);
  tools = createSchedulerTools(
    service,
    new SecretGuard(undefined, () => ({}), [secret]),
  );
  await scheduler.start();
});
afterEach(async () => {
  await scheduler.stop();
  await prisma.$disconnect();
});

describe("Agent scheduler tools", () => {
  it("persists a recurring Agent task visible to the platform service", async () => {
    const result = await execute(input);
    const { tasks, total } = await service.listTasks();
    expect(total).toBe(1);
    expect(tasks[0]).toMatchObject({
      name: input.name,
      type: "service",
      schedule: input.schedule,
      enabled: true,
      retryCount: 0,
      runAt: null,
      payload: {
        service: "taskService",
        method: "create",
        args: [input.message.trim()],
      },
    });
    expect(
      JSON.parse(
        result.content[0].type === "text" ? result.content[0].text : "",
      ),
    ).toMatchObject({
      id: tasks[0].id,
      schedule: input.schedule,
      enabled: true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("persists a one-time deadline and supports creating a disabled task", async () => {
    const before = Date.now();
    await execute({ ...input, schedule: "delay:600000", enabled: false });
    const { tasks } = await service.listTasks();
    expect(tasks[0].enabled).toBe(false);
    expect(tasks[0].runAt!.getTime()).toBeGreaterThanOrEqual(before + 600000);
    expect(tasks[0].runAt!.getTime()).toBeLessThanOrEqual(Date.now() + 600000);
  });

  it.each([
    { message: "  " },
    { name: "  " },
    { schedule: "not a schedule" },
    { schedule: `delay:${MAX_DELAY_MS + 1}` },
  ])("rejects invalid input without persistence: %j", async (changes) => {
    await expect(execute({ ...input, ...changes })).rejects.toThrow();
    expect(await prisma.scheduledTask.count()).toBe(0);
  });

  it("does not create a task after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(execute(input, controller.signal)).rejects.toThrow();
    expect(await prisma.scheduledTask.count()).toBe(0);
  });

  it("redacts credentials before persistence and in errors", async () => {
    await execute({ ...input, message: `Check ${secret}` });
    expect((await service.listTasks()).tasks[0].payload).toMatchObject({
      args: [`Check ${REDACTED}`],
    });
    vi.spyOn(service, "createTask").mockRejectedValueOnce(
      new Error(`Failed ${secret}`),
    );
    await expect(execute(input)).rejects.toThrow(`Failed ${REDACTED}`);
  });

  it("returns fresh server time and its timezone", async () => {
    const clock = tools.find((tool) => tool.name === "get_scheduler_time")!;
    const before = Date.now();
    const result = await clock.execute("clock", {});
    const details = result.details as { currentTime: string; timezone: string };
    expect(Date.parse(details.currentTime)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(details.currentTime)).toBeLessThanOrEqual(Date.now());
    expect(details.timezone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
});
