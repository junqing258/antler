import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("backend workspace configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("resolves the default workspace from the project root", async () => {
    vi.stubEnv("ANTLER_WORKSPACE_ROOT", undefined);

    const { config } = await import("./env.js");

    expect(config.workspaceRoot).toBe(resolve(projectRoot, "workspace"));
  });

  it("resolves a relative ANTLER_WORKSPACE_ROOT from the project root", async () => {
    vi.stubEnv("ANTLER_WORKSPACE_ROOT", "./custom-workspace");

    const { config } = await import("./env.js");

    expect(config.workspaceRoot).toBe(resolve(projectRoot, "custom-workspace"));
  });
});
