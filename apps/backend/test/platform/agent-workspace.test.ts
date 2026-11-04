import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { agentWorkspace } from "../../src/platform/agent-workspace.js";
import { BUILTIN_AGENTS } from "../../src/platform/builtin-agents.js";

it("uses the existing stock project only when its skill project is complete", () => {
  const root = mkdtempSync(join(tmpdir(), "antler-stock-workspace-"));
  try {
    const stockId = BUILTIN_AGENTS[1].id;
    const fallback = agentWorkspace(root, stockId);
    writeFileSync(join(fallback, "keep.txt"), "saved");
    const project = join(root, "Stock-Analysis");
    const skill = join(project, ".agents/skills/stock-analysis");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "Stock instructions");
    expect(agentWorkspace(root, stockId)).toBe(fallback);
    writeFileSync(join(skill, "pyproject.toml"), "[project]");
    mkdirSync(join(project, "reports"));
    writeFileSync(join(project, "reports/existing.md"), "report");

    expect(agentWorkspace(root, stockId)).toBe(project);
    expect(agentWorkspace(root, stockId)).toBe(project);
    expect(agentWorkspace(root, BUILTIN_AGENTS[0].id)).not.toBe(project);
    expect(agentWorkspace(root, "custom-analyst")).not.toBe(project);
    expect(readFileSync(join(project, "reports/existing.md"), "utf8")).toBe("report");
    expect(readFileSync(join(fallback, "keep.txt"), "utf8")).toBe("saved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
