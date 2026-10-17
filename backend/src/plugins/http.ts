import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/env.js";
import {
  type SupabaseTokenVerifier,
  createSupabaseTokenVerifier,
} from "./supabase-auth.js";

declare module "fastify" {
  interface FastifyRequest {
    antlerAuthorized: boolean;
    antlerUser?: { id: string };
  }
}

function setCorsHeaders(reply: FastifyReply) {
  // The service only binds to loopback. The token protects requests from other local processes.
  reply
    .header("access-control-allow-origin", "*")
    .header("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS")
    .header(
      "access-control-allow-headers",
      "content-type, x-antler-token, authorization",
    );
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

function isPublicWebRequest(request: FastifyRequest, staticDir?: string) {
  if (!staticDir || (request.method !== "GET" && request.method !== "HEAD"))
    return false;
  const path = request.url.split("?", 1)[0];
  return path !== "/health" && path !== "/api" && !path.startsWith("/api/");
}

function bearerToken(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;
  const [scheme, token] = header.split(" ", 2);
  return scheme?.toLowerCase() === "bearer" ? token : undefined;
}

export function registerHttpHooks(app: FastifyInstance, config: AppConfig) {
  app.decorateRequest("antlerAuthorized", false);
  const verifyToken: SupabaseTokenVerifier | undefined =
    config.authMode === "supabase" && config.supabaseUrl
      ? createSupabaseTokenVerifier(config)
      : undefined;

  app.addHook("onRequest", async (request, reply) => {
    setCorsHeaders(reply);
    if (request.method === "OPTIONS") return reply.code(204).send();
    if (verifyToken) {
      // Supabase 模式：API 需要 Bearer Token，静态资源与探活保持公开。
      const path = request.url.split("?", 1)[0];
      request.antlerAuthorized =
        path === "/health" || isPublicWebRequest(request, config.staticDir);
      if (request.antlerAuthorized) return;
      const token = bearerToken(request);
      if (!token) return;
      try {
        const user = await verifyToken(token);
        if (user) {
          request.antlerUser = user;
          request.antlerAuthorized = true;
        }
      } catch {
        // 验签失败视为未授权，保持 401 语义。
      }
      return;
    }
    request.antlerAuthorized =
      isAuthorized(request, config.accessToken) ||
      isPublicWebRequest(request, config.staticDir);
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.antlerAuthorized)
      return reply.code(401).send({
        error:
          config.authMode === "supabase"
            ? "未登录或登录已过期。"
            : "未授权的本地服务请求。",
      });
  });
}
