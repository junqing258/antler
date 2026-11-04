import type { FastifyInstance } from "fastify";
import type { PlatformService } from "../platform/service.js";
import { platformAuth } from "./agents.js";
import { canEdit } from "../platform/errors.js";
export function registerSkillRoutes(
  app: FastifyInstance,
  service: PlatformService,
  authMode: "local" | "supabase",
) {
  app.get("/api/skills", async (req) => {
    const auth = platformAuth(req, authMode);
    return {
      skills: (await service.listSkills()).map((s) => ({
        ...s,
        editable: canEdit(s, auth),
      })),
      diagnostics: [],
    };
  });
  app.post("/api/skills", { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) =>
    reply
      .code(201)
      .send(await service.upload(req.body, platformAuth(req, authMode))),
  );
  app.put<{ Params: { id: string } }>(
    "/api/skills/:id",
    { bodyLimit: 7 * 1024 * 1024 },
    async (req) =>
      service.upload(req.body, platformAuth(req, authMode), req.params.id),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/skills/:id",
    async (req, reply) => {
      await service.deleteSkill(req.params.id, platformAuth(req, authMode));
      return reply.code(204).send();
    },
  );
}
