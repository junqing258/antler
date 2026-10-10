import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function testApp(ragUrl?: string, ragKey?: string, root?: string) {
  const workspaceRoot =
    root ?? (await mkdtemp(join(tmpdir(), "antler-config-")));
  if (!root) workspaces.push(workspaceRoot);
  return createApp({
    host: "127.0.0.1",
    port: 3210,
    provider: "openai",
    accessToken: "test-token",
    openAiApiKey: "secret-provider-key",
    ragUrl,
    ragKey,
    workspaceRoot,
    model: "test-model",
    maxRunDurationMs: 1_000,
  });
}

describe("RAG configuration", () => {
  it("exposes the effective server model without credentials and requires authorization", async () => {
    const app = await testApp();
    try {
      const unauthorized = await app.inject({ method: "GET", url: "/api/config/provider" });
      expect(unauthorized.statusCode).toBe(401);
      const response = await app.inject({
        method: "GET",
        url: "/api/config/provider",
        headers: { "x-antler-token": "test-token" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ model: "test-model" });
      expect(response.body).not.toContain("secret-provider-key");
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });

  it("persists overrides across restarts, retains a blank draft key, and restores defaults", async () => {
    const headers = { "x-antler-token": "test-token" };
    let app = await testApp("https://default.example.com", "default-key");
    const root = workspaces[workspaces.length - 1];
    try {
      const saved = await app.inject({
        method: "PUT",
        url: "/api/config/rag",
        headers,
        payload: {
          ragUrl: " https://custom.example.com/ ",
          ragKey: " custom-key ",
        },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toEqual({
        ragUrl: "https://custom.example.com/",
        ragKeyConfigured: true,
        ragConfigOverridden: true,
      });
      expect(saved.body).not.toContain("custom-key");
      await app.close();
      app = await testApp(
        "https://changed-default.example.com",
        "changed-default-key",
        root,
      );
      const reloaded = await app.inject({
        method: "GET",
        url: "/api/config",
        headers,
      });
      expect(reloaded.json()).toEqual(saved.json());
      const retained = await app.inject({
        method: "PUT",
        url: "/api/config/rag",
        headers,
        payload: { ragUrl: "http://localhost:8001" },
      });
      expect(retained.json()).toMatchObject({
        ragUrl: "http://localhost:8001/",
        ragKeyConfigured: true,
      });
      const cleared = await app.inject({
        method: "PUT",
        url: "/api/config/rag",
        headers,
        payload: { ragUrl: "", ragKey: "" },
      });
      expect(cleared.json()).toEqual({
        ragUrl: null,
        ragKeyConfigured: false,
        ragConfigOverridden: true,
      });
      const reset = await app.inject({
        method: "DELETE",
        url: "/api/config/rag",
        headers,
      });
      expect(reset.statusCode).toBe(200);
      expect(reset.json()).toEqual({
        ragUrl: "https://changed-default.example.com/",
        ragKeyConfigured: true,
        ragConfigOverridden: false,
      });
      await app.close();
      app = await testApp("https://default.example.com", "default-key", root);
      const afterReset = await app.inject({
        method: "GET",
        url: "/api/config",
        headers,
      });
      expect(afterReset.json()).toMatchObject({
        ragUrl: "https://default.example.com/",
        ragConfigOverridden: false,
      });
    } finally {
      await app.close();
    }
  });

  it("requires authorization for writes and supports their browser preflight", async () => {
    const app = await testApp();
    try {
      for (const method of ["PUT", "DELETE"] as const) {
        expect(
          (await app.inject({ method, url: "/api/config/rag" })).statusCode,
        ).toBe(401);
      }
      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/api/config/rag",
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers["access-control-allow-methods"]).toContain(
        "PUT",
      );
      expect(preflight.headers["access-control-allow-methods"]).toContain(
        "DELETE",
      );
    } finally {
      await app.close();
    }
  });

  it.each([
    { ragUrl: "not a URL" },
    { ragUrl: "javascript:alert(1)" },
    { ragUrl: "https://user:password@rag.example.com" },
    { ragUrl: "https://rag.example.com/api" },
    { ragUrl: "https://rag.example.com?key=secret" },
    { ragUrl: "https://rag.example.com#fragment" },
    { ragUrl: "ftp://rag.example.com" },
    { ragUrl: 42 },
    { ragKey: 42 },
    ["invalid"],
  ])(
    "rejects invalid overrides without changing the effective configuration: %j",
    async (payload) => {
      const app = await testApp("https://default.example.com", "default-key");
      try {
        const headers = { "x-antler-token": "test-token" };
        const response = await app.inject({
          method: "PUT",
          url: "/api/config/rag",
          headers,
          payload,
        });
        expect(response.statusCode).toBe(400);
        const config = await app.inject({
          method: "GET",
          url: "/api/config",
          headers,
        });
        expect(config.json()).toEqual({
          ragUrl: "https://default.example.com/",
          ragKeyConfigured: true,
          ragConfigOverridden: false,
        });
      } finally {
        await app.close();
      }
    },
  );

  it("returns only the configured public URL and requires the backend token", async () => {
    const app = await testApp(" https://rag.example.com ", "secret-rag-key");
    try {
      const unauthorized = await app.inject({
        method: "GET",
        url: "/api/config",
      });
      expect(unauthorized.statusCode).toBe(401);
      const response = await app.inject({
        method: "GET",
        url: "/api/config",
        headers: { "x-antler-token": "test-token" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ragUrl: "https://rag.example.com/",
        ragKeyConfigured: true,
        ragConfigOverridden: false,
      });
      expect(response.body).not.toContain("secret-rag-key");
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });

  it.each([
    undefined,
    "",
    "not a URL",
    "javascript:alert(1)",
    "file:///tmp/config",
    "https://user:secret@rag.example.com",
  ])("does not expose invalid or credential-bearing URL %s", async (url) => {
    const app = await testApp(url);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/config",
        headers: { "x-antler-token": "test-token" },
      });
      expect(response.json()).toMatchObject({ ragUrl: null });
    } finally {
      await app.close();
    }
  });

  it.each(["http://rag.example.com:6050", "http://47.100.210.56:6050"])(
    "supports remote HTTP defaults and persists overrides: %s",
    async (ragUrl) => {
      const headers = { "x-antler-token": "test-token" };
      let app = await testApp(ragUrl, "default-key");
      const root = workspaces[workspaces.length - 1];
      try {
        const config = await app.inject({ method: "GET", url: "/api/config", headers });
        expect(config.json()).toEqual({
          ragUrl: `${ragUrl}/`,
          ragKeyConfigured: true,
          ragConfigOverridden: false,
        });
        const saved = await app.inject({
          method: "PUT",
          url: "/api/config/rag",
          headers,
          payload: { ragUrl: ` ${ragUrl}/ ` },
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json()).toEqual({
          ragUrl: `${ragUrl}/`,
          ragKeyConfigured: true,
          ragConfigOverridden: true,
        });
        await app.close();
        app = await testApp("https://default.example.com", "default-key", root);
        const reloaded = await app.inject({ method: "GET", url: "/api/config", headers });
        expect(reloaded.json()).toEqual(saved.json());
      } finally {
        await app.close();
      }
    },
  );

  it("supports a local RAG service and removes local knowledge management routes", async () => {
    const app = await testApp("http://localhost:8001");
    try {
      const headers = { "x-antler-token": "test-token" };
      const config = await app.inject({
        method: "GET",
        url: "/api/config",
        headers,
      });
      expect(config.json()).toMatchObject({ ragUrl: "http://localhost:8001/" });
      for (const url of [
        "/api/projects/example/knowledge-bases",
        "/api/knowledge-bases/example",
        "/api/knowledge-jobs/example",
      ]) {
        const response = await app.inject({ method: "GET", url, headers });
        expect(response.statusCode).toBe(404);
      }
      const create = await app.inject({
        method: "POST",
        url: "/api/projects/example/knowledge-bases",
        headers,
        payload: { name: "local" },
      });
      expect(create.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
