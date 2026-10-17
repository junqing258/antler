import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import {
  TaskNotFoundError,
  TaskValidationError,
  type ScheduledTask,
  type TaskExecution,
  type CreateTaskDto,
  type UpdateTaskDto,
  type TaskFilter,
  type TaskListResult,
} from "./types.js";
import { CronScheduler, MAX_DELAY_MS, validateSchedule } from "./scheduler.js";
import { currentRunUserId } from "../run-context.js";

const TASK_TYPES = ["http", "service", "script"];
const FIELDS = [
  "name",
  "description",
  "schedule",
  "enabled",
  "payload",
  "retryCount",
  "retryDelay",
  "timeout",
];
function invalid(message: string): never {
  throw new TaskValidationError(message);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && !!value.trim();
}
function stringMap(value: unknown): boolean {
  return (
    record(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
function integer(value: unknown, min: number, max: number, name: string): void {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  )
    invalid(`${name} 必须是 ${min}-${max} 的整数`);
}
function validateInput(data: unknown, creating: boolean): void {
  if (!record(data)) invalid("请求必须是对象");
  for (const field of Object.keys(data)) {
    if (!FIELDS.includes(field) && !(creating && field === "type"))
      invalid(`不支持的字段: ${field}`);
  }
  if ((creating || data.name !== undefined) && !nonempty(data.name))
    invalid("name 必须是非空字符串");
  if (data.description !== undefined && typeof data.description !== "string")
    invalid("description 必须是字符串");
  if (data.enabled !== undefined && typeof data.enabled !== "boolean")
    invalid("enabled 必须是布尔值");
  if (creating || data.schedule !== undefined)
    validateSchedule(data.schedule as string);
  if (data.retryCount !== undefined)
    integer(data.retryCount, 0, 10, "retryCount");
  if (data.retryDelay !== undefined)
    integer(data.retryDelay, 0, MAX_DELAY_MS, "retryDelay");
  if (data.timeout !== undefined)
    integer(data.timeout, 1, MAX_DELAY_MS, "timeout");
}
function validatePayload(type: string, payload: unknown): void {
  if (!TASK_TYPES.includes(type))
    invalid("type 必须是 http、service 或 script");
  if (!record(payload)) invalid("payload 必须是对象");
  if (type === "http") {
    if (
      !nonempty(payload.url) ||
      !URL.canParse(payload.url) ||
      !["http:", "https:"].includes(new URL(payload.url).protocol)
    )
      invalid("payload.url 必须是 http(s) URL");
    if (
      !["GET", "POST", "PUT", "DELETE", "PATCH"].includes(
        payload.method as string,
      )
    )
      invalid("payload.method 无效");
    if (payload.method === "GET" && payload.body !== undefined)
      invalid("GET 任务不能设置 body");
    if (payload.headers !== undefined && !stringMap(payload.headers))
      invalid("payload.headers 必须是字符串映射");
    if (
      payload.expectedStatus !== undefined &&
      (!Array.isArray(payload.expectedStatus) ||
        !payload.expectedStatus.length ||
        !payload.expectedStatus.every(
          (code) => Number.isInteger(code) && code >= 100 && code <= 599,
        ))
    )
      invalid("payload.expectedStatus 必须是非空 HTTP 状态码数组");
  } else if (type === "service") {
    if (
      !nonempty(payload.service) ||
      !nonempty(payload.method) ||
      ["constructor", "__proto__", "prototype"].includes(payload.method)
    )
      invalid("payload.service / payload.method 无效");
    if (payload.args !== undefined && !Array.isArray(payload.args))
      invalid("payload.args 必须是数组");
  } else {
    if (!nonempty(payload.command) || payload.command.includes("\0"))
      invalid("payload.command 必须是非空命令");
    if (
      payload.args !== undefined &&
      (!Array.isArray(payload.args) ||
        !payload.args.every(
          (arg) => typeof arg === "string" && !arg.includes("\0"),
        ))
    )
      invalid("payload.args 必须是字符串数组");
    if (
      payload.cwd !== undefined &&
      (!nonempty(payload.cwd) || payload.cwd.includes("\0"))
    )
      invalid("payload.cwd 必须是路径字符串");
    if (
      payload.env !== undefined &&
      (!stringMap(payload.env) ||
        Object.entries(payload.env as Record<string, string>).some(
          ([key, value]) => !key || /[=\0]/.test(key) || value.includes("\0"),
        ))
    )
      invalid("payload.env 必须是合法字符串映射");
  }
}

export class SchedulerService {
  constructor(
    private prisma: PrismaClient,
    private scheduler: CronScheduler,
  ) {}

  async createTask(data: CreateTaskDto, userId?: string): Promise<ScheduledTask> {
    validateInput(data, true);
    validatePayload(data.type, data.payload);
    // 无显式归属时继承当前运行的所属用户（Agent 工具创建的任务）。
    const owner = userId ?? currentRunUserId() ?? "";
    const task = await this.prisma.scheduledTask.create({
      data: {
        userId: owner,
        name: data.name,
        description: data.description,
        type: data.type,
        schedule: data.schedule,
        enabled: data.enabled ?? true,
        payload: data.payload as unknown as Prisma.InputJsonValue,
        retryCount: data.retryCount ?? 0,
        retryDelay: data.retryDelay ?? 60000,
        timeout: data.timeout ?? 300000,
        runAt: this.runAt(data.schedule),
      },
    });
    await this.scheduler.scheduleTask(task);
    return task;
  }

  async updateTask(
    id: string,
    data: UpdateTaskDto,
    userId?: string,
  ): Promise<ScheduledTask> {
    validateInput(data, false);
    const existing = await this.requireTask(id, userId);
    validatePayload(
      existing.type,
      data.payload !== undefined ? data.payload : existing.payload,
    );
    const task = await this.prisma.scheduledTask.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        schedule: data.schedule,
        enabled: data.enabled,
        payload: data.payload as unknown as Prisma.InputJsonValue | undefined,
        retryCount: data.retryCount,
        retryDelay: data.retryDelay,
        timeout: data.timeout,
        ...(data.schedule !== undefined
          ? { runAt: this.runAt(data.schedule) }
          : {}),
      },
    });
    if (!task.enabled) this.scheduler.cancelRetries(id);
    await this.scheduler.rescheduleTask(task);
    return task;
  }

  async deleteTask(id: string, userId?: string): Promise<void> {
    await this.requireTask(id, userId);
    await this.prisma.scheduledTask.delete({ where: { id } });
    this.scheduler.unscheduleTask(id);
    this.scheduler.cancelRetries(id);
  }
  async getTask(id: string, userId?: string): Promise<ScheduledTask | null> {
    const task = await this.prisma.scheduledTask.findUnique({ where: { id } });
    if (!task || (userId !== undefined && task.userId !== userId)) return null;
    return task;
  }
  private async requireTask(id: string, userId?: string): Promise<ScheduledTask> {
    const task = await this.getTask(id, userId);
    if (!task) throw new TaskNotFoundError();
    return task;
  }
  private runAt(schedule: string): Date | null {
    return schedule.startsWith("delay:")
      ? new Date(Date.now() + Number(schedule.slice(6)))
      : null;
  }

  async listTasks(filter: TaskFilter = {}, userId?: string): Promise<TaskListResult> {
    const page = filter.page ?? 1;
    const requestedLimit = filter.limit ?? 20;
    integer(page, 1, Number.MAX_SAFE_INTEGER, "page");
    integer(requestedLimit, 1, Number.MAX_SAFE_INTEGER, "limit");
    const limit = Math.min(requestedLimit, 200);
    if (!Number.isSafeInteger((page - 1) * limit)) invalid("page 超出范围");
    if (filter.type !== undefined && !TASK_TYPES.includes(filter.type))
      invalid("type 无效");
    if (filter.enabled !== undefined && typeof filter.enabled !== "boolean")
      invalid("enabled 无效");
    const where: Prisma.ScheduledTaskWhereInput = {
      enabled: filter.enabled,
      type: filter.type,
      ...(userId !== undefined ? { userId } : {}),
    };
    const [tasks, total] = await this.prisma.$transaction([
      this.prisma.scheduledTask.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.scheduledTask.count({ where }),
    ]);
    return { tasks, total, page, limit };
  }
  async enableTask(id: string, userId?: string): Promise<ScheduledTask> {
    const existing = await this.requireTask(id, userId);
    validateSchedule(existing.schedule);
    validatePayload(existing.type, existing.payload);
    if (existing.schedule.startsWith("delay:") && !existing.runAt)
      invalid("一次性任务已领取，请修改 schedule 后重新启用");
    const task = await this.prisma.scheduledTask.update({
      where: { id },
      data: { enabled: true },
    });
    await this.scheduler.scheduleTask(task);
    return task;
  }
  async disableTask(id: string, userId?: string): Promise<ScheduledTask> {
    await this.requireTask(id, userId);
    const task = await this.prisma.scheduledTask.update({
      where: { id },
      data: { enabled: false },
    });
    this.scheduler.unscheduleTask(id);
    this.scheduler.cancelRetries(id);
    return task;
  }
  triggerTask(id: string, userId?: string): Promise<TaskExecution> {
    // Keep the no-owner path synchronous: scheduler.trigger must observe its
    // running state before any concurrent stop() can flip it.
    if (userId === undefined) return this.scheduler.trigger(id);
    return this.requireTask(id, userId).then(() => this.scheduler.trigger(id));
  }
  async getExecutions(
    taskId: string,
    limit = 50,
    userId?: string,
  ): Promise<TaskExecution[]> {
    integer(limit, 1, Number.MAX_SAFE_INTEGER, "limit");
    await this.requireTask(taskId, userId);
    return this.prisma.taskExecution.findMany({
      where: { taskId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: Math.min(limit, 200),
    });
  }
  async getExecution(
    executionId: string,
    userId?: string,
  ): Promise<TaskExecution | null> {
    const execution = await this.prisma.taskExecution.findUnique({
      where: { id: executionId },
    });
    if (!execution || (userId !== undefined && execution.userId !== userId))
      return null;
    return execution;
  }
}
