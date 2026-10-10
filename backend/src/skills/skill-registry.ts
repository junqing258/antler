import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, join, sep } from "node:path";
import ignore from "ignore";
import { parseSkill, SkillMetadataError } from "./skill-loader.js";
import { assertSafeFilePath } from "../agent/secret-guard.js";
import type { LoadedSkill, SkillDiagnostic, SkillScope } from "./types.js";

const MAX_SKILLS = 100,
  MAX_SKILL_BYTES = 64 * 1024;
const contained = (root: string, path: string) =>
  path === root || path.startsWith(`${root}${sep}`);
const digest = (text: string) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
class SkillFileTooLargeError extends Error {}

async function readSkillFile(path: string, directory: string): Promise<string> {
  assertSafeFilePath(path);
  const actual = await realpath(path);
  assertSafeFilePath(actual);
  if (!contained(directory, actual)) throw new Error("skill_path_escape");
  const file = await open(actual, "r");
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("skill_path_escape");
    if (info.size > MAX_SKILL_BYTES) throw new SkillFileTooLargeError();
    // Bound the read even if the file grows after stat; hash exactly what was parsed.
    const buffer = Buffer.alloc(MAX_SKILL_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_SKILL_BYTES) throw new SkillFileTooLargeError();
    return buffer.subarray(0, length).toString("utf8");
  } finally {
    await file.close();
  }
}

export class SkillRegistry {
  constructor(
    private readonly agentsDir = process.env.ANTLER_AGENTS_DIR ??
      join(homedir(), ".agents"),
    private readonly bundledSkillsDir = fileURLToPath(
      new URL("../../skills/", import.meta.url),
    ),
  ) {}
  async list(workspaceRoot?: string) {
    const roots: Array<{ scope: SkillScope; root: string }> = [
      { scope: "user", root: join(this.agentsDir, "skills") },
      { scope: "bundled", root: this.bundledSkillsDir },
    ];
    if (workspaceRoot)
      roots.unshift({
        scope: "workspace",
        root: join(workspaceRoot, ".agents", "skills"),
      });
    const realRoots = await Promise.all(
      roots.map(async (item) => ({
        ...item,
        root: await realpath(item.root).catch(() => item.root),
      })),
    );
    const diagnostics: SkillDiagnostic[] = [];
    const all: LoadedSkill[] = [];
    for (const source of realRoots) {
      let entries: string[] = [];
      try {
        entries = await readdir(source.root);
      } catch {
        continue;
      }
      if (entries.length > MAX_SKILLS) {
        diagnostics.push({
          code: "skill_invalid",
          scope: source.scope,
          message: "Skill 数量超过限制。",
        });
        entries = entries.slice(0, MAX_SKILLS);
      }
      const dirs = await Promise.all(
        entries.map(async (name) => {
          const path = join(source.root, name);
          try {
            return (await lstat(path)).isDirectory() ? path : undefined;
          } catch {
            return undefined;
          }
        }),
      );
      for (const directory of dirs) {
        if (!directory) continue;
        try {
          const actualDirectory = await realpath(directory);
          if (!contained(source.root, actualDirectory))
            throw new Error("skill_path_escape");
          const filePath = join(directory, "SKILL.md");
          // Missing SKILL.md and explicitly ignored skills are not candidates.
          try {
            await lstat(filePath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw error;
          }
          const matcher = ignore();
          for (const name of [".gitignore", ".ignore", ".fdignore"]) {
            const ignorePath = join(directory, name);
            try {
              // The previous loader only read regular ignore files.
              if (!(await lstat(ignorePath)).isFile()) continue;
              matcher.add(await readSkillFile(ignorePath, actualDirectory));
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                diagnostics.push({
                  code: "skill_invalid",
                  scope: source.scope,
                  message: "Skill 忽略规则无法读取。",
                });
              }
            }
          }
          if (matcher.ignores("SKILL.md")) continue;
          const raw = await readSkillFile(filePath, actualDirectory);
          const skill = parseSkill(raw, basename(directory), filePath);
          if (skill.disableModelInvocation) continue;
          all.push({
            id: skill.name,
            skill,
            scope: source.scope,
            directory: actualDirectory,
            modelUri: `skill://${skill.name}/SKILL.md`,
            fingerprint: digest(raw),
          });
        } catch (error) {
          diagnostics.push({
            code:
              error instanceof SkillFileTooLargeError
                ? "skill_too_large"
                : "skill_invalid",
            scope: source.scope,
            message:
              error instanceof SkillFileTooLargeError
                ? "Skill 文件超过大小限制。"
                : error instanceof SkillMetadataError
                  ? "Skill 元数据无效。"
                  : "Skill 无法解析。",
          });
        }
      }
    }
    const byId = new Map<string, LoadedSkill>();
    // Workspace and user skills override bundled defaults; first writer is active.
    for (const skill of all) {
      const old = byId.get(skill.id);
      if (old)
        diagnostics.push({
          code: "skill_shadowed",
          name: skill.id,
          scope: skill.scope,
          message: "同名 Skill 已被更高优先级的版本覆盖。",
        });
      else byId.set(skill.id, skill);
    }
    return {
      skills: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
      diagnostics,
    };
  }
}
