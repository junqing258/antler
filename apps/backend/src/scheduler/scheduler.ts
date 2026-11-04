import cron, { type ScheduledTask as CronTask } from "node-cron";
import { setTimeout as delay } from "node:timers/promises";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  TaskNotFoundError,
  TaskValidationError,
  type ScheduledTask,
  type TaskExecution,
} from "./types.js";
import type { TaskExecutor } from "./executor.js";

export const MAX_DELAY_MS = 2 ** 31 - 1;
interface ScheduledJob {
  task: ScheduledTask;
  cronJob?: CronTask;
  timeoutHandle?: NodeJS.Timeout;
}
export class TaskRunningError extends Error {
  constructor(taskId: string) {
    super(`任务 ${taskId} 正在执行中`);
  }
}
export function validateSchedule(schedule: string): void {
  if (typeof schedule !== "string" || !schedule.trim())
    throw new TaskValidationError("schedule 必须是非空字符串");
  if (schedule.startsWith("delay:")) {
    const value = schedule.slice(6);
    const milliseconds = Number(value);
    if (
      !/^\d+$/.test(value) ||
      !Number.isInteger(milliseconds) ||
      milliseconds > MAX_DELAY_MS
    ) {
      throw new TaskValidationError(
        `Invalid delay schedule: ${schedule} (0 ~ ${MAX_DELAY_MS}ms)`,
      );
    }
  } else if (!cron.validate(schedule)) {
    throw new TaskValidationError(`Invalid cron expression: ${schedule}`);
  }
}

