import { PlatformError } from "../platform/errors.js";
import type { FastifyInstance } from "fastify";
import type { TaskService } from "../services/task-service.js";
import { ConversationBusyError } from "../agent/host-runtime.js";
import { streamRun } from "../utils/sse.js";

export function registerTaskRoutes(
  app: FastifyInstance,
  taskService: TaskService,
) {
  app.post("/api/tasks", async (request, reply) => {
    const { message, conversationId, agentId } = (request.body ?? {}) as {
      message?: unknown;
      conversationId?: unknown;
      agentId?: unknown;
    };
    if (typeof message !== "string" || !message.trim()) {
      return reply.code(400).send({ error: "message 不能为空。" });
    }

    if (
      conversationId !== undefined &&
      (typeof conversationId !== "string" || !conversationId)
    )
      return reply
        .code(400)
        .send({ error: "conversationId 必须是非空字符串。" });
    if (agentId !== undefined && (typeof agentId !== "string" || !agentId))
      return reply.code(400).send({ error: "agentId 无效" });
    try {
      const task = await taskService.create(
        message,
        conversationId,
        request.antlerUser?.id,
        agentId,
      );
      return reply.code(202).send({
        taskId: task.id,
        runId: task.id,
        conversationId: task.conversationId,
        eventsUrl: `/api/tasks/${task.id}/events`,
      });
    } catch (error) {
      if (error instanceof PlatformError)
        return reply.code(error.statusCode).send({ error: error.code });
      if (error instanceof ConversationBusyError)
        return reply.code(409).send({ error: "conversation_busy" });
      throw error;
    }
  });

  app.get<{ Params: { taskId: string } }>(
    "/api/tasks/:taskId/events",
    async (request, reply) => {
      const task = await taskService.get(
        request.params.taskId,
        request.antlerUser?.id,
      );
      if (!task) return reply.code(404).send({ error: "任务不存在。" });
      await streamRun(
        taskService.runtime,
        task.id,
        reply,
        0,
        true,
        request.antlerUser?.id,
      );
    },
  );
}
