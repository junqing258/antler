import type { FastifyInstance } from "fastify";
import type { SkillRegistry } from "../skills/skill-registry.js";
import { parseWorkingDirectory } from "./runs.js";
export function registerSkillRoutes(
  app: FastifyInstance,
  registry: SkillRegistry,
) {
  app.get("/api/skills", async (request, reply) => {
    try {
      const workingDirectory = parseWorkingDirectory(
        (request.query as { workingDirectory?: unknown }).workingDirectory,
      );
      const catalog = await registry.list(workingDirectory);
      return reply.send({
        skills: catalog.skills.map((s) => ({
          id: s.id,
          name: s.skill.name,
          description: s.skill.description,
          scope: s.scope,
          modelUri: s.modelUri,
          fingerprint: s.fingerprint,
        })),
        diagnostics: catalog.diagnostics,
      });
    } catch (error) {
      return reply
        .code(400)
        .send({
          error: error instanceof Error ? error.message : "工作目录无效。",
        });
    }
  });
}
