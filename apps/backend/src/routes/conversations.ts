import type { OutgoingHttpHeaders } from "node:http";
import type { FastifyInstance } from "fastify";
import type { ConversationStore } from "../conversations/store.js";
import type { AntlerHostRuntime } from "../agent/host-runtime.js";
import { PlatformError } from "../platform/errors.js";

function number(
  value: unknown,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (value === undefined) return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > max)
    throw new PlatformError("invalid_cursor", 400);
  return result;
}
export function registerConversationRoutes(
  app: FastifyInstance,
  store: ConversationStore,
  runtime: AntlerHostRuntime,
) {
  app.get<{
    Querystring: { limit?: string; cursor?: string; agentId?: string };
  }>("/api/conversations", async (request) => {
    return store.list(
      request.antlerUser?.id ?? "",
      Math.max(1, number(request.query.limit, 50, 100)),
      request.query.cursor,
      request.query.agentId,
    );
  });
  app.get<{ Querystring: { afterChangeId?: string } }>(
    "/api/conversations/changes",
    async (request, reply) => {
      const userId = request.antlerUser?.id ?? "";
      let cursor = number(
        request.query.afterChangeId ?? request.headers["last-event-id"],
        0,
      );
      const bounds = await store.syncBounds(userId);
      if (cursor > bounds.lastChangeId || cursor < bounds.firstChangeId - 1)
        throw new PlatformError("reset_required", 409);
      reply.hijack();
      reply.raw.writeHead(200, {
        ...reply.getHeaders(),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      } as OutgoingHttpHeaders);
      reply.raw.flushHeaders();
      let closed = false;
      let timer: ReturnType<typeof setTimeout>;
      reply.raw.on("close", () => {
        closed = true;
        clearTimeout(timer);
      });
      const poll = async () => {
        try {
          const changes = await store.changes(userId, cursor);
          for (const change of changes) {
            if (closed) return;
            reply.raw.write(
              `id: ${change.changeId}\nevent: conversation.changed\ndata: ${JSON.stringify(change)}\n\n`,
            );
            cursor = change.changeId;
          }
          if (!closed) {
            reply.raw.write(": heartbeat\n\n");
            timer = setTimeout(
              () => void poll(),
              changes.length === 100 ? 0 : 750,
            );
          }
        } catch {
          if (!closed) reply.raw.destroy();
        }
      };
      void poll();
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (request) => {
      const row = await store.detail(
        request.antlerUser?.id ?? "",
        request.params.id,
      );
      if (!row) throw new PlatformError("conversation_not_found", 404);
      return {
        ...row,
        contextState: runtime.hasConversationContext(row.id)
          ? "available"
          : row.contextState,
        contextReason:
          runtime.hasConversationContext(row.id) ||
          row.contextState === "available"
            ? null
            : row.contextState === "unavailable"
              ? "模型上下文含不能安全保存的秘密，无法恢复，请新建会话。"
              : "模型上下文尚未恢复，请新建会话。",
      };
    },
  );
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; beforeSeq?: string; afterSeq?: string };
  }>("/api/conversations/:id/messages", async (request) => {
    const q = request.query;
    if (q.beforeSeq !== undefined && q.afterSeq !== undefined)
      throw new PlatformError("invalid_cursor", 400);
    return store.messages(
      request.antlerUser?.id ?? "",
      request.params.id,
      Math.max(1, number(q.limit, 50, 100)),
      q.beforeSeq === undefined ? undefined : number(q.beforeSeq, 0),
      q.afterSeq === undefined ? undefined : number(q.afterSeq, 0),
    );
  });
  app.patch<{
    Params: { id: string };
    Body: { title?: unknown; expectedRevision?: unknown };
  }>("/api/conversations/:id", async (request) => {
    const { title, expectedRevision } = request.body ?? {};
    if (typeof title !== "string" || !title.trim() || title.length > 200)
      throw new PlatformError("invalid_title", 400);
    return store.title(
      request.antlerUser?.id ?? "",
      request.params.id,
      title.trim(),
      number(expectedRevision, -1),
    );
  });
  app.delete<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (request) => {
      const userId = request.antlerUser?.id ?? "";
      const runId = await store.remove(userId, request.params.id);
      if (runId) await runtime.cancel(runId, userId);
      return { deleted: true };
    },
  );
}
