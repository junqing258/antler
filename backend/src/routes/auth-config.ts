import type { FastifyInstance } from "fastify";
import { validateAuthConfig, type AppConfig } from "../config/env.js";

/**
 * 前端启动时公开获取的认证配置。publishable key 本就设计为公开，
 * 登录必须由浏览器直连 Supabase 完成。
 */
export function registerAuthConfigRoutes(
  app: FastifyInstance,
  config: AppConfig,
) {
  validateAuthConfig(config);
  app.get("/api/auth-config", async () => {
    if (config.authMode !== "supabase")
      return {
        mode: "local" as const,
        requiresAccessToken: !!config.accessToken,
      };
    return {
      mode: "supabase" as const,
      url: config.supabaseUrl,
      publishableKey: config.supabasePublishableKey,
    };
  });
}
