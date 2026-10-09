import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";

function ragConfigurationUrl(value?: string): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function registerConfigRoutes(app: FastifyInstance, config: AppConfig) {
  app.get("/api/config", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return { ragUrl: ragConfigurationUrl(config.ragUrl) };
  });
}
