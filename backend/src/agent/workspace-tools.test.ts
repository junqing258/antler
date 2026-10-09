import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceTools } from "./workspace-tools.js";
import { REDACTED } from "./secret-guard.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "antler-tools-security-"));
  roots.push(root);
  await writeFile(
    join(root, ".env"),
    "PRIVATE_VALUE=workspace-private-value\n",
  );
  const tools = createWorkspaceTools(root);
  const tool = (name: string) => tools.find((item) => item.name === name)!;
  return { root, tool };
}

describe("workspace secret protection", () => {
  it.each([".env", ".env.local", "nested/.env.production", ".env.example"])(
    "denies reading/writing/editing %s",
    async (path) => {
      const { root, tool } = await setup();
      await mkdir(join(root, "nested"));
      await writeFile(join(root, path), "SECRET=private-value\n");
      for (const name of ["read", "write", "edit"]) {
        await expect(
          tool(name).execute("test", {
            path,
            content: "new",
            oldText: "SECRET",
            newText: "OTHER",
          }),
        ).rejects.toThrow("secret_access_denied");
      }
      expect(await readFile(join(root, path), "utf8")).toBe(
        "SECRET=private-value\n",
      );
    },
  );

  it("denies symlink aliases for protected files and directories", async () => {
    const { root, tool } = await setup();
    await symlink(join(root, ".env"), join(root, "alias.txt"));
    await mkdir(join(root, ".env.private"));
    await symlink(join(root, ".env.private"), join(root, "alias-directory"));
    await expect(
      tool("read").execute("test", { path: "alias.txt" }),
    ).rejects.toThrow("secret_access_denied");
    await expect(
      tool("write").execute("test", {
        path: "alias-directory/new.txt",
        content: "test",
      }),
    ).rejects.toThrow("secret_access_denied");
  });

  it.each([
    "cat .env",
    "source .env.local",
    "cat nested/.env.production",
    "cat .antler/rag-config.json",
  ])("denies direct shell access: %s", async (command) => {
    const { tool } = await setup();
    await expect(tool("bash").execute("test", { command })).rejects.toThrow(
      "secret_access_denied",
    );
  });

  it("redacts copied secrets from reads, wildcard shell output, encodings and failed commands", async () => {
    const { root, tool } = await setup();
    await writeFile(join(root, "copy.txt"), "workspace-private-value");
    expect(
      (await tool("read").execute("test", { path: "copy.txt" })).content,
    ).toEqual([{ type: "text", text: `1: ${REDACTED}` }]);
    expect(
      (await tool("bash").execute("test", { command: "cat .e*" })).content,
    ).toEqual([{ type: "text", text: REDACTED }]);
    expect(
      (await tool("bash").execute("test", { command: "cat .e* | base64" }))
        .content,
    ).not.toEqual([
      {
        type: "text",
        text:
          Buffer.from("PRIVATE_VALUE=workspace-private-value\n").toString(
            "base64",
          ) + "\n",
      },
    ]);
    await expect(
      tool("bash").execute("test", { command: "cat copy.txt >&2; exit 1" }),
    ).rejects.toThrow(REDACTED);
    try {
      await tool("bash").execute("test", {
        command: "cat copy.txt >&2; exit 1",
      });
    } catch (error) {
      expect(String(error)).not.toContain("workspace-private-value");
    }
  });

  it("allows normal file operations and build commands while removing backend credentials", async () => {
    const { tool } = await setup();
    vi.stubEnv("OPENAI_API_KEY", "backend-secret-key");
    await tool("write").execute("test", {
      path: "normal.txt",
      content: "hello",
    });
    await tool("edit").execute("test", {
      path: "normal.txt",
      oldText: "hello",
      newText: "world",
    });
    expect(
      (await tool("read").execute("test", { path: "normal.txt" })).content,
    ).toEqual([{ type: "text", text: "1: world" }]);
    expect(
      (
        await tool("bash").execute("test", {
          command: 'test -z "$OPENAI_API_KEY" && cat normal.txt',
        })
      ).content,
    ).toEqual([{ type: "text", text: "world" }]);
  });
});
