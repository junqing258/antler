import { spawn } from "node:child_process";
import { withRunContext } from "../run-context.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type {
  ScheduledTask,
  TaskExecution,
  ExecutionResult,
  HttpTaskPayload,
  ServiceTaskPayload,
  ScriptTaskPayload,
  ServiceRegistry,
} from "./types.js";

export const MAX_OUTPUT_CHARS = 64 * 1024;
const truncate = (text: string) =>
  text.length > MAX_OUTPUT_CHARS
    ? text.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]"
    : text;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export class TaskExecutor {
  constructor(
    private prisma: PrismaClient,
    private serviceRegistry?: ServiceRegistry,
    private enableScript = false,
  ) {}

  async execute(
    task: ScheduledTask,
    options: { retryAttempt?: number; executionId?: string } = {},
  ): Promise<TaskExecution> {
    const execution = options.executionId
      ? { id: options.executionId }
      : await this.prisma.taskExecution.create({
          data: { taskId: task.id, retryAttempt: options.retryAttempt ?? 0 },
        });
    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), task.timeout);
    let result: ExecutionResult;
    let data: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
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
          throw new Error(`Unsupported task type: ${task.type}`);
      }
      // Convert Dates/undefined fields and reject circular or otherwise non-JSON results.
      if (result.data !== undefined) {
        const serialized = JSON.stringify(result.data);
        if (serialized !== undefined) {
          const parsed = JSON.parse(serialized) as Prisma.InputJsonValue | null;
          data = parsed === null ? Prisma.JsonNull : parsed;
        }
      }
    } catch (error) {
      result = { success: false, error: errorMessage(error), duration: 0 };
    } finally {
      clearTimeout(timeout);
    }
    return this.prisma.taskExecution.update({
      where: { id: execution.id },
      data: {
        status: controller.signal.aborted
          ? "timeout"
          : result.success
            ? "succeeded"
            : "failed",
        finishedAt: new Date(),
        duration: Date.now() - startTime,
        result: data,
        error: controller.signal.aborted ? "Task timed out" : result.error,
      },
    });
  }

  private async executeHttp(
    task: ScheduledTask,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    const payload = task.payload as unknown as HttpTaskPayload;
    const headers = { ...payload.headers };
    if (
      payload.body !== undefined &&
      !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")
    ) {
      headers["content-type"] = "application/json";
    }
    const response = await fetch(payload.url, {
      method: payload.method ?? "GET",
      headers,
      body:
        payload.body !== undefined ? JSON.stringify(payload.body) : undefined,
      signal,
    });
    const text = await response.text();
    let body: unknown = text || null;
    try {
      if (text) body = JSON.parse(text);
    } catch {
      /* Plain text responses are valid. */
    }
    const success = (payload.expectedStatus ?? [200, 201, 204]).includes(
      response.status,
    );
    return {
      success,
      data: { status: response.status, body },
      duration: 0,
      error: success ? undefined : `Unexpected status: ${response.status}`,
    };
  }

  private async executeService(
    task: ScheduledTask,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    const payload = task.payload as unknown as ServiceTaskPayload;
    if (!this.serviceRegistry)
      throw new Error("Service registry not available");
    const service = this.serviceRegistry.get(payload.service);
    if (!service) throw new Error(`Service not found: ${payload.service}`);
    // The registry exposes own methods only; Object.prototype/constructors are never callable.
    const method = Object.getOwnPropertyDescriptor(service, payload.method)
      ?.value as unknown;
    if (
      typeof method !== "function" ||
      ["constructor", "__proto__", "prototype"].includes(payload.method)
    ) {
      throw new Error(`Method not found: ${payload.method}`);
    }
    signal.throwIfAborted();
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error("Task timed out"));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      // 任务归属通过运行上下文注入，服务包装层据此把产物（如 Agent 运行）关联到创建者。
      const data: unknown = await Promise.race([
        withRunContext({ userId: task.userId }, () =>
          Promise.resolve().then(() => method.apply(service, [...(payload.args ?? []), signal])),
        ),
        aborted,
      ]);
      return { success: true, data, duration: 0 };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  private async executeScript(
    task: ScheduledTask,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    if (!this.enableScript) {
      throw new Error(
        "Script tasks disabled (set ANTLER_SCHEDULER_ENABLE_SCRIPT=true to enable)",
      );
    }
    const payload = task.payload as unknown as ScriptTaskPayload;
    return new Promise((resolve, reject) => {
      const child = spawn(payload.command, payload.args ?? [], {
        cwd: payload.cwd,
        env: { PATH: process.env.PATH, ...payload.env },
        detached: process.platform !== "win32",
        // Kill stubborn children on timeout as well; no shell or inherited secrets.
        signal,
        killSignal: "SIGKILL",
      });
      const killGroup = () => {
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
              console.error(
                "[Scheduler] Failed to kill script process group:",
                error,
              );
            }
          }
        }
      };
      signal.addEventListener("abort", killGroup, { once: true });
      let stdout = "";
      let stderr = "";
      let failure: Error | undefined;
      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length <= MAX_OUTPUT_CHARS)
          stdout = truncate(stdout + chunk.toString());
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length <= MAX_OUTPUT_CHARS)
          stderr = truncate(stderr + chunk.toString());
      });
      // Wait for close (process termination and closed streams), including abort/spawn errors.
      child.on("error", (error) => {
        failure = error;
      });
      child.on("close", (exitCode) => {
        signal.removeEventListener("abort", killGroup);
        if (failure) {
          reject(failure);
          return;
        }
        resolve({
          success: exitCode === 0,
          data: { stdout, stderr, exitCode },
          duration: 0,
          error:
            exitCode === 0 ? undefined : `Exit code: ${exitCode}\n${stderr}`,
        });
      });
    });
  }
}
