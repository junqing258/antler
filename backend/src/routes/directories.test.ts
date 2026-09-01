import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerDirectoryRoutes } from "./directories.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("GET /api/directories", () => {
  it("lists folders beneath the configured workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-workspace-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "zeta"));
    await mkdir(join(root, "alpha", "nested"), { recursive: true });
    const app = Fastify();
    registerDirectoryRoutes(app, root);
    const canonicalRoot = await realpath(root);

    const rootResponse = await app.inject({ method: "GET", url: "/api/directories" });
    expect(rootResponse.statusCode).toBe(200);
    expect(rootResponse.json()).toMatchObject({
      root: canonicalRoot,
      path: "",
      workingDirectory: canonicalRoot,
      parent: null,
      directories: [
        { name: "alpha", path: "alpha" },
        { name: "zeta", path: "zeta" },
      ],
    });

    const nestedResponse = await app.inject({
      method: "GET",
      url: "/api/directories?path=alpha",
    });
    expect(nestedResponse.json()).toMatchObject({
      path: "alpha",
      workingDirectory: resolve(canonicalRoot, "alpha"),
      parent: "",
      directories: [{ name: "nested", path: join("alpha", "nested") }],
    });
    await app.close();
  });

  it.each(["../", resolve("/")])("rejects a path outside the workspace: %s", async (path) => {
    const root = await mkdtemp(join(tmpdir(), "antler-workspace-"));
    temporaryDirectories.push(root);
    const app = Fastify();
    registerDirectoryRoutes(app, root);

    const response = await app.inject({
      method: "GET",
      url: `/api/directories?path=${encodeURIComponent(path)}`,
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
