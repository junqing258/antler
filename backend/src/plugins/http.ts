import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/env.js";

declare module "fastify" {
  interface FastifyRequest {
    antlerAuthorized: boolean;
  }
}

function setCorsHeaders(reply: FastifyReply) {
  // The service only binds to loopback. The token protects requests from other local processes.
  reply
    .header("access-control-allow-origin", "*")
    .header("access-control-allow-methods", "GET, POST, OPTIONS")
    .header("access-control-allow-headers", "content-type, x-antler-token");
}

function isAuthorized(request: FastifyRequest, accessToken?: string) {
  // Native EventSource cannot attach headers, so it uses the app-session token in its URL.
  const token = (request.query as { token?: unknown }).token;
  return (
    !accessToken ||
    request.headers["x-antler-token"] === accessToken ||
    token === accessToken
  );
}

export function registerHttpHooks(app: FastifyInstance, config: AppConfig) {
  app.decorateRequest("antlerAuthorized", false);

  app.addHook("onRequest", async (request, reply) => {
    setCorsHeaders(reply);
    if (request.method === "OPTIONS") return reply.code(204).send();
    request.antlerAuthorized = isAuthorized(request, config.accessToken);
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.antlerAuthorized)
      return reply.code(401).send({ error: "未授权的本地服务请求。" });
  });
}
