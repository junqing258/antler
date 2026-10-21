import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export function agentWorkspace(root: string, agentId: string) {
  const directory = resolve(
    root,
    "agents",
    `agent-${encodeURIComponent(agentId)}`,
  );
  mkdirSync(directory, { recursive: true });
  return directory;
}
