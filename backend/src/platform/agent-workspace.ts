import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { BUILTIN_AGENTS } from "./builtin-agents.js";

export function agentWorkspace(root: string, agentId: string) {
  // The stock analyst runs the deployed seed project, rather than an empty
  // per-agent directory. Explicit workspace overrides are resolved by callers.
  if (agentId === BUILTIN_AGENTS[1].id) {
    const project = resolve(root, "Stock-Analysis");
    const skill = resolve(project, ".agents/skills/stock-analysis");
    if (
      ["SKILL.md", "pyproject.toml"].every((name) =>
        statSync(resolve(skill, name), { throwIfNoEntry: false })?.isFile(),
      )
    ) return project;
  }
  const directory = resolve(
    root,
    "agents",
    `agent-${encodeURIComponent(agentId)}`,
  );
  mkdirSync(directory, { recursive: true });
  return directory;
}
