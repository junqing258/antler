import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";

/**
 * 前端启动时公开获取的认证配置。publishable key 本就设计为公开，
 * 登录必须由浏览器直连 Supabase 完成。
 */
export function registerAuthConfigRoutes(app: FastifyInstance, config: AppConfig) {
  if (config.authMode === "supabase" && !config.supabasePublishableKey) {
    console.warn(
      "[auth] ANTLER_AUTH_MODE=supabase 但未配置 ANTLER_SUPABASE_PUBLISHABLE_KEY，浏览器端将无法登录。",
    );
  }
  app.get("/api/auth-config", async () => {
    if (
      config.authMode !== "supabase" ||
      !config.supabaseUrl ||
      !config.supabasePublishableKey
    )
      return { mode: "local" as const };
    return {
      mode: "supabase" as const,
      url: config.supabaseUrl,
      publishableKey: config.supabasePublishableKey,
    };
  });
}
