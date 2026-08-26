import type { FastifyInstance } from "fastify";
import {
  ConversationBusyError,
  type AntlerHostRuntime,
} from "../agent/host-runtime.js";
import { streamRun } from "../utils/sse.js";
import type { ProviderRunConfig } from "../agent/host-runtime.js";

function parseProvider(value: unknown): ProviderRunConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("供应商配置无效。");
  const { protocol, baseUrl, apiKey, model } = value as Record<string, unknown>;
  if (
    (protocol !== "openai-responses" && protocol !== "anthropic-messages") ||
    typeof apiKey !== "string" || !apiKey.trim() ||
    typeof model !== "string" || !model.trim() ||
    (baseUrl !== undefined && (typeof baseUrl !== "string" || (baseUrl && !URL.canParse(baseUrl))))
  ) throw new Error("供应商配置无效：请填写协议、API Key、模型和合法的 Base URL。");
  return { protocol, apiKey: apiKey.trim(), model: model.trim(), ...(typeof baseUrl === "string" && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}) };
}

export function registerRunRoutes(
  app: FastifyInstance,
  runtime: AntlerHostRuntime,
) {
  app.post("/api/runs", async (request, reply) => {
    const { message, conversationId, provider } = (request.body ?? {}) as {
      message?: unknown;
      conversationId?: unknown;
      provider?: unknown;
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
      const run = runtime.createRun(message.trim(), conversationId, parseProvider(provider));
      return reply
        .code(202)
        .send({ runId: run.id, eventsUrl: `/api/runs/${run.id}/events` });
    } catch (error) {
      if (error instanceof ConversationBusyError)
        return reply.code(409).send({ error: "conversation_busy" });
      if (error instanceof Error && error.message.startsWith("供应商配置"))
        return reply.code(400).send({ error: error.message });
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
