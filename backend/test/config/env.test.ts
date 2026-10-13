import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("backend workspace configuration", () => {
  it.each([
    ["true", true],
    ["false", false],
    ["1", false],
    ["TRUE", false],
    [undefined, false],
  ])("enables scheduled scripts only for the explicit true setting (%s)", async (value, expected) => {
    vi.stubEnv("ANTLER_SCHEDULER_ENABLE_SCRIPT", value);
    const { config } = await import("../../src/config/env.js");
    expect(config.schedulerEnableScript).toBe(expected);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("resolves the default workspace from the project root", async () => {
    vi.stubEnv("ANTLER_WORKSPACE_ROOT", undefined);

    const { config } = await import("../../src/config/env.js");

    expect(config.workspaceRoot).toBe(resolve(projectRoot, "workspace"));
  });

  it("resolves a relative ANTLER_WORKSPACE_ROOT from the project root", async () => {
    vi.stubEnv("ANTLER_WORKSPACE_ROOT", "./custom-workspace");

    const { config } = await import("../../src/config/env.js");

    expect(config.workspaceRoot).toBe(resolve(projectRoot, "custom-workspace"));
  });

  it("reads the default RAG URL and key from the backend environment", async () => {
    vi.stubEnv("ANTLER_RAG_URL", "https://rag.example.com");
    vi.stubEnv("ANTLER_RAG_KEY", "test-rag-key");
    const { config } = await import("../../src/config/env.js");
    expect(config.ragUrl).toBe("https://rag.example.com");
    expect(config.ragKey).toBe("test-rag-key");
  });
});
