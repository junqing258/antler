import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma } from "../generated/prisma/client.js";
import type { SchedulerService } from "../scheduler/service.js";
import { TaskRunningError } from "../scheduler/scheduler.js";
import {
  TaskNotFoundError,
  TaskValidationError,
  type CreateTaskDto,
  type UpdateTaskDto,
  type TaskFilter,
} from "../scheduler/types.js";

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number <= 0)
    throw new TaskValidationError("分页参数必须是正整数");
  return number;
}
async function respond(reply: FastifyReply, action: () => Promise<unknown>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof TaskRunningError)
      return reply.code(409).send({ error: error.message });
    if (
      error instanceof TaskNotFoundError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025")
    )
      return reply.code(404).send({ error: "任务不存在" });
    if (error instanceof TaskValidationError)
      return reply.code(400).send({ error: error.message });
    throw error;
  }
}

export function registerSchedulerRoutes(
  app: FastifyInstance,
  service: SchedulerService,
) {
  app.post("/api/scheduled-tasks", async (request, reply) =>
    respond(reply, async () => {
      const task = await service.createTask(request.body as CreateTaskDto);
      return reply.code(201).send(task);
    }),
  );
  app.get<{
    Querystring: {
      enabled?: string;
      type?: string;
      page?: string;
      limit?: string;
    };
  }>("/api/scheduled-tasks", async (request, reply) =>
    respond(reply, async () => {
      const query = request.query;
      if (
        query.enabled !== undefined &&
        !["true", "false"].includes(query.enabled)
      )
        throw new TaskValidationError("enabled 必须是 true 或 false");
      return service.listTasks({
        enabled:
          query.enabled === undefined ? undefined : query.enabled === "true",
        type: query.type as TaskFilter["type"],
        page: positiveInt(query.page),
        limit: positiveInt(query.limit),
      });
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/scheduled-tasks/:id",
    async (request, reply) =>
      respond(reply, async () => {
        const task = await service.getTask(request.params.id);
        if (!task) throw new TaskNotFoundError();
        return task;
      }),
  );
  app.put<{ Params: { id: string } }>(
    "/api/scheduled-tasks/:id",
    async (request, reply) =>
      respond(reply, () =>
        service.updateTask(request.params.id, request.body as UpdateTaskDto),
      ),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/scheduled-tasks/:id",
    async (request, reply) =>
      respond(reply, async () => {
        await service.deleteTask(request.params.id);
        return reply.code(204).send();
      }),
  );
  app.post<{ Params: { id: string } }>(
    "/api/scheduled-tasks/:id/enable",
    async (request, reply) =>
      respond(reply, () => service.enableTask(request.params.id)),
  );
  app.post<{ Params: { id: string } }>(
    "/api/scheduled-tasks/:id/disable",
    async (request, reply) =>
      respond(reply, () => service.disableTask(request.params.id)),
  );
  app.post<{ Params: { id: string } }>(
    "/api/scheduled-tasks/:id/trigger",
    async (request, reply) =>
      respond(reply, async () => {
        const execution = await service.triggerTask(request.params.id);
        return reply
          .code(202)
          .send({ executionId: execution.id, status: execution.status });
      }),
  );
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/scheduled-tasks/:id/executions",
    async (request, reply) =>
      respond(reply, async () => ({
        executions: await service.getExecutions(
          request.params.id,
          positiveInt(request.query.limit),
        ),
      })),
  );
  app.get<{ Params: { executionId: string } }>(
    "/api/task-executions/:executionId",
    async (request, reply) =>
      respond(reply, async () => {
        const execution = await service.getExecution(
          request.params.executionId,
        );
        if (!execution)
          return reply.code(404).send({ error: "执行记录不存在" });
        return execution;
      }),
  );
}
