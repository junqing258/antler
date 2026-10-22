import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

describe("startup", () => {
  it("waits for initialization that exceeds Fastify's default hook timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-startup-"));
    const app = createApp({
      host: "127.0.0.1",
      port: 0,
      provider: "openai",
      model: "test",
      workspaceRoot: join(root, "workspace"),
      platformRoot: join(root, "platform"),
      maxRunDurationMs: 1_000,
    });
    let initialized = false;
    app.addHook("onReady", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_100));
      initialized = true;
    });
    try {
      await app.ready();
      expect(initialized).toBe(true);
      expect((await app.inject("/health")).statusCode).toBe(200);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