export class CronScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private runningTasks = new Set<string>();
  private inFlight = new Set<Promise<void>>();
  private retryWaiters = new Map<string, AbortController>();
  private running = false;

  constructor(
    private executor: TaskExecutor,
    private prisma: PrismaClient,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // A process crash must not leave executions permanently running.
      await this.prisma.taskExecution.updateMany({
        where: { status: "running" },
        data: {
          status: "failed",
          error: "Execution interrupted by server restart",
          finishedAt: new Date(),
        },
      });
      const tasks = await this.prisma.scheduledTask.findMany({
        where: { enabled: true },
      });
      for (const task of tasks) {
        try {
          await this.scheduleTask(task);
        } catch (error) {
          console.error(
            `[Scheduler] Failed to schedule task ${task.id}:`,
            error,
          );
        }
      }
      console.log(`[Scheduler] Started with ${this.jobs.size} active jobs`);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const taskId of this.jobs.keys()) this.unscheduleTask(taskId);
    for (const controller of this.retryWaiters.values()) controller.abort();
    // Includes task lookup/record creation, not just executor work.
    await Promise.allSettled([...this.inFlight]);
    console.log("[Scheduler] Stopped");
  }

  async scheduleTask(task: ScheduledTask): Promise<void> {
    this.unscheduleTask(task.id);
    if (!task.enabled || !this.running) return;
    validateSchedule(task.schedule);
    const job: ScheduledJob = { task };
    if (task.schedule.startsWith("delay:")) {
      if (!task.runAt) {
        if (this.runningTasks.has(task.id)) return;
        await this.prisma.scheduledTask.updateMany({
          where: { id: task.id, schedule: task.schedule, runAt: null },
          data: { enabled: false },
        });
        return;
      }
      this.jobs.set(task.id, job);
      this.armDelay(job);
    } else {
      job.cronJob = cron.schedule(task.schedule, () => this.runJob(job));
      this.jobs.set(task.id, job);
    }
    console.log(`[Scheduler] Scheduled task ${task.id}: ${task.schedule}`);
  }

  unscheduleTask(taskId: string): void {
    const job = this.jobs.get(taskId);
    job?.cronJob?.destroy();
    if (job?.timeoutHandle) clearTimeout(job.timeoutHandle);
    this.jobs.delete(taskId);
  }

  cancelRetries(taskId: string): void {
    this.retryWaiters.get(taskId)?.abort();
  }
  rescheduleTask(task: ScheduledTask): Promise<void> {
    return this.scheduleTask(task);
  }

  private armDelay(job: ScheduledJob, wait?: number): void {
    const remaining = Math.max(0, job.task.runAt!.getTime() - Date.now());
    job.timeoutHandle = setTimeout(
      () => {
        if (remaining > MAX_DELAY_MS && wait === undefined) this.armDelay(job);
        else void this.runJob(job);
      },
      wait ?? Math.min(remaining, MAX_DELAY_MS),
    );
  }

  private runJob(job: ScheduledJob): Promise<void> {
    if (!this.running || this.jobs.get(job.task.id) !== job)
      return Promise.resolve();
    if (this.runningTasks.has(job.task.id)) {
      // A newly rescheduled one-time task must survive the previous execution's lock.
      if (job.task.runAt) this.armDelay(job, 50);
      return Promise.resolve();
    }
    return this.spawnRun(job.task.id, undefined, job);
  }

  trigger(taskId: string): Promise<TaskExecution> {
    if (!this.running)
      return Promise.reject(new TaskValidationError("调度器未启动或正在关闭"));
    if (this.runningTasks.has(taskId))
      return Promise.reject(new TaskRunningError(taskId));
    return new Promise((resolve, reject) => {
      void this.spawnRun(taskId, { resolve, reject });
    });
  }

  private spawnRun(
    taskId: string,
    accepted?: {
      resolve: (execution: TaskExecution) => void;
      reject: (error: unknown) => void;
    },
    scheduledJob?: ScheduledJob,
  ): Promise<void> {
    // Reserve before any database await, including manual record creation.
    this.runningTasks.add(taskId);
    let executionId: string | undefined;
    const promise = (async () => {
      try {
        const task = await this.prisma.scheduledTask.findUnique({
          where: { id: taskId },
        });
        if (!task) throw new TaskNotFoundError();
        if (!task.enabled) throw new TaskValidationError("任务已禁用");
        if (
          scheduledJob &&
          (!this.running ||
            this.jobs.get(taskId) !== scheduledJob ||
            task.schedule !== scheduledJob.task.schedule ||
            task.runAt?.getTime() !== scheduledJob.task.runAt?.getTime())
        )
          return;
        const oneTime = task.schedule.startsWith("delay:");
        if (oneTime) {
          if (!task.runAt)
            throw new TaskValidationError(
              "一次性任务已领取，请修改 schedule 后重新执行",
            );
          const claimed = await this.prisma.scheduledTask.updateMany({
            where: {
              id: taskId,
              enabled: true,
              schedule: task.schedule,
              runAt: task.runAt,
            },
            data: { runAt: null },
          });
          if (!claimed.count)
            throw new TaskValidationError("任务配置已变更或已领取");
          const job = this.jobs.get(taskId);
          if (
            job?.task.schedule === task.schedule &&
            job.task.runAt?.getTime() === task.runAt.getTime()
          ) {
            this.unscheduleTask(taskId);
          }
        }
        const initial = await this.prisma.taskExecution.create({
          data: { taskId, userId: task.userId },
        });
        executionId = initial.id;
        accepted?.resolve(initial);
        console.log(`[Scheduler] Running task ${taskId}: ${task.name}`);
        const execution = await this.executeWithRetry(task, initial.id);
        await this.prisma.scheduledTask.updateMany({
          where: { id: taskId },
          data: { lastExecutedAt: new Date() },
        });
        if (oneTime) {
          // Do not disable a schedule reset while this execution was in flight.
          await this.prisma.scheduledTask.updateMany({
            where: { id: taskId, schedule: task.schedule, runAt: null },
            data: { enabled: false },
          });
        }
        console.log(
          `[Scheduler] Task ${taskId} completed with status: ${execution.status}`,
        );
      } catch (error) {
        accepted?.reject(error);
        if (executionId) {
          await this.prisma.taskExecution
            .updateMany({
              where: { id: executionId, status: "running" },
              data: {
                status: "failed",
                finishedAt: new Date(),
                error: error instanceof Error ? error.message : String(error),
              },
            })
            .catch((failure: unknown) =>
              console.error(
                "[Scheduler] Failed to finalize execution:",
                failure,
              ),
            );
        }
        console.error(`[Scheduler] Error running task ${taskId}:`, error);
      }
    })().finally(() => {
      this.runningTasks.delete(taskId);
      this.inFlight.delete(promise);
    });
    this.inFlight.add(promise);
    return promise;
  }

  private async executeWithRetry(
    task: ScheduledTask,
    executionId: string,
  ): Promise<TaskExecution> {
    let current = task;
    let result = await this.executor.executeResult(current, {
      executionId,
      retryAttempt: 0,
    });
    let execution = result.execution;
    for (
      let attempt = 1;
      result.retryable !== false &&
      execution.status !== "succeeded" &&
      attempt <= current.retryCount &&
      this.running;
      attempt++
    ) {
      const beforeWait = await this.prisma.scheduledTask.findUnique({
        where: { id: task.id },
      });
      if (
        !this.running ||
        !beforeWait?.enabled ||
        attempt > beforeWait.retryCount
      )
        break;
      current = beforeWait;
      const controller = new AbortController();
      this.retryWaiters.set(task.id, controller);
      try {
        await delay(current.retryDelay, undefined, {
          signal: controller.signal,
        });
      } catch {
        break;
      } finally {
        this.retryWaiters.delete(task.id);
      }
      const fresh = await this.prisma.scheduledTask.findUnique({
        where: { id: task.id },
      });
      if (!this.running || !fresh?.enabled || attempt > fresh.retryCount) break;
      current = fresh;
      console.log(`[Scheduler] Retrying task ${task.id}, attempt ${attempt}`);
      result = await this.executor.executeResult(current, {
        retryAttempt: attempt,
      });
      execution = result.execution;
    }
    return execution;
  }
}
