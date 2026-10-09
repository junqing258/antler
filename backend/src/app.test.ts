import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const temporaryDirectories: string[] = [];

async function staticDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "antler-static-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "assets"));
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><title>Antler Web</title>",
  );
  await writeFile(join(directory, "assets", "app.js"), 'console.log("antler")');
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("backend Web hosting", () => {
  it("exposes the bundled RAG skill for Web workspaces without a user installation", async () => {
    const workspaceRoot = await staticDirectory();
    const app = createApp({
      host: "127.0.0.1",
      port: 3210,
      provider: "openai",
      workspaceRoot,
      agentsDir: join(workspaceRoot, "no-user-skills"),
      model: "test-model",
      maxRunDurationMs: 1_000,
    });
    try {
      for (const url of [
        "/api/skills",
        `/api/skills?workingDirectory=${encodeURIComponent(workspaceRoot)}`,
      ]) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          skills: [{ id: "antler-rag", scope: "bundled" }],
          diagnostics: [],
        });
      }
    } finally {
      await app.close();
    }
  });

  it("serves the Web build, SPA fallback, health and API 404s directly", async () => {
    const app = createApp({
      host: "127.0.0.1",
      port: 3210,
      provider: "openai",
      workspaceRoot: process.cwd(),
      staticDir: await staticDirectory(),
      model: "test-model",
      maxRunDurationMs: 1_000,
    });

    const home = await app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain("Antler Web");
    expect(home.headers["cache-control"]).toBe("public, max-age=0");

    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");

    const spa = await app.inject({
      method: "GET",
      url: "/projects/example",
      headers: { accept: "text/html" },
    });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain("Antler Web");

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok" });

    const missingApi = await app.inject({ method: "GET", url: "/api/missing" });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toEqual({ error: "路由不存在。" });
    await app.close();
  });

  it("compresses static assets when the client requests it", async () => {
    const directory = await staticDirectory();
    await writeFile(
      join(directory, "assets", "large.js"),
      `const data = ${JSON.stringify("antler".repeat(500))};`,
    );
    const app = createApp({
      host: "127.0.0.1",
      port: 3210,
      provider: "openai",
      workspaceRoot: process.cwd(),
      staticDir: directory,
      model: "test-model",
      maxRunDurationMs: 1_000,
    });

    const plain = await app.inject({ method: "GET", url: "/assets/large.js" });
    expect(plain.statusCode).toBe(200);
    expect(plain.headers["content-encoding"]).toBeUndefined();

    const compressed = await app.inject({
      method: "GET",
      url: "/assets/large.js",
      headers: { "accept-encoding": "gzip" },
    });
    expect(compressed.statusCode).toBe(200);
    expect(compressed.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(compressed.rawPayload).toString()).toContain("antler");
    await app.close();
  });
});
