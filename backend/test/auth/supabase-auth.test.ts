import { createServer, type Server } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createSupabaseTokenVerifier } from "../../src/plugins/supabase-auth.js";
import type { AppConfig } from "../../src/config/env.js";

type StubRoutes = { [path: string]: { status: number; body: unknown } };

async function startStubServer(routes: StubRoutes): Promise<{
  server: Server;
  url: string;
}> {
  const server = createServer((request, response) => {
    const route = routes[request.url?.split("?")[0] ?? ""];
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(route.status, { "content-type": "application/json" });
    response.end(JSON.stringify(route.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无监听地址");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function signToken(
  privateKey: CryptoKey,
  kid: string,
  issuer: string,
  overrides: { exp?: string } = {},
) {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience("authenticated")
    .setSubject("user-1")
    .setExpirationTime(overrides.exp ?? "1h")
    .sign(privateKey);
}

describe("Supabase token verifier", () => {
  let server: Server;
  let supabaseUrl: string;

  beforeEach(async () => {
    ({ server, url: supabaseUrl } = await startStubServer({}));
  });

  afterEach(async () => {
    server.close();
  });

  function verifierConfig(
    overrides: Partial<AppConfig> = {},
  ): AppConfig {
    return {
      supabaseUrl,
      ...overrides,
    } as AppConfig;
  }

  it("用 JWKS 验签通过有效令牌", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { kid: "test-key", ...(await exportJWK(publicKey)) };
    server.removeAllListeners("request");
    server.on("request", (request, response) => {
      if (request.url === "/auth/v1/.well-known/jwks.json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      response.writeHead(404).end();
    });
    const token = await signToken(privateKey, "test-key", `${supabaseUrl}/auth/v1`);
    const verifier = createSupabaseTokenVerifier(verifierConfig());
    await expect(verifier(token)).resolves.toEqual({ id: "user-1" });
  });

  it("拒绝过期或签名不匹配的令牌", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { kid: "test-key", ...(await exportJWK(publicKey)) };
    server.removeAllListeners("request");
    server.on("request", (request, response) => {
      if (request.url === "/auth/v1/.well-known/jwks.json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      response.writeHead(404).end();
    });
    const verifier = createSupabaseTokenVerifier(verifierConfig());
    await expect(
      verifier(await signToken(privateKey, "test-key", `${supabaseUrl}/auth/v1`, { exp: "-1h" })),
    ).rejects.toThrow();
    const { privateKey: otherKey } = await generateKeyPair("RS256");
    await expect(
      verifier(await signToken(otherKey, "test-key", `${supabaseUrl}/auth/v1`)),
    ).rejects.toThrow();
  });

  it("JWKS 无密钥时回退到 Auth 服务器在线校验", async () => {
    server.removeAllListeners("request");
    server.on("request", (request, response) => {
      if (request.url === "/auth/v1/.well-known/jwks.json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [] }));
        return;
      }
      if (request.url === "/auth/v1/user") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "user-hs" }));
        return;
      }
      response.writeHead(404).end();
    });
    const verifier = createSupabaseTokenVerifier(
      verifierConfig({ supabasePublishableKey: "publishable-key" }),
    );
    await expect(verifier("any-token")).resolves.toEqual({ id: "user-hs" });
  });

  it("回退校验失败或缺少 publishable key 时返回未授权", async () => {
    server.removeAllListeners("request");
    server.on("request", (request, response) => {
      if (request.url === "/auth/v1/.well-known/jwks.json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [] }));
        return;
      }
      response.writeHead(401).end();
    });
    const withKey = createSupabaseTokenVerifier(
      verifierConfig({ supabasePublishableKey: "publishable-key" }),
    );
    await expect(withKey("bad-token")).resolves.toBeUndefined();
    const withoutKey = createSupabaseTokenVerifier(verifierConfig());
    await expect(withoutKey("any-token")).resolves.toBeUndefined();
  });
});

describe("Supabase 认证模式下的 HTTP 钩子", () => {
  let server: Server;
  let supabaseUrl: string;
  let token: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { kid: "test-key", ...(await exportJWK(publicKey)) };
    ({ server, url: supabaseUrl } = await startStubServer({}));
    server.removeAllListeners("request");
    server.on("request", (request, response) => {
      if (request.url === "/auth/v1/.well-known/jwks.json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      response.writeHead(404).end();
    });
    token = await signToken(privateKey, "test-key", `${supabaseUrl}/auth/v1`);
    app = createApp({
      host: "127.0.0.1",
      port: 3210,
      provider: "openai",
      workspaceRoot: "/tmp/antler-supabase-test",
      model: "test-model",
      maxRunDurationMs: 1_000,
      authMode: "supabase",
      supabaseUrl,
    });
  });

  afterEach(async () => {
    await app?.close();
    server.close();
  });

  it("API 未带令牌返回 401，探活保持公开", async () => {
    expect((await app.inject({ method: "GET", url: "/api/config" })).statusCode)
      .toBe(401);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode)
      .toBe(200);
  });

  it("带有效 Bearer 令牌可访问 API", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/config",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it("无效令牌返回 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/config",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(response.statusCode).toBe(401);
  });
});
