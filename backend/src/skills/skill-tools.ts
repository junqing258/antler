import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { formatSkillInvocation } from "./skill-loader.js";
import { Type } from "typebox";
import type { LoadedSkill, SkillSnapshot } from "./types.js";
import { assertSafeFilePath, SecretGuard } from "../agent/secret-guard.js";
import { createWorkspaceTools } from "../agent/workspace-tools.js";
import { prepareSkillRuntime } from "./skill-runtime.js";
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
  assertSafeFilePath(actual);
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
export function createSkillTools(
  snapshot: SkillSnapshot,
  guard = new SecretGuard(snapshot.workspaceRoot),
): AgentTool[] {
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
      return result(`${invocation}\n\nExecute this skill with run_skill (skillId: ${JSON.stringify(item.id)}). The tool prepares its resources and injects ANTLER_SKILL_DIR and ANTLER_WORKSPACE_DIR. Use quoted paths such as python3 "$ANTLER_SKILL_DIR/scripts/example.py" or uv run --project "$ANTLER_SKILL_DIR" "$ANTLER_SKILL_DIR/references/example.py". Commands start in the workspace; write reports there. Do not search the host filesystem or treat skill:// as a filesystem path. Replace hardcoded skill project paths from the instructions with "$ANTLER_SKILL_DIR".`, {
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
      assertSafeFilePath(candidate);
      const actual = await realpath(candidate);
      assertSafeFilePath(actual);
      if (!inside(item.directory, actual)) throw new Error("skill_path_escape");
      const info = await stat(actual);
      if (info.isDirectory())
        return result((await readdir(actual)).slice(0, 100).join("\n"), {
          skillId: item.id,
          directory: true,
        });
      if (!info.isFile()) throw new Error("skill_path_escape");
      if (info.size > MAX_RESOURCE_BYTES) throw new Error("skill_too_large");
      const lines = guard.redact(await readFile(actual, "utf8")).split(/\r?\n/);
      const start = Math.max(1, args.startLine ?? 1),
        end = Math.max(start, args.endLine ?? lines.length);
      const text = lines.slice(start - 1, end).join("\n");
      return result(text.slice(0, MAX_OUTPUT), {
        skillId: item.id,
        sizeBytes: info.size,
      });
    },
  };
  const run: AgentTool = {
    name: "run_skill",
    label: "Run skill command",
    description: "Run a command for a visible skill using a versioned workspace copy of its resources. ANTLER_SKILL_DIR is its absolute resource/project directory; ANTLER_WORKSPACE_DIR is the workspace. Quote these variables. Every command starts in the workspace; cd does not persist. Dependencies persist per workspace and skill version. Use this instead of bash for skill scripts or dependency installation. Uses the same credential restrictions as bash; this is not an OS sandbox.",
    parameters: Type.Object({
      skillId: Type.String(),
      command: Type.String({ minLength: 1, maxLength: 8_000 }),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 60_000 })),
    }),
    async execute(id, raw, signal, onUpdate) {
      const args = raw as { skillId: string; command: string; timeoutMs?: number };
      const item = await entry(snapshot, args.skillId);
      const runtime = await prepareSkillRuntime(snapshot.workspaceRoot, item, signal)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Skill preparation failed.";
          throw new Error(message.replaceAll(item.directory, item.modelUri.replace(/\/SKILL\.md$/, "")));
        });
      const executionGuard = new SecretGuard(runtime.workspace, () => ({
        ...guard.toolEnvironment(),
        ANTLER_SKILL_DIR: runtime.directory,
        ANTLER_WORKSPACE_DIR: runtime.workspace,
      }));
      executionGuard.inheritSecrets(guard);
      const bash = createWorkspaceTools(runtime.workspace, undefined, executionGuard)
        .find((tool) => tool.name === "bash")!;
      const output = await bash.execute(
        id,
        { command: args.command, timeoutMs: args.timeoutMs },
        signal,
        onUpdate,
      );
      return {
        ...output,
        details: { skillId: item.id, scope: item.scope, fingerprint: item.fingerprint },
      };
    },
  };
  return [load, resource, run].map((tool): AgentTool => ({
    ...tool,
    async execute(id, args, signal, onUpdate) {
      try {
        await guard.refresh();
        return guard.sanitize(await tool.execute(id, args, signal, onUpdate));
      } catch (error) {
        throw new Error(
          guard.redact(
            error instanceof Error ? error.message : "Skill execution failed.",
          ),
        );
      }
    },
  }));
}
