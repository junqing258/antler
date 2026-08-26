import type { FastifyInstance } from "fastify";
import {
  ConversationBusyError,
  type AntlerHostRuntime,
} from "../agent/host-runtime.js";
import { streamRun } from "../utils/sse.js";

export function registerRunRoutes(
  app: FastifyInstance,
  runtime: AntlerHostRuntime,
) {
  app.post("/api/runs", async (request, reply) => {
    const { message, conversationId } = (request.body ?? {}) as {
      message?: unknown;
      conversationId?: unknown;
    };
    if (
      typeof message !== "string" ||
      !message.trim() ||
      typeof conversationId !== "string" ||
      !conversationId
    )
      return reply
        .code(400)
        .send({ error: "message 和 conversationId 均不能为空。" });
    try {
      const run = runtime.createRun(message.trim(), conversationId);
      return reply
        .code(202)
        .send({ runId: run.id, eventsUrl: `/api/runs/${run.id}/events` });
    } catch (error) {
      if (error instanceof ConversationBusyError)
        return reply.code(409).send({ error: "conversation_busy" });
      throw error;
    }
  });

  app.get<{
    Params: { runId: string };
    Querystring: { afterEventId?: string };
  }>("/api/runs/:runId/events", async (request, reply) => {
    const afterEventId = Number(
      request.query.afterEventId ?? request.headers["last-event-id"] ?? 0,
    );
    if (!Number.isSafeInteger(afterEventId) || afterEventId < 0)
      return reply.code(400).send({ error: "afterEventId 无效。" });
    if (!streamRun(runtime, request.params.runId, reply, afterEventId))
      return reply.code(404).send({ error: "run 不存在。" });
  });

  app.post<{ Params: { runId: string } }>(
    "/api/runs/:runId/cancel",
    async (request, reply) => {
      const run = runtime.cancel(request.params.runId);
      if (!run) return reply.code(404).send({ error: "run 不存在。" });
      return reply.code(202).send({ runId: run.id, status: run.status });
    },
  );
}
