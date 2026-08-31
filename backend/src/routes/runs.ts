import type { FastifyInstance } from "fastify";
import {
  ConversationBusyError,
  type AntlerHostRuntime,
} from "../agent/host-runtime.js";
import { streamRun } from "../utils/sse.js";
import type { ProviderRunConfig } from "../agent/host-runtime.js";
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

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

export function parseWorkingDirectory(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("工作目录必须是非空字符串。");
  }
  const directory = value.trim();
  if (!isAbsolute(directory)) throw new Error("工作目录必须使用绝对路径。");
  try {
    if (!statSync(directory).isDirectory()) throw new Error();
  } catch {
    throw new Error("工作目录不存在或不是文件夹。");
  }
  return resolve(directory);
}

export function registerRunRoutes(
  app: FastifyInstance,
  runtime: AntlerHostRuntime,
) {
  app.post("/api/runs", async (request, reply) => {
    const { message, conversationId, provider, workingDirectory, skillPolicy } = (request.body ?? {}) as {
      message?: unknown;
      conversationId?: unknown;
      provider?: unknown;
      workingDirectory?: unknown;
      skillPolicy?: unknown;
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
      const parsedPolicy = parseSkillPolicy(skillPolicy);
      const outcome = await runtime.createRunWithSkills(message.trim(), { conversationId, provider: parseProvider(provider), workingDirectory: parseWorkingDirectory(workingDirectory), skillPolicy: parsedPolicy });
      const run = outcome.run;
      return reply
        .code(202)
        .send({ runId: run.id, eventsUrl: `/api/runs/${run.id}/events`, skillDiagnostics: outcome.skillDiagnostics });
    } catch (error) {
      if (error instanceof ConversationBusyError)
        return reply.code(409).send({ error: "conversation_busy" });
      if (error instanceof (await import("../agent/host-runtime.js")).ConversationSkillContextMismatchError) return reply.code(409).send({ error: "conversation_skill_context_mismatch" });
      if (error instanceof (await import("../skills/skill-policy.js")).SkillPolicyError) return reply.code(400).send({ error: error.code });
      if (
        error instanceof Error &&
        (error.message.startsWith("供应商配置") || error.message.startsWith("工作目录"))
      )
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

function parseSkillPolicy(value: unknown): import("../skills/types.js").SkillPolicy {
  if (value === undefined) return { mode: "disabled" as const };
  if (!value || typeof value !== "object") throw new Error("Skill policy 无效。");
  const policy = value as { mode?: unknown; skillIds?: unknown };
  if (policy.mode === "disabled" || policy.mode === "auto") { if (policy.skillIds !== undefined) throw new Error("Skill policy 无效。"); return { mode: policy.mode as "disabled" | "auto" }; }
  if (policy.mode === "selected" && Array.isArray(policy.skillIds) && policy.skillIds.every(x => typeof x === "string" && x)) { const skillIds = [...new Set(policy.skillIds)]; if (skillIds.length > 16) throw new Error("Skill policy 无效。"); return { mode: "selected" as const, skillIds }; }
  throw new Error("Skill policy 无效。");
}
