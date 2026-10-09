import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import {
  RagConfigValidationError,
  type RagConfigStore,
} from "../config/rag-config.js";

export function registerConfigRoutes(
  app: FastifyInstance,
  config: RagConfigStore,
  provider: Pick<AppConfig, "model">,
) {
  app.get("/api/config/provider", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return { model: provider.model };
  });

  app.get("/api/config", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return config.publicConfig();
  });

  app.put("/api/config/rag", async (request, reply) => {
    reply.header("cache-control", "no-store");
    try {
      return config.update(request.body);
    } catch (error) {
      // Only validation failures are client errors; disk failures remain 500s.
      if (error instanceof RagConfigValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  app.delete("/api/config/rag", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return config.reset();
  });
}
