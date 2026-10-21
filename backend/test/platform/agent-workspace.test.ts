import {
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { agentWorkspace } from "../../src/platform/agent-workspace.js";

it("creates stable independent Agent directories without replacing existing files", () => {
  const root = mkdtempSync(join(tmpdir(), "antler-workspaces-"));
  try {
    const first = agentWorkspace(root, "first");
    const second = agentWorkspace(root, "../../second");
    expect(first).not.toBe(second);
    expect(statSync(first).isDirectory()).toBe(true);
    expect(statSync(second).isDirectory()).toBe(true);
    expect(relative(root, second).startsWith("..")).toBe(false);
    writeFileSync(join(first, "keep.txt"), "saved");
    expect(agentWorkspace(root, "first")).toBe(first);
    expect(readFileSync(join(first, "keep.txt"), "utf8")).toBe("saved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
