import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { SchedulerService } from "../scheduler/service.js";
import { MAX_DELAY_MS } from "../scheduler/scheduler.js";
import { TaskValidationError } from "../scheduler/types.js";
import type { SecretGuard } from "./secret-guard.js";

export type AgentScheduler = Pick<SchedulerService, "createTask">;

const parameters = Type.Object({
  name: Type.String({ minLength: 1, description: "Short task name." }),
  message: Type.String({
    minLength: 1,
    description:
      "Self-contained instructions for the future Agent run. Include all needed context; it will not inherit this conversation.",
  }),
  schedule: Type.String({
    description: `Five/six-field cron in the server timezone (e.g. '0 9 * * *' daily at 09:00), or 'delay:milliseconds' for a single execution (0-${MAX_DELAY_MS}ms).`,
  }),
  description: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean({ default: true })),
});

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: value,
  };
}

export function createSchedulerTools(
  scheduler: AgentScheduler,
  guard: SecretGuard,
): AgentTool[] {
  const clock: AgentTool = {
    name: "get_scheduler_time",
    label: "Get scheduler time",
    description:
      "Get the platform scheduler's current time and timezone before interpreting calendar dates or local clock times. Cron uses this server timezone.",
    parameters: Type.Object({}),
    async execute() {
      return result({
        currentTime: new Date().toISOString(),
        localTime: new Date().toString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    },
  };
  const create: AgentTool<typeof parameters> = {
    name: "create_scheduled_task",
    label: "Create scheduled task",
    description:
      "Create a persistent Antler platform task when the user requests future or recurring work. It appears in the Scheduled Tasks panel and runs with the backend default model and workspace, in a new conversation. Use cron for recurring work and delay for one-time work. Do not create a recurring task for a one-time request. Ask for missing timing or instructions; report success only after this tool succeeds, including task ID, schedule and timezone. The server must be running when the task is due.",
    parameters,
    async execute(_id, input, signal) {
      if (typeof input.message !== "string" || !input.message.trim())
        throw new TaskValidationError("message 必须是非空字符串");
      signal?.throwIfAborted();
      const task = await scheduler.createTask({
        name: input.name,
        description: input.description,
        schedule: input.schedule,
        enabled: input.enabled,
        type: "service",
        payload: {
          service: "taskService",
          method: "create",
          args: [input.message.trim()],
        },
        retryCount: 0,
      });
      return result({
        id: task.id,
        name: task.name,
        schedule: task.schedule,
        enabled: task.enabled,
        runAt: task.runAt?.toISOString() ?? null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        executionContext:
          "Backend default model and workspace; new conversation.",
      });
    },
  };
  return [clock, create].map((tool): AgentTool => ({
    ...tool,
    async execute(id, input, signal, onUpdate) {
      try {
        await guard.refresh();
        signal?.throwIfAborted();
        return guard.sanitize(
          await tool.execute(id, guard.sanitize(input), signal, onUpdate),
        );
      } catch (error) {
        throw new Error(
          guard.redact(
            error instanceof Error ? error.message : "Scheduler tool failed.",
          ),
        );
      }
    },
  }));
}
