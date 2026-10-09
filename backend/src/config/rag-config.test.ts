import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RagConfigStore } from "./rag-config.js";
import { createWorkspaceTools } from "../agent/workspace-tools.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("effective RAG configuration", () => {
  it("injects saved settings into existing bash tools and keeps the parent environment unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-rag-config-"));
    roots.push(root);
    vi.stubEnv("ANTLER_RAG_URL", "https://inherited.example.com");
    vi.stubEnv("ANTLER_RAG_KEY", "inherited-key");
    const defaults = {
      ragUrl: "https://default.example.com",
      ragKey: "default-key",
    };
    const config = new RagConfigStore(defaults, root);
    const bash = createWorkspaceTools(root, () => config.environment()).find(
      (tool) => tool.name === "bash",
    )!;
    const run = async () => {
      const result = await bash.execute("test", {
        command: 'printf "%s\\n%s" "$ANTLER_RAG_URL" "$ANTLER_RAG_KEY"',
      });
      return result.content;
    };
    expect(await run()).toEqual([
      { type: "text", text: "https://default.example.com\n[REDACTED]" },
    ]);
    config.update({
      ragUrl: "https://custom.example.com/",
      ragKey: "custom-key",
    });
    expect(await run()).toEqual([
      { type: "text", text: "https://custom.example.com\n[REDACTED]" },
    ]);
    config.update({ ragUrl: "http://localhost:8001" });
    expect(new RagConfigStore(defaults, root).environment()).toEqual({
      ANTLER_RAG_URL: "http://localhost:8001",
      ANTLER_RAG_KEY: "custom-key",
    });
    const path = join(root, ".antler", "rag-config.json");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      ragUrl: "http://localhost:8001",
      ragKey: "custom-key",
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    config.update({ ragUrl: "", ragKey: "" });
    expect(config.environment()).toEqual({
      ANTLER_RAG_URL: "",
      ANTLER_RAG_KEY: "",
    });
    expect(await run()).toEqual([{ type: "text", text: "\n" }]);
    config.reset();
    expect(await run()).toEqual([
      { type: "text", text: "https://default.example.com\n[REDACTED]" },
    ]);
    expect(process.env.ANTLER_RAG_URL).toBe("https://inherited.example.com");
    expect(process.env.ANTLER_RAG_KEY).toBe("inherited-key");
  });
});
