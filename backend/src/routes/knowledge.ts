import type { FastifyInstance } from "fastify";
import type { KnowledgeService } from "../knowledge/service.js";

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  service: KnowledgeService,
) {
  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/knowledge-bases",
    async (r) => service.list(r.params.projectId),
  );
  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/knowledge-bases",
    async (r, reply) => {
      const b = r.body as { name?: unknown; description?: unknown };
      if (typeof b?.name !== "string" || !b.name.trim())
        return reply.code(400).send({ error: "name_required" });
      return reply
        .code(201)
        .send(
          await service.create(
            r.params.projectId,
            b.name.trim(),
            typeof b.description === "string" ? b.description : undefined,
          ),
        );
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/knowledge-bases/:id",
    async (r, reply) => {
      const base = await service.get(r.params.id);
      return (
        base ?? reply.code(404).send({ error: "knowledge_base_not_found" })
      );
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/knowledge-bases/:id",
    async (r, reply) =>
      (await service.archiveBase(r.params.id))
        ? reply.code(204).send()
        : reply.code(404).send({ error: "knowledge_base_not_found" }),
  );
  app.post<{ Params: { id: string } }>(
    "/api/knowledge-bases/:id/sources",
    async (r, reply) => {
      try {
        const body = r.body as {
          type?: "text" | "file" | "directory";
          displayName?: string;
          text?: string;
          path?: string;
        };
        if (!body || !["text", "file", "directory"].includes(body.type ?? ""))
          return reply.code(400).send({ error: "source_type_invalid" });
        return reply
          .code(202)
          .send(
            await service.addSource(
              r.params.id,
              body as Required<Pick<typeof body, "type">> & typeof body,
            ),
          );
      } catch (e) {
        return reply
          .code(400)
          .send({ error: e instanceof Error ? e.message : "source_invalid" });
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/knowledge-bases/:id/sources",
    async (r, reply) => {
      const base = await service.get(r.params.id);
      return base
        ? base.sources
        : reply.code(404).send({ error: "knowledge_base_not_found" });
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/knowledge-sources/:id",
    async (r, reply) =>
      (await service.archiveSource(r.params.id))
        ? reply.code(204).send()
        : reply.code(404).send({ error: "knowledge_source_not_found" }),
  );
  app.post<{ Params: { id: string } }>(
    "/api/knowledge-sources/:id/reindex",
    async (r, reply) => {
      try {
        return reply.code(202).send(await service.reindex(r.params.id));
      } catch {
        return reply.code(404).send({ error: "knowledge_source_not_found" });
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/knowledge-jobs/:id",
    async (r, reply) => {
      const job = await service.job(r.params.id);
      return job ?? reply.code(404).send({ error: "knowledge_job_not_found" });
    },
  );
  app.get<{ Params: { id: string }; Querystring: { afterEventId?: string } }>(
    "/api/knowledge-jobs/:id/events",
    async (r, reply) => {
      const after = Number(
        r.query.afterEventId ?? r.headers["last-event-id"] ?? 0,
      );
      if (!Number.isSafeInteger(after) || after < 0)
        return reply.code(400).send({ error: "afterEventId_invalid" });
      if (!(await service.job(r.params.id)))
        return reply.code(404).send({ error: "knowledge_job_not_found" });
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      const send = (e: { seq: number; type: string; payload: unknown }) =>
        reply.raw.write(
          `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`,
        );
      for (const e of await service.events(r.params.id, after))
        send({ seq: e.seq, type: e.type, payload: e.payload });
      const job = await service.job(r.params.id);
      if (
        ["succeeded", "failed", "cancelled", "interrupted"].includes(
          job!.status,
        )
      ) {
        reply.raw.end();
        return;
      }
      const unsubscribe = service.subscribe(r.params.id, send);
      reply.raw.on("close", unsubscribe);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/knowledge-jobs/:id/cancel",
    async (r, reply) => {
      try {
        return await service.cancel(r.params.id);
      } catch {
        return reply.code(404).send({ error: "knowledge_job_not_found" });
      }
    },
  );
}
