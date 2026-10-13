import type {
  ScheduledTask,
  TaskExecution,
} from "../generated/prisma/client.js";

export type { ScheduledTask, TaskExecution };
export {
  ScheduledTaskType,
  TaskExecutionStatus,
} from "../generated/prisma/client.js";

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

export type TaskPayload =
  HttpTaskPayload | ServiceTaskPayload | ScriptTaskPayload;

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

/** Only explicitly exposed methods can be invoked by scheduled service tasks. */
export type ServiceRegistry = Map<string, object>;

export class TaskValidationError extends Error {}

export class TaskNotFoundError extends Error {
  constructor() {
    super("任务不存在");
  }
}
