import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppConfig } from "../config/env.js";

export type AntlerUser = { id: string };

/**
 * Supabase 用户访问令牌验证器。
 *
 * 非对称签名密钥（默认）走 JWKS 本地验签；项目仍使用 HS256 共享密钥时
 * JWKS 不返回密钥，回退到 Auth 服务器在线校验（GET /auth/v1/user）。
 */
export type SupabaseTokenVerifier = (
  token: string,
) => Promise<AntlerUser | undefined>;

export function createSupabaseTokenVerifier(
  config: AppConfig,
): SupabaseTokenVerifier {
  const issuer = `${config.supabaseUrl}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  let mode: "jwks" | "auth-server" | undefined;

  async function resolveMode(): Promise<"jwks" | "auth-server"> {
    if (mode) return mode;
    const response = await fetch(`${issuer}/.well-known/jwks.json`);
    const document = (await response.json()) as { keys?: unknown[] };
    mode = document.keys?.length ? "jwks" : "auth-server";
    return mode;
  }

  return async (token) => {
    if ((await resolveMode()) === "jwks") {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: "authenticated",
      });
      return payload.sub ? { id: payload.sub } : undefined;
    }
    // HS256 共享密钥项目：官方不建议本地验签，交给 Auth 服务器校验。
    if (!config.supabasePublishableKey) return undefined;
    const response = await fetch(`${issuer}/user`, {
      headers: {
        apikey: config.supabasePublishableKey,
        authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return undefined;
    const user = (await response.json()) as { id?: unknown };
    return typeof user.id === "string" && user.id ? { id: user.id } : undefined;
  };
}
