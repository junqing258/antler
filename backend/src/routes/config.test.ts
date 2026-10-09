import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function testApp(ragUrl?: string) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "antler-config-"));
  workspaces.push(workspaceRoot);
  return createApp({
    host: "127.0.0.1",
    port: 3210,
    provider: "openai",
    accessToken: "test-token",
    openAiApiKey: "secret-provider-key",
    ragUrl,
    workspaceRoot,
    model: "test-model",
    maxRunDurationMs: 1_000,
  });
}

describe("RAG configuration", () => {
  it("returns only the configured public URL and requires the backend token", async () => {
    const app = await testApp(" https://rag.example.com ");
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
      expect(response.json()).toEqual({ ragUrl: "https://rag.example.com/" });
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
      expect(response.json()).toEqual({ ragUrl: null });
    } finally {
      await app.close();
    }
  });

  it("supports a local RAG service and removes local knowledge management routes", async () => {
    const app = await testApp("http://localhost:8001");
    try {
      const headers = { "x-antler-token": "test-token" };
      const config = await app.inject({
        method: "GET",
        url: "/api/config",
        headers,
      });
      expect(config.json()).toEqual({ ragUrl: "http://localhost:8001/" });
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
