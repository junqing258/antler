import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
  formatSkillInvocation,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { LoadedSkill, SkillSnapshot } from "./types.js";
const MAX_RESOURCE_BYTES = 256 * 1024,
  MAX_OUTPUT = 32 * 1024;
const inside = (root: string, path: string) =>
  path === root || path.startsWith(`${root}${sep}`);
const result = (text: string, details: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text }],
  details,
});
async function entry(snapshot: SkillSnapshot, id: string) {
  const skill = snapshot.skills.find((item) => item.id === id);
  if (!skill) throw new Error("skill_not_found");
  const actual = await realpath(join(skill.directory, "SKILL.md"));
  if (!inside(skill.directory, actual)) throw new Error("skill_path_escape");
  const content = await readFile(actual, "utf8");
  if (
    skill.fingerprint !==
    `sha256:${(await import("node:crypto")).createHash("sha256").update(content).digest("hex")}`
  )
    throw new Error(
      "skill_snapshot_changed: Skill 文件已变更，请新建会话后重试。",
    );
  return skill;
}
export function createSkillTools(snapshot: SkillSnapshot): AgentTool[] {
  if (snapshot.policy.mode === "disabled") return [];
  const load: AgentTool = {
    name: "load_skill",
    label: "Load skill",
    description: "Load complete instructions for a visible skill.",
    parameters: Type.Object({ skillId: Type.String() }),
    async execute(_id, raw) {
      const args = raw as { skillId: string };
      const item = await entry(snapshot, args.skillId);
      const invocation = formatSkillInvocation({
        ...item.skill,
        filePath: item.modelUri,
      });
      return result(invocation, {
        skillId: item.id,
        scope: item.scope,
        fingerprint: item.fingerprint,
        sizeBytes: Buffer.byteLength(item.skill.content),
      });
    },
  };
  const resource: AgentTool = {
    name: "read_skill_resource",
    label: "Read skill resource",
    description: "Read a relative resource belonging to a loaded skill.",
    parameters: Type.Object({
      skillId: Type.String(),
      path: Type.String(),
      startLine: Type.Optional(Type.Number()),
      endLine: Type.Optional(Type.Number()),
    }),
    async execute(_id, raw) {
      const args = raw as {
        skillId: string;
        path: string;
        startLine?: number;
        endLine?: number;
      };
      const item = await entry(snapshot, args.skillId);
      if (
        !args.path.trim() ||
        isAbsolute(args.path) ||
        args.path.split(/[\\/]/).includes("..")
      )
        throw new Error("skill_path_escape");
      const candidate = resolve(item.directory, args.path);
      const actual = await realpath(candidate);
      if (!inside(item.directory, actual)) throw new Error("skill_path_escape");
      const info = await stat(actual);
      if (info.isDirectory())
        return result((await readdir(actual)).slice(0, 100).join("\n"), {
          skillId: item.id,
          directory: true,
        });
      if (!info.isFile()) throw new Error("skill_path_escape");
      if (info.size > MAX_RESOURCE_BYTES) throw new Error("skill_too_large");
      const lines = (await readFile(actual, "utf8")).split(/\r?\n/);
      const start = Math.max(1, args.startLine ?? 1),
        end = Math.max(start, args.endLine ?? lines.length);
      const text = lines.slice(start - 1, end).join("\n");
      return result(text.slice(0, MAX_OUTPUT), {
        skillId: item.id,
        sizeBytes: info.size,
      });
    },
  };
  return [load, resource];
}
