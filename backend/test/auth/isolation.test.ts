import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { migratedWorkspace } from "../scheduler/helpers.js";

async function startJwksServer(publicJwk: Record<string, unknown>) {
  const server = createServer((request, response) => {
    if (request.url === "/auth/v1/.well-known/jwks.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无监听地址");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe("Supabase 多用户数据隔离", () => {
  let workspace: { root: string; file: string };
  let server: Server;
  let supabaseUrl: string;
  let tokens: { alice: string; bob: string };
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    workspace = await migratedWorkspace();
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { kid: "test-key", ...(await exportJWK(publicKey)) };
    ({ server, url: supabaseUrl } = await startJwksServer(jwk));
    const sign = async (sub: string) =>
      new SignJWT({ role: "authenticated" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
        .setIssuedAt()
        .setIssuer(`${supabaseUrl}/auth/v1`)
        .setAudience("authenticated")
        .setSubject(sub)
        .setExpirationTime("1h")
        .sign(privateKey);
    tokens = { alice: await sign("user-alice"), bob: await sign("user-bob") };
    app = createApp({
      host: "127.0.0.1",
      port: 3210,
      provider: "openai",
      workspaceRoot: join(workspace.root, "workspace"),
      platformRoot: join(workspace.root, "platform"),
      databaseUrl: `file:${workspace.file}`,
      model: "test-model",
      maxRunDurationMs: 1_000,
      authMode: "supabase",
      supabaseUrl,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    server.close();
    if (workspace) await import("node:fs/promises").then((fs) => fs.rm(workspace.root, { recursive: true, force: true }));
  });

  it("用户无法访问他人的运行", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: { authorization: `Bearer ${tokens.alice}` },
      payload: { message: "hello", projectId: "p1", conversationId: "c1" },
    });
    expect(created.statusCode).toBe(202);
    const { runId } = created.json() as { runId: string };

    const bobCancel = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/cancel`,
      headers: { authorization: `Bearer ${tokens.bob}` },
    });
    expect(bobCancel.statusCode).toBe(404);

    const aliceCancel = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/cancel`,
      headers: { authorization: `Bearer ${tokens.alice}` },
    });
    expect(aliceCancel.statusCode).toBe(202);
  });

  it("用户无法访问他人的定时任务", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/scheduled-tasks",
      headers: { authorization: `Bearer ${tokens.alice}` },
      payload: {
        name: "alice-task",
        type: "http",
        schedule: "0 9 * * *",
        payload: { url: "https://example.com", method: "GET" },
      },
    });
    expect(created.statusCode).toBe(201);
    const task = created.json() as { id: string };

    const bobList = await app.inject({
      method: "GET",
      url: "/api/scheduled-tasks",
      headers: { authorization: `Bearer ${tokens.bob}` },
    });
    expect((bobList.json() as { total: number }).total).toBe(0);

    const bobGet = await app.inject({
      method: "GET",
      url: `/api/scheduled-tasks/${task.id}`,
      headers: { authorization: `Bearer ${tokens.bob}` },
    });
    expect(bobGet.statusCode).toBe(404);

    const aliceGet = await app.inject({
      method: "GET",
      url: `/api/scheduled-tasks/${task.id}`,
      headers: { authorization: `Bearer ${tokens.alice}` },
    });
    expect(aliceGet.statusCode).toBe(200);
  });
});
