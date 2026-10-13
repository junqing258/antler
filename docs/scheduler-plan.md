# 定时任务模块设计方案

> 为 Antler 项目（Node.js + TypeScript + Fastify + Prisma + SQLite）新增定时任务调度模块。
>
> 文档版本: v1.2 · 最后更新: 2026-10-13

## 目录

1. [需求分析](#1-需求分析)
2. [架构设计](#2-架构设计)
3. [数据库设计](#3-数据库设计)
4. [核心模块实现](#4-核心模块实现)
5. [API 设计](#5-api-设计)
6. [主应用集成](#6-主应用集成)
7. [测试方案](#7-测试方案)
8. [使用指南](#8-使用指南)
9. [实施计划](#9-实施计划)
10. [安全与运维](#10-安全与运维)
11. [扩展方向](#11-扩展方向)
12. [FAQ](#12-faq)

---

## 1. 需求分析

### 1.1 核心功能

| 功能 | 说明 |
|------|------|
| 任务管理 | 创建、查询、更新、删除、启用/禁用定时任务 |
| 调度能力 | Cron 表达式调度 + 一次性延迟执行；服务启动自动加载活跃任务 |
| 任务类型 | HTTP 请求、内部服务调用、Shell 脚本执行 |
| 可靠性 | 失败重试、超时控制、并发防护、优雅启停 |
| 可观测性 | 执行状态跟踪、执行历史记录、日志 |

### 1.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 调度库 | **node-cron** | 轻量、标准 cron 语法、无外部依赖、易集成 |
| ORM | Prisma | 与项目现有技术栈一致 |
| 数据库 | SQLite | 项目已用，零配置；单机调度足够 |
| Web 框架 | Fastify | 与项目现有一致 |

### 1.3 明确不做的（YAGNI）

- ❌ 分布式调度（多实例协调）—— 后续有需要再扩展
- ❌ 任务依赖关系、优先级队列
- ❌ 可视化管理 UI —— 先做 API，前端后续单独迭代
- ❌ 通知/告警渠道 —— 可通过 HTTP 任务自身调用 webhook 实现

---

## 2. 架构设计

```
┌─────────────────────────────────────────────┐
│                API Layer                     │
│      routes/scheduler.ts (REST API)          │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Service Layer                   │
│          scheduler/service.ts                │
│     （任务 CRUD、启停控制、手动触发）           │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┴───────────┐
        │                      │
┌───────▼────────┐   ┌─────────▼───────┐
│ CronScheduler  │   │  TaskExecutor   │
│ scheduler.ts   │   │  executor.ts    │
│ • 加载/注册任务 │   │ • HTTP 执行      │
│ • Cron 调度     │   │ • Service 执行   │
│ • 并发控制      │   │ • Script 执行    │
│ • 重试管理      │   │ • 超时控制       │
└───────┬────────┘   └─────────┬───────┘
        └──────────┬───────────┘
                   │
        ┌──────────▼───────────┐
        │   Prisma ORM          │
        └──────────┬───────────┘
                   │
        ┌──────────▼───────────┐
        │   SQLite              │
        └───────────────────────┘
```

### 文件结构

```
backend/
├── prisma/schema.prisma                  # 新增 ScheduledTask / TaskExecution 模型
├── src/
│   ├── scheduler/
│   │   ├── types.ts                      # 类型定义
│   │   ├── executor.ts                   # 任务执行器
│   │   ├── scheduler.ts                  # 调度核心
│   │   └── service.ts                    # 服务层
│   ├── routes/scheduler.ts               # API 路由
│   └── app.ts                            # 集成点
└── test/scheduler/
    ├── executor.test.ts
    └── service.test.ts
```

---

## 3. 数据库设计

在 `backend/prisma/schema.prisma` 末尾追加：

```prisma
enum ScheduledTaskType {
  http
  service
  script
}

enum TaskExecutionStatus {
  running
  succeeded
  failed
  timeout
}

model ScheduledTask {
  id              String            @id @default(uuid())
  name            String
  description     String?
  type            ScheduledTaskType
  schedule        String            // cron 表达式或 "delay:毫秒"
  enabled         Boolean           @default(true)
  payload         Json
  retryCount      Int               @default(0)
  retryDelay      Int               @default(60000)  // 毫秒
  timeout         Int               @default(300000) // 毫秒
  runAt           DateTime?         // 一次性任务的预定执行时刻；NULL 表示非一次性或已领取
  lastExecutedAt  DateTime?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
  executions      TaskExecution[]

  @@map("scheduled_tasks")
}

model TaskExecution {
  id           String              @id @default(uuid())
  taskId       String
  status       TaskExecutionStatus @default(running)
  startedAt    DateTime            @default(now())
  finishedAt   DateTime?
  duration     Int?
  result       Json?
  error        String?
  retryAttempt Int                 @default(0)
  task         ScheduledTask       @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId, startedAt])
  @@map("task_executions")
}
```

**执行迁移：**

```bash
cd backend
pnpm db:migrate   # 迁移名称建议: add_scheduler_tables
pnpm db:generate
```

### Payload 结构（按任务类型）

```typescript
// HTTP 任务
interface HttpTaskPayload {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus?: number[];  // 默认 [200, 201, 204]
}

// Service 任务（调用 serviceRegistry 中注册的服务）
interface ServiceTaskPayload {
  service: string;   // 服务名，如 "taskService"
  method: string;    // 方法名
  args?: unknown[];  // 参数数组
}

// Script 任务
interface ScriptTaskPayload {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}
```

---

## 4. 核心模块实现

### 4.1 类型定义 — `backend/src/scheduler/types.ts`

```typescript
import type { ScheduledTask, TaskExecution } from "../generated/prisma/client.js";

export type { ScheduledTask, TaskExecution };
export { ScheduledTaskType, TaskExecutionStatus } from "../generated/prisma/client.js";

export interface HttpTaskPayload {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus?: number[];
}

export interface ServiceTaskPayload {
  service: string;
  method: string;
  args?: unknown[];
}

export interface ScriptTaskPayload {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type TaskPayload = HttpTaskPayload | ServiceTaskPayload | ScriptTaskPayload;

export interface CreateTaskDto {
  name: string;
  description?: string;
  type: "http" | "service" | "script";
  schedule: string;
  enabled?: boolean;
  payload: TaskPayload;
  retryCount?: number;
  retryDelay?: number;
  timeout?: number;
}

export interface UpdateTaskDto {
  name?: string;
  description?: string;
  schedule?: string;
  enabled?: boolean;
  payload?: TaskPayload;
  retryCount?: number;
  retryDelay?: number;
  timeout?: number;
}

export interface TaskFilter {
  enabled?: boolean;
  type?: "http" | "service" | "script";
  page?: number;
  limit?: number;
}

export interface TaskListResult {
  tasks: ScheduledTask[];
  total: number;
  page: number;
  limit: number;
}

export interface ExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
}
```

### 4.2 任务执行器 — `backend/src/scheduler/executor.ts`

```typescript
import type { PrismaClient } from "../generated/prisma/client.js";
import type { ScheduledTask, TaskExecution, ExecutionResult, HttpTaskPayload, ServiceTaskPayload, ScriptTaskPayload } from "./types.js";
import { TaskExecutionStatus } from "./types.js";
import { spawn } from "node:child_process";

const MAX_OUTPUT_CHARS = 64 * 1024; // script 输出截断上限，防止撑爆内存与 SQLite

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? text.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]"
    : text;
}

export class TaskExecutor {
  constructor(
    private prisma: PrismaClient,
    private serviceRegistry?: Map<string, any>,
    private enableScript = false, // script 任务默认禁用，见「10. 安全与运维」
  ) {}

  async execute(
    task: ScheduledTask,
    options: { retryAttempt?: number; executionId?: string } = {},
  ): Promise<TaskExecution> {
    const retryAttempt = options.retryAttempt ?? 0;
    // executionId 由调度器预创建（手动触发需立即返回执行记录），否则自建
    const execution = options.executionId
      ? { id: options.executionId }
      : await this.prisma.taskExecution.create({
          data: { taskId: task.id, status: TaskExecutionStatus.running, retryAttempt },
        });

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), task.timeout);

    // 各 execute* 方法内部捕获全部异常并以 ExecutionResult 返回；
    // 超时统一通过 signal.aborted 判定，保证 timeout 状态可达。
    let result: ExecutionResult;
    try {
      switch (task.type) {
        case "http":
          result = await this.executeHttp(task, controller.signal);
          break;
        case "service":
          result = await this.executeService(task, controller.signal);
          break;
        case "script":
          result = await this.executeScript(task, controller.signal);
          break;
        default:
          result = {
            success: false,
            error: `Unsupported task type: ${task.type}`,
            duration: 0,
          };
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const duration = Date.now() - startTime;
    const timedOut = !result.success && controller.signal.aborted;
    return await this.prisma.taskExecution.update({
      where: { id: execution.id },
      data: {
        status: result.success
          ? TaskExecutionStatus.succeeded
          : timedOut
            ? TaskExecutionStatus.timeout
            : TaskExecutionStatus.failed,
        finishedAt: new Date(),
        duration,
        result: result.data as any,
        error: result.error,
      },
    });
  }

  private async executeHttp(task: ScheduledTask, signal: AbortSignal): Promise<ExecutionResult> {
    const payload = task.payload as unknown as HttpTaskPayload;
    const startTime = Date.now();

    try {
      const headers: Record<string, string> = { ...payload.headers };
      if (
        payload.body !== undefined &&
        !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")
      ) {
        headers["content-type"] = "application/json";
      }
      const response = await fetch(payload.url, {
        method: payload.method || "GET",
        headers,
        body: payload.body !== undefined ? JSON.stringify(payload.body) : undefined,
        signal,
      });

      const expectedStatus = payload.expectedStatus || [200, 201, 204];
      const success = expectedStatus.includes(response.status);

      let data: unknown;
      // 正文只能读一次：先取原始文本，再尝试 JSON 解析（纯文本 200 不会误判为失败）
      const text = await response.text();
      try {
        data = text ? (JSON.parse(text) as unknown) : undefined;
      } catch {
        data = text;
      }

      return {
        success,
        data: { status: response.status, body: data },
        error: success ? undefined : `Unexpected status: ${response.status}`,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  private async executeService(task: ScheduledTask, signal: AbortSignal): Promise<ExecutionResult> {
    const payload = task.payload as unknown as ServiceTaskPayload;
    const startTime = Date.now();

    if (!this.serviceRegistry) {
      return { success: false, error: "Service registry not available", duration: 0 };
    }

    const service = this.serviceRegistry.get(payload.service);
    if (!service) {
      return { success: false, error: `Service not found: ${payload.service}`, duration: 0 };
    }

    const method = service[payload.method];
    if (typeof method !== "function") {
      return { success: false, error: `Method not found: ${payload.method}`, duration: 0 };
    }

    try {
      const result = await Promise.race([
        // 服务方法契约：调用时在末尾附加 AbortSignal。
        // 支持取消的服务应监听该 signal；不监听的服务超时后仍会继续运行，
        // 其重试会与旧调用重叠 —— 此类任务应设 retryCount: 0（见 §8.3）。
        method.apply(service, [...(payload.args || []), signal]),
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("Aborted")));
        }),
      ]);
      return { success: true, data: result, duration: Date.now() - startTime };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  private async executeScript(task: ScheduledTask, signal: AbortSignal): Promise<ExecutionResult> {
    const payload = task.payload as unknown as ScriptTaskPayload;
    const startTime = Date.now();

    if (!this.enableScript) {
      return {
        success: false,
        error: "Script tasks disabled (set ANTLER_SCHEDULER_ENABLE_SCRIPT=true to enable)",
        duration: 0,
      };
    }

    return new Promise((resolve) => {
      const child = spawn(payload.command, payload.args || [], {
        cwd: payload.cwd,
        // 不继承完整 process.env，避免子进程读取 API 密钥；仅透传 PATH 与显式声明的 env
        env: { PATH: process.env.PATH, ...payload.env },
        signal,
      });

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout = truncate(stdout + d.toString())));
      child.stderr?.on("data", (d) => (stderr = truncate(stderr + d.toString())));

      child.on("close", (code) => {
        const success = code === 0;
        resolve({
          success,
          data: { stdout, stderr, exitCode: code },
          error: success ? undefined : `Exit code: ${code}\n${stderr}`,
          duration: Date.now() - startTime,
        });
      });

      child.on("error", (error) => {
        resolve({ success: false, error: error.message, duration: Date.now() - startTime });
      });
    });
  }
}
```

### 4.3 调度核心 — `backend/src/scheduler/scheduler.ts`

先安装依赖：

```bash
cd backend
pnpm add node-cron   # v4+，自带类型声明，无需安装 @types/node-cron
```

```typescript
import cron from "node-cron";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { ScheduledTask, TaskExecution } from "./types.js";
import { TaskExecutionStatus } from "./types.js";
import { TaskExecutor } from "./executor.js";

// setTimeout 的 delay 超过 2^31-1ms（约 24.8 天）会被 Node 立即触发，需设上限
export const MAX_DELAY_MS = 2 ** 31 - 1;

interface ScheduledJob {
  task: ScheduledTask;
  cronJob?: cron.ScheduledTask;
  timeoutHandle?: NodeJS.Timeout;
}

/** 手动触发时任务已在执行 */
export class TaskRunningError extends Error {
  constructor(taskId: string) {
    super(`任务 ${taskId} 正在执行中`);
  }
}

/** 校验 schedule：cron 表达式或 "delay:毫秒"，非法时抛错（入库前调用，避免脏数据） */
export function validateSchedule(schedule: string): void {
  if (schedule.startsWith("delay:")) {
    const delay = Number(schedule.substring(6));
    if (!Number.isInteger(delay) || delay < 0 || delay > MAX_DELAY_MS)
      throw new Error(
        `Invalid delay schedule: ${schedule} (0 ~ ${MAX_DELAY_MS}ms, 约 24.8 天)`,
      );
  } else if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron expression: ${schedule}`);
  }
}

export class CronScheduler {
  private jobs = new Map<string, ScheduledJob>();
  // 并发锁按 taskId 独立保存：任务更新/重调度会重建 job 条目，但不丢失锁
  private runningTasks = new Set<string>();
  private inFlight = new Set<Promise<void>>();
  private running = false;

  constructor(
    private executor: TaskExecutor,
    private prisma: PrismaClient,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const tasks = await this.prisma.scheduledTask.findMany({
      where: { enabled: true },
    });

    console.log(`[Scheduler] Loading ${tasks.length} enabled tasks...`);
    for (const task of tasks) {
      try {
        await this.scheduleTask(task);
      } catch (error) {
        console.error(`[Scheduler] Failed to schedule task ${task.id}:`, error);
      }
    }
    console.log(`[Scheduler] Started with ${this.jobs.size} active jobs`);
  }

  async stop(): Promise<void> {
    console.log(`[Scheduler] Stopping ${this.jobs.size} jobs...`);
    for (const [, job] of this.jobs) {
      job.cronJob?.stop();
      if (job.timeoutHandle) clearTimeout(job.timeoutHandle);
    }
    this.jobs.clear();
    this.running = false;
    // 优雅关闭：等待在途执行完成（含重试间隔）后再返回
    await Promise.allSettled([...this.inFlight]);
    console.log("[Scheduler] Stopped");
  }

  async scheduleTask(task: ScheduledTask): Promise<void> {
    await this.unscheduleTask(task.id);

    if (!task.enabled) return;

    validateSchedule(task.schedule);

    if (task.schedule.startsWith("delay:")) {
      // 一次性任务：runAt 由服务层在创建/改期时持久化。
      // runAt 为 null 表示已领取（消费），重启时不再调度，直接禁用。
      if (!task.runAt) {
        await this.prisma.scheduledTask.update({
          where: { id: task.id },
          data: { enabled: false },
        });
        return;
      }
      // 按剩余时间调度：重启后不会重新等待完整延迟
      const remaining = Math.max(0, task.runAt.getTime() - Date.now());
      const timeoutHandle = setTimeout(() => this.runTask(task.id), remaining);
      this.jobs.set(task.id, { task, timeoutHandle });
      console.log(`[Scheduler] Scheduled one-time task ${task.id} at ${task.runAt.toISOString()}`);
    } else {
      // node-cron v4：不再支持 { scheduled: true } 选项（默认即调度）
      const cronJob = cron.schedule(task.schedule, () => this.runTask(task.id));
      this.jobs.set(task.id, { task, cronJob });
      console.log(`[Scheduler] Scheduled cron task ${task.id}: ${task.schedule}`);
    }
  }

  async unscheduleTask(taskId: string): Promise<void> {
    const job = this.jobs.get(taskId);
    job?.cronJob?.stop();
    if (job?.timeoutHandle) clearTimeout(job.timeoutHandle);
    this.jobs.delete(taskId);
  }

  async rescheduleTask(task: ScheduledTask): Promise<void> {
    await this.scheduleTask(task);
  }

  private runTask(taskId: string): Promise<void> {
    // 并发防护：锁按 taskId 持有，任务重调度不丢失；上次执行未完成则跳过
    if (this.runningTasks.has(taskId)) {
      console.log(`[Scheduler] Task ${taskId} is already running, skipping`);
      return Promise.resolve();
    }
    return this.spawnRun(taskId);
  }

  /**
   * 手动触发的统一入口：与定时调度共用并发锁、重试、lastExecutedAt 更新
   * 与 stop() 的在途等待。立即创建执行记录并返回（接口不必等任务完成），
   * 实际执行在后台进行。
   */
  async trigger(taskId: string): Promise<TaskExecution> {
    if (this.runningTasks.has(taskId)) throw new TaskRunningError(taskId);
    const task = await this.prisma.scheduledTask.findUnique({ where: { id: taskId } });
    if (!task) throw new Error("任务不存在");

    const execution = await this.prisma.taskExecution.create({
      data: { taskId, status: TaskExecutionStatus.running },
    });
    this.spawnRun(taskId, execution.id);
    return execution;
  }

  private spawnRun(taskId: string, executionId?: string): Promise<void> {
    this.runningTasks.add(taskId);
    const promise = this.doRunTask(taskId, executionId).finally(() =>
      this.runningTasks.delete(taskId),
    );
    // 跟踪在途执行，供 stop() 优雅关闭时等待
    this.inFlight.add(promise);
    promise.finally(() => this.inFlight.delete(promise));
    return promise;
  }

  private async doRunTask(taskId: string, executionId?: string): Promise<void> {
    try {
      // 重新加载任务配置（可能已被更新）
      const task = await this.prisma.scheduledTask.findUnique({ where: { id: taskId } });
      if (!task || !task.enabled) {
        await this.unscheduleTask(taskId);
        return;
      }

      // 一次性任务先"领取"：原子置空 runAt。领取后崩溃，重启时 runAt 为空
      // → 视为已消费并禁用，不会重放（at-most-once）。
      const isOneTime = task.schedule.startsWith("delay:");
      if (isOneTime) {
        const claimed = await this.prisma.scheduledTask.updateMany({
          where: { id: task.id, runAt: task.runAt },
          data: { runAt: null },
        });
        if (claimed.count === 0) {
          // 已被其他执行领取
          await this.unscheduleTask(taskId);
          return;
        }
      }

      console.log(`[Scheduler] Running task ${taskId}: ${task.name}`);
      const execution = await this.executeWithRetry(task, executionId);

      await this.prisma.scheduledTask.update({
        where: { id: taskId },
        data: {
          lastExecutedAt: new Date(),
          // 一次性任务执行后禁用，避免重启后重复执行
          ...(isOneTime ? { enabled: false } : {}),
        },
      });
      if (isOneTime) await this.unscheduleTask(taskId);

      console.log(`[Scheduler] Task ${taskId} completed with status: ${execution.status}`);
    } catch (error) {
      console.error(`[Scheduler] Error running task ${taskId}:`, error);
    }
  }

  private async executeWithRetry(task: ScheduledTask, executionId?: string) {
    let lastExecution: TaskExecution | undefined;

    for (let attempt = 0; attempt <= task.retryCount; attempt++) {
      let current = task;
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, task.retryDelay));
        // 等待期间任务可能已被禁用/删除：重查状态，禁用后停止重试
        const fresh = await this.prisma.scheduledTask.findUnique({
          where: { id: task.id },
        });
        if (!fresh?.enabled) {
          console.log(`[Scheduler] Task ${task.id} disabled, stopping retries`);
          break;
        }
        current = fresh; // 用最新配置执行重试
        console.log(`[Scheduler] Retrying task ${task.id}, attempt ${attempt}`);
      }

      lastExecution = await this.executor.execute(current, {
        retryAttempt: attempt,
        // 首次尝试复用调度器预创建的执行记录（手动触发场景）
        executionId: attempt === 0 ? executionId : undefined,
      });
      if (lastExecution.status === "succeeded") break;
    }

    if (!lastExecution) throw new Error("Task execution did not start");
    return lastExecution;
  }
}
```

### 4.4 服务层 — `backend/src/scheduler/service.ts`

```typescript
import type { PrismaClient } from "../generated/prisma/client.js";
import type { ScheduledTask, TaskExecution, CreateTaskDto, UpdateTaskDto, TaskFilter, TaskListResult } from "./types.js";
import { CronScheduler, MAX_DELAY_MS, validateSchedule } from "./scheduler.js";

const MAX_RETRY_COUNT = 10;
const MAX_PAGE_LIMIT = 200;

/** 落库前校验完整请求：schedule、payload、重试次数、超时，避免错误请求破坏现有任务 */
function validateTaskConfig(data: {
  type?: string;
  payload?: unknown;
  retryCount?: number;
  retryDelay?: number;
  timeout?: number;
}): void {
  if (
    data.retryCount !== undefined &&
    (!Number.isInteger(data.retryCount) || data.retryCount < 0 || data.retryCount > MAX_RETRY_COUNT)
  )
    throw new Error(`retryCount 必须是 0-${MAX_RETRY_COUNT} 的整数`);
  if (
    data.retryDelay !== undefined &&
    (!Number.isInteger(data.retryDelay) || data.retryDelay < 0 || data.retryDelay > MAX_DELAY_MS)
  )
    throw new Error(`retryDelay 必须是 0-${MAX_DELAY_MS} 的毫秒数`);
  if (
    data.timeout !== undefined &&
    (!Number.isInteger(data.timeout) || data.timeout <= 0 || data.timeout > MAX_DELAY_MS)
  )
    throw new Error(`timeout 必须是 1-${MAX_DELAY_MS} 的毫秒数`);

  const payload = data.payload as Record<string, unknown> | undefined;
  if (data.type === "http") {
    if (typeof payload?.url !== "string" || !/^https?:\/\//.test(payload.url))
      throw new Error("http 任务的 payload.url 必须是 http(s) URL");
  } else if (data.type === "service") {
    if (typeof payload?.service !== "string" || typeof payload?.method !== "string")
      throw new Error("service 任务的 payload.service / payload.method 必须是字符串");
  } else if (data.type === "script") {
    if (typeof payload?.command !== "string" || !payload.command.trim())
      throw new Error("script 任务的 payload.command 必须是非空字符串");
  }
}

export class SchedulerService {
  constructor(
    private prisma: PrismaClient,
    private scheduler: CronScheduler,
  ) {}

  async createTask(data: CreateTaskDto): Promise<ScheduledTask> {
    validateSchedule(data.schedule);
    validateTaskConfig(data);
    const task = await this.prisma.scheduledTask.create({
      data: {
        name: data.name,
        description: data.description,
        type: data.type,
        schedule: data.schedule,
        enabled: data.enabled ?? true,
        payload: data.payload as any,
        retryCount: data.retryCount ?? 0,
        retryDelay: data.retryDelay ?? 60000,
        timeout: data.timeout ?? 300000,
        // 一次性任务的预定执行时刻在创建时持久化，重启按剩余时间调度
        runAt: data.schedule.startsWith("delay:")
          ? new Date(Date.now() + Number(data.schedule.substring(6)))
          : null,
      },
    });

    if (task.enabled) await this.scheduler.scheduleTask(task);
    return task;
  }

  async updateTask(id: string, data: UpdateTaskDto): Promise<ScheduledTask> {
    // 注意用 !== undefined：空字符串也要校验，防止脏数据落库
    if (data.schedule !== undefined) validateSchedule(data.schedule);
    validateTaskConfig(data);

    const task = await this.prisma.scheduledTask.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        schedule: data.schedule,
        enabled: data.enabled,
        payload: data.payload as any,
        retryCount: data.retryCount,
        retryDelay: data.retryDelay,
        timeout: data.timeout,
        // 改期后重置 runAt；仅改名称等字段不会重置一次性任务倒计时
        ...(data.schedule !== undefined
          ? {
              runAt: data.schedule.startsWith("delay:")
                ? new Date(Date.now() + Number(data.schedule.substring(6)))
                : null,
            }
          : {}),
      },
    });

    await this.scheduler.rescheduleTask(task);
    return task;
  }

  async deleteTask(id: string): Promise<void> {
    await this.scheduler.unscheduleTask(id);
    await this.prisma.scheduledTask.delete({ where: { id } });
  }

  async getTask(id: string): Promise<ScheduledTask | null> {
    return this.prisma.scheduledTask.findUnique({ where: { id } });
  }

  async listTasks(filter?: TaskFilter): Promise<TaskListResult> {
    const page = filter?.page ?? 1;
    const limit = Math.min(filter?.limit ?? 20, MAX_PAGE_LIMIT);

    const where: any = {};
    if (filter?.enabled !== undefined) where.enabled = filter.enabled;
    if (filter?.type) where.type = filter.type;

    const [tasks, total] = await Promise.all([
      this.prisma.scheduledTask.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.scheduledTask.count({ where }),
    ]);

    return { tasks, total, page, limit };
  }

  async enableTask(id: string): Promise<ScheduledTask> {
    const existing = await this.prisma.scheduledTask.findUnique({ where: { id } });
    if (!existing) throw new Error("任务不存在");
    validateSchedule(existing.schedule); // 先校验再落库，避免 enabled=true 但调度失败
    const task = await this.prisma.scheduledTask.update({
      where: { id },
      data: { enabled: true },
    });
    await this.scheduler.scheduleTask(task);
    return task;
  }

  async disableTask(id: string): Promise<ScheduledTask> {
    await this.scheduler.unscheduleTask(id);
    return this.prisma.scheduledTask.update({
      where: { id },
      data: { enabled: false },
    });
  }

  async triggerTask(id: string): Promise<TaskExecution> {
    // 统一执行入口：并发锁、重试、lastExecutedAt、优雅关闭全覆盖；
    // 立即返回预创建的执行记录，任务在后台执行
    return this.scheduler.trigger(id);
  }

  async getExecutions(taskId: string, limit = 50): Promise<TaskExecution[]> {
    return this.prisma.taskExecution.findMany({
      where: { taskId },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  async getExecution(executionId: string): Promise<TaskExecution | null> {
    return this.prisma.taskExecution.findUnique({ where: { id: executionId } });
  }
}
```

---

## 5. API 设计

### 5.1 端点一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/scheduled-tasks` | 创建任务 |
| GET | `/api/scheduled-tasks` | 查询列表（支持 `enabled`/`type`/`page`/`limit`） |
| GET | `/api/scheduled-tasks/:id` | 查询单个任务 |
| PUT | `/api/scheduled-tasks/:id` | 更新任务 |
| DELETE | `/api/scheduled-tasks/:id` | 删除任务 |
| POST | `/api/scheduled-tasks/:id/enable` | 启用任务 |
| POST | `/api/scheduled-tasks/:id/disable` | 禁用任务 |
| POST | `/api/scheduled-tasks/:id/trigger` | 手动触发（立即返回 executionId，后台执行；运行中返回 409） |
| GET | `/api/scheduled-tasks/:id/executions` | 执行历史 |
| GET | `/api/task-executions/:executionId` | 执行详情 |

### 5.2 路由实现 — `backend/src/routes/scheduler.ts`

```typescript
import type { FastifyInstance } from "fastify";
import type { SchedulerService } from "../scheduler/service.js";
import { TaskRunningError } from "../scheduler/scheduler.js";

function toPositiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function registerSchedulerRoutes(app: FastifyInstance, service: SchedulerService) {
  app.post("/api/scheduled-tasks", async (request, reply) => {
    try {
      const task = await service.createTask(request.body as any);
      return reply.code(201).send(task);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "创建任务失败",
      });
    }
  });

  app.get("/api/scheduled-tasks", async (request) => {
    const query = request.query as any;
    return service.listTasks({
      enabled: query.enabled === "true" ? true : query.enabled === "false" ? false : undefined,
      type: query.type,
      page: toPositiveInt(query.page),
      limit: toPositiveInt(query.limit),
    });
  });

  app.get<{ Params: { id: string } }>("/api/scheduled-tasks/:id", async (request, reply) => {
    const task = await service.getTask(request.params.id);
    if (!task) return reply.code(404).send({ error: "任务不存在" });
    return task;
  });

  app.put<{ Params: { id: string } }>("/api/scheduled-tasks/:id", async (request, reply) => {
    try {
      return await service.updateTask(request.params.id, request.body as any);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "更新任务失败",
      });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/scheduled-tasks/:id", async (request, reply) => {
    try {
      await service.deleteTask(request.params.id);
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({ error: "任务不存在" });
    }
  });

  app.post<{ Params: { id: string } }>("/api/scheduled-tasks/:id/enable", async (request, reply) => {
    try {
      return await service.enableTask(request.params.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "启用任务失败";
      return reply.code(message === "任务不存在" ? 404 : 400).send({ error: message });
    }
  });

  app.post<{ Params: { id: string } }>("/api/scheduled-tasks/:id/disable", async (request, reply) => {
    try {
      return await service.disableTask(request.params.id);
    } catch {
      return reply.code(404).send({ error: "任务不存在" });
    }
  });

  app.post<{ Params: { id: string } }>("/api/scheduled-tasks/:id/trigger", async (request, reply) => {
    try {
      const execution = await service.triggerTask(request.params.id);
      // 受理即返回，不等待任务完成；通过 executionId 轮询执行结果
      return reply.code(202).send({ executionId: execution.id, status: execution.status });
    } catch (error) {
      if (error instanceof TaskRunningError)
        return reply.code(409).send({ error: error.message });
      const message = error instanceof Error ? error.message : "触发任务失败";
      return reply.code(message === "任务不存在" ? 404 : 400).send({ error: message });
    }
  });

  app.get<{ Params: { id: string } }>("/api/scheduled-tasks/:id/executions", async (request) => {
    const query = request.query as any;
    const limit = Math.min(toPositiveInt(query.limit) ?? 50, 200);
    return { executions: await service.getExecutions(request.params.id, limit) };
  });

  app.get<{ Params: { executionId: string } }>("/api/task-executions/:executionId", async (request, reply) => {
    const execution = await service.getExecution(request.params.executionId);
    if (!execution) return reply.code(404).send({ error: "执行记录不存在" });
    return execution;
  });
}
```

### 5.3 请求/响应示例

**创建任务：**

```http
POST /api/scheduled-tasks
Content-Type: application/json

{
  "name": "每日数据备份",
  "description": "每天凌晨 2 点备份数据库",
  "type": "script",
  "schedule": "0 2 * * *",
  "payload": {
    "command": "sh",
    "args": ["/path/to/backup.sh"]
  },
  "retryCount": 3,
  "timeout": 600000
}
```

**响应 201**（实际返回完整 `ScheduledTask` 对象，此处仅列关键字段）：

```json
{
  "id": "9f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  "name": "每日数据备份",
  "enabled": true,
  "createdAt": "2026-10-13T10:00:00Z"
}
```

**查询列表：**

```http
GET /api/scheduled-tasks?enabled=true&type=http&page=1&limit=20
```

**响应 200：**

```json
{
  "tasks": [
    {
      "id": "9f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      "name": "健康检查",
      "type": "http",
      "schedule": "*/5 * * * *",
      "enabled": true,
      "lastExecutedAt": "2026-10-13T10:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

## 6. 主应用集成

修改 `backend/src/app.ts`：

```typescript
// 新增导入
import { SchedulerService } from "./scheduler/service.js";
import { CronScheduler } from "./scheduler/scheduler.js";
import { TaskExecutor } from "./scheduler/executor.js";
import { registerSchedulerRoutes } from "./routes/scheduler.js";

export function createApp(config: AppConfig) {
  // ... 现有代码 ...

  const runtime = new AntlerHostRuntime(/* ... */);
  const taskService = new TaskService(runtime);

  // 初始化调度器（taskService 创建之后）
  // 只构造一个 executor：调度与手动触发共享，且带 serviceRegistry
  const serviceRegistry = new Map<string, any>();
  serviceRegistry.set("taskService", taskService);
  const executor = new TaskExecutor(app.prisma, serviceRegistry, config.enableScriptTasks);
  const scheduler = new CronScheduler(executor, app.prisma);
  const schedulerService = new SchedulerService(app.prisma, scheduler);

  // 启动/关闭钩子（将现有 recoverInterrupted 的 onReady 钩子扩展为同时启动调度器）
  if (config.databaseUrl) {
    app.addHook("onReady", async () => {
      await runtime.recoverInterrupted();
      await scheduler.start();
    });
  }
  app.addHook("onClose", async () => {
    await scheduler.stop(); // 停止调度并等待在途执行完成
  });

  // 注册路由
  registerSchedulerRoutes(app, schedulerService);

  // ... 其余代码 ...
}
```

同时在 `backend/src/config/env.ts` 的 `AppConfig` 中新增一项：

```typescript
enableScriptTasks?: boolean;
// config 中: enableScriptTasks: process.env.ANTLER_SCHEDULER_ENABLE_SCRIPT === "true"
```

---

## 7. 测试方案

### 7.1 执行器测试 — `backend/test/scheduler/executor.test.ts`

```typescript
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { TaskExecutor } from "../../src/scheduler/executor.js";
import { createDatabase } from "../../src/plugins/database.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

describe("TaskExecutor", () => {
  let prisma: PrismaClient;
  let executor: TaskExecutor;

  // 内存数据库 $connect() 不会建表，需手动建表（与 test/runs/run-store.test.ts 同款做法）
  async function createTestDatabase(): Promise<PrismaClient> {
    const prisma = createDatabase(":memory:");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
        type TEXT NOT NULL, schedule TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 1, payload JSON NOT NULL,
        retryCount INTEGER NOT NULL DEFAULT 0, retryDelay INTEGER NOT NULL DEFAULT 60000,
        timeout INTEGER NOT NULL DEFAULT 300000,
        runAt DATETIME, lastExecutedAt DATETIME,
        createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE task_executions (
        id TEXT PRIMARY KEY, taskId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        startedAt DATETIME NOT NULL, finishedAt DATETIME,
        duration INTEGER, result JSON, error TEXT,
        retryAttempt INTEGER NOT NULL DEFAULT 0
      );
    `);
    return prisma;
  }

  beforeEach(async () => {
    prisma = await createTestDatabase();
    executor = new TaskExecutor(prisma);
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  // 用本地 HTTP 服务替代外网依赖，保证 CI 稳定
  async function withHttpServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
    fn: (url: string) => Promise<void>,
  ) {
    const server = createServer(handler);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      await fn(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
    }
  }

  test("执行 HTTP 任务 - 成功", async () => {
    await withHttpServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      },
      async (url) => {
        const task = await prisma.scheduledTask.create({
          data: {
            name: "Test HTTP Task",
            type: "http",
            schedule: "* * * * *",
            payload: { url, method: "GET" },
          },
        });

        const execution = await executor.execute(task);
        expect(execution.status).toBe("succeeded");
        expect(execution.duration).toBeGreaterThan(0);
      },
    );
  });

  test("HTTP 任务超时 - 状态为 timeout", async () => {
    await withHttpServer(
      () => {
        /* 永不响应，触发超时 */
      },
      async (url) => {
        const task = await prisma.scheduledTask.create({
          data: {
            name: "Test Timeout Task",
            type: "http",
            schedule: "* * * * *",
            payload: { url, method: "GET" },
            timeout: 100,
          },
        });

        const execution = await executor.execute(task);
        expect(execution.status).toBe("timeout");
      },
    );
  });

  test("执行脚本任务 - 成功", async () => {
    // script 任务默认禁用，测试需显式开启
    const scriptExecutor = new TaskExecutor(prisma, undefined, true);
    const task = await prisma.scheduledTask.create({
      data: {
        name: "Test Script",
        type: "script",
        schedule: "* * * * *",
        payload: { command: "echo", args: ["Hello, World!"] },
      },
    });

    const execution = await scriptExecutor.execute(task);
    expect(execution.status).toBe("succeeded");
    expect(execution.result).toMatchObject({ exitCode: 0 });
  });

  test("执行脚本任务 - 失败", async () => {
    const scriptExecutor = new TaskExecutor(prisma, undefined, true);
    const task = await prisma.scheduledTask.create({
      data: {
        name: "Test Failed Script",
        type: "script",
        schedule: "* * * * *",
        payload: { command: "sh", args: ["-c", "exit 1"] },
      },
    });

    const execution = await scriptExecutor.execute(task);
    expect(execution.status).toBe("failed");
    expect(execution.error).toContain("Exit code: 1");
  });
});
```

### 7.2 服务层测试要点

| 测试用例 | 验证点 |
|---------|--------|
| 创建任务 | 字段正确、enabled 默认为 true、自动调度 |
| 查询列表 | 分页、enabled/type 过滤 |
| 更新任务 | 重新调度生效 |
| 删除任务 | 任务与调度均移除 |
| 启用/禁用 | 状态切换、调度注册/注销 |
| 手动触发 | 立即返回 202 + `executionId`；任务在后台执行、记录 taskId 关联正确；运行中再触发返回 409 |
| 重试机制 | 失败后按 retryCount 重试 |
| 超时控制 | 超时后状态为 `timeout` |

---

## 8. 使用指南

### 8.1 Cron 表达式速查

```
*    *    *    *    *
┬    ┬    ┬    ┬    ┬
│    │    │    │    └─ 星期 (0-7, 0 和 7 都表示周日)
│    │    │    └────── 月份 (1-12)
│    │    └─────────── 日期 (1-31)
│    └──────────────── 小时 (0-23)
└───────────────────── 分钟 (0-59)
```

| 表达式 | 说明 |
|--------|------|
| `*/5 * * * *` | 每 5 分钟 |
| `0 * * * *` | 每小时整点 |
| `0 0 * * *` | 每天午夜 |
| `0 9 * * 1-5` | 工作日早 9 点 |
| `0 0 * * 0` | 每周日午夜 |
| `0 0 1 * *` | 每月 1 号午夜 |
| `delay:3600000` | 一次性，延迟 1 小时（毫秒） |

> ⏰ node-cron 默认使用**服务器本地时区**；`0 2 * * *` 这类表达式依赖部署机器的 TZ，跨时区部署时注意。

在线验证：[crontab.guru](https://crontab.guru/)

### 8.2 常用 curl 示例

```bash
# 创建 HTTP 健康检查任务
curl -X POST http://localhost:3000/api/scheduled-tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "服务健康检查",
    "type": "http",
    "schedule": "*/5 * * * *",
    "payload": {
      "url": "http://localhost:3000/api/health",
      "method": "GET",
      "expectedStatus": [200]
    },
    "timeout": 5000
  }'

# 查询任务列表
curl "http://localhost:3000/api/scheduled-tasks?enabled=true"

# 手动触发
curl -X POST http://localhost:3000/api/scheduled-tasks/{taskId}/trigger

# 查看执行历史
curl http://localhost:3000/api/scheduled-tasks/{taskId}/executions

# 禁用/启用
curl -X POST http://localhost:3000/api/scheduled-tasks/{taskId}/disable
curl -X POST http://localhost:3000/api/scheduled-tasks/{taskId}/enable

# 删除
curl -X DELETE http://localhost:3000/api/scheduled-tasks/{taskId}
```

### 8.3 最佳实践

1. **合理设置超时**：快速 API 5s，数据同步 30s，大备份 10min
2. **避免高频任务**：避免 `* * * * *`（每分钟），生产建议 ≥ 5 分钟间隔
3. **关键任务配重试**：`retryCount: 3, retryDelay: 60000`；但**不可取消的 service 任务**（服务方法不监听 AbortSignal）应设 `retryCount: 0`——超时后旧调用仍在运行，重试会与之重叠
4. **错开高负载任务**：凌晨任务错开整点，避免并发资源争抢
5. **定期清理历史**：创建 service 任务清理 90 天前的执行记录
6. **任务命名清晰**：`每日用户活跃度统计` 优于 `task1`

### 8.4 故障排查

| 症状 | 排查步骤 |
|------|---------|
| 任务未执行 | ① `enabled` 是否为 true ② cron 表达式是否正确（crontab.guru 验证）③ 查看日志 `[Scheduler]` 前缀 ④ 上次执行是否未完成 |
| 执行失败 | 查询执行详情 `GET /api/task-executions/:executionId`，查看 `error` 字段 |
| 任务超时 | 增加 `timeout`，或拆分大任务 |
| 调度器未启动 | 检查 `onReady` 钩子、数据库连接、应用启动日志 |

---

## 9. 实施计划

| 阶段 | 工作内容 | 时间 | 验证标准 |
|------|---------|------|---------|
| 1. 数据库 | 更新 schema、迁移 | 1 天 | `pnpm db:studio` 可见新表 |
| 2. 类型定义 | `scheduler/types.ts` | 0.5 天 | `pnpm check` 通过 |
| 3. 执行器 | `scheduler/executor.ts` | 1 天 | 单元测试通过 |
| 4. 调度核心 | `scheduler/scheduler.ts` | 1.5 天 | 启动/停止/调度正常 |
| 5. 服务层 | `scheduler/service.ts` | 1 天 | CRUD 测试通过 |
| 6. API 路由 | `routes/scheduler.ts` | 1 天 | curl 端到端验证 |
| 7. 主应用集成 | 修改 `app.ts` | 0.5 天 | 服务启动自动加载任务 |
| 8. 测试 | 单元 + 集成测试 | 1.5 天 | `pnpm test` 通过 |

**总工期：约 8 天**

### 验收检查清单

- [ ] `pnpm db:migrate` 创建 `scheduled_tasks` 和 `task_executions` 表
- [ ] 安装依赖 `node-cron`
- [ ] 创建任务返回 201
- [ ] 手动触发立即返回 202 与 `executionId`，运行中触发返回 409
- [ ] cron 任务到点自动执行，历史记录状态为 `succeeded`
- [ ] 禁用后任务不再执行，在途重试也会停止
- [ ] 失败任务按 `retryCount` 重试
- [ ] 超时任务状态为 `timeout`
- [ ] 一次性 `delay:` 任务执行一次后自动禁用；重启按剩余时间调度、不重放已领取任务
- [ ] `delay:` 上限约 24.8 天（`MAX_DELAY_MS`），超限被拒绝
- [ ] script 任务默认拒绝执行，配置 `ANTLER_SCHEDULER_ENABLE_SCRIPT=true` 后可执行
- [ ] 服务重启后活跃任务自动恢复调度
- [ ] `pnpm test` 全部通过

---

## 10. 安全与运维

### 安全考虑

| 风险 | 措施 |
|------|------|
| Script 任务命令注入 | **默认禁用**：`ANTLER_SCHEDULER_ENABLE_SCRIPT=true` 显式开启；`spawn` 使用数组参数、不经 shell；定期审计 |
| 子进程泄露密钥 | 子进程不继承 `process.env`，仅透传 `PATH` 与 payload 显式声明的 `env` |
| HTTP 任务泄露密钥 | 密钥从环境变量读取，不写入 payload |
| API 未授权访问 | **前提：必须配置 `ANTLER_ACCESS_TOKEN`**。现有鉴权在未配置 token 时放行所有请求（[http.ts:22](../backend/src/plugins/http.ts)），服务默认仅绑 127.0.0.1 只是缓解。若将服务暴露到局域网/公网，未配置 token 且开启 script 任务 = 任意命令执行 |
| 资源耗尽 | 超时控制 + 并发防护 + 避免高频任务 |

### 运维要点

- **日志**：所有调度行为输出 `[Scheduler]` 前缀日志
- **监控**：定期检查失败率（`executions` 表按 status 统计）
- **清理**：建议创建每周清理 90 天前执行记录的 service 任务
- **健康检查**：可通过 `GET /api/scheduled-tasks?enabled=true` 确认活跃任务数

---

## 11. 扩展方向

### 短期（可选增强）

- 任务依赖：任务间依赖关系（dependsOn + waitMode）
- 任务分组：groupId + priority
- 通知机制：onSuccess/onFailure 触发 webhook
- 暂停/恢复：与禁用区分，保留更多状态

### 长期（架构演进）

- 分布式调度：多实例下用 Redis 锁或数据库锁做任务抢占
- 可视化管理 UI：Web 前端任务管理面板
- 统计报表：执行成功率、耗时趋势分析

---

## 12. FAQ

**Q: 任务执行失败后会怎样？**
A: 按 `retryCount` 自动重试，间隔 `retryDelay` 毫秒。每次重试前重查任务状态：任务被禁用或删除后停止重试。全部失败后标记为最终失败，等待下一个调度周期。

**Q: 运行时修改任务配置，会影响正在执行的任务吗？**
A: 更新会重建调度条目，但并发锁按 taskId 独立保存，正在执行的旧任务不会因此并发重入；重试时使用最新落库配置。

**Q: 同一任务会并发执行吗？**
A: 不会。并发锁按 taskId 持有，任务重调度不丢失锁；上次未完成时跳过本次调度，手动触发也会得到 409。

**Q: 一次性任务重启后怎么处理？**
A: `runAt` 已持久化，重启按**剩余时间**继续等待；执行前通过"领取"（原子置空 `runAt`）防止崩溃后重放，领取后崩溃的任务重启时视为已消费并禁用（at-most-once）。重新执行需修改 `schedule`（重置倒计时）或新建任务。

**Q: 支持分布式部署吗？**
A: 当前版本不支持。多实例会重复执行任务。需要时增加分布式锁机制。

**Q: 为什么选 node-cron 而不是 BullMQ/agenda？**
A: 本项目是单机 SQLite 架构，node-cron 零依赖、够用、易维护。BullMQ 需要 Redis，agenda 需要 MongoDB，都不符合当前架构。

**Q: Script 任务有安全风险吗？**
A: 有。脚本任务会执行系统命令，因此**默认禁用**，需设置 `ANTLER_SCHEDULER_ENABLE_SCRIPT=true` 显式开启。开启后建议使用专用低权限账户运行服务；子进程不继承服务的环境变量，API 密钥不会泄露给脚本。
