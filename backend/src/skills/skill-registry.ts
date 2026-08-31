import { createHash } from "node:crypto";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  FileError,
  err,
  loadSourcedSkills,
  ok,
  type ExecutionEnv,
  type FileInfo,
} from "@earendil-works/pi-agent-core";
import type { LoadedSkill, SkillDiagnostic, SkillScope } from "./types.js";

const MAX_SKILLS = 100,
  MAX_SKILL_BYTES = 64 * 1024;
const contained = (root: string, path: string) =>
  path === root || path.startsWith(`${root}${sep}`);
const digest = (text: string) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
const failure = (path: string, error: unknown) =>
  err(
    new FileError(
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "not_found"
        : "unknown",
      "Skill file operation failed.",
      path,
    ),
  );

class RestrictedSkillExecutionEnv {
  constructor(
    readonly cwd: string,
    private readonly roots: string[],
  ) {}
  private async path(path: string) {
    const actual = await realpath(path);
    if (!this.roots.some((root) => contained(root, actual)))
      throw new Error("outside skill roots");
    return actual;
  }
  async absolutePath(path: string) {
    try {
      return ok(resolve(this.cwd, path));
    } catch (e) {
      return failure(path, e);
    }
  }
  async joinPath(parts: string[]) {
    return this.absolutePath(join(...parts));
  }
  async fileInfo(path: string) {
    try {
      const info = await lstat(path);
      return ok({
        name: basename(path),
        path: resolve(path),
        kind: info.isSymbolicLink()
          ? "symlink"
          : info.isDirectory()
            ? "directory"
            : "file",
        size: info.size,
        mtimeMs: info.mtimeMs,
      } satisfies FileInfo);
    } catch (e) {
      return failure(path, e);
    }
  }
  async listDir(path: string) {
    try {
      return ok(
        await Promise.all(
          (await readdir(path)).map(async (name) =>
            (await this.fileInfo(join(path, name))).ok
              ? ((await this.fileInfo(join(path, name))) as any).value
              : undefined,
          ),
        ).then((xs) => xs.filter(Boolean) as FileInfo[]),
      );
    } catch (e) {
      return failure(path, e);
    }
  }
  async canonicalPath(path: string) {
    try {
      return ok(await this.path(path));
    } catch (e) {
      return failure(path, e);
    }
  }
  async readTextFile(path: string) {
    try {
      const actual = await this.path(path);
      const info = await stat(actual);
      if (!info.isFile() || info.size > MAX_SKILL_BYTES)
        throw new Error("invalid skill file");
      return ok(
        await (await import("node:fs/promises")).readFile(actual, "utf8"),
      );
    } catch (e) {
      return failure(path, e);
    }
  }
  async readTextLines(path: string, options?: { maxLines?: number }) {
    const r: any = await this.readTextFile(path);
    return r.ok
      ? ok((r.value as string).split(/\r?\n/).slice(0, options?.maxLines))
      : r;
  }
  async readBinaryFile(path: string) {
    const r: any = await this.readTextFile(path);
    return r.ok ? ok(new TextEncoder().encode(r.value as string)) : r;
  }
  async exists(path: string) {
    const r: any = await this.fileInfo(path);
    return r.ok ? ok(true) : r.error.code === "not_found" ? ok(false) : r;
  }
  async writeFile(path: string) {
    return err(
      new FileError("not_supported", "Skill environment is read-only.", path),
    );
  }
  async appendFile(path: string) {
    return err(
      new FileError("not_supported", "Skill environment is read-only.", path),
    );
  }
  async renameFile(path: string) {
    return err(
      new FileError("not_supported", "Skill environment is read-only.", path),
    );
  }
  async createDir(path: string) {
    return err(
      new FileError("not_supported", "Skill environment is read-only.", path),
    );
  }
  async remove(path: string) {
    return err(
      new FileError("not_supported", "Skill environment is read-only.", path),
    );
  }
  async createTempDir() {
    return err(
      new FileError("not_supported", "Skill environment is read-only."),
    );
  }
  async createTempFile() {
    return err(
      new FileError("not_supported", "Skill environment is read-only."),
    );
  }
  async cleanup() {}
  async exec() {
    return err({
      code: "shell_unavailable",
      message: "Skill environment has no shell.",
    } as any);
  }
}

export class SkillRegistry {
  constructor(
    private readonly agentsDir = process.env.ANTLER_AGENTS_DIR ??
      join(homedir(), ".agents"),
  ) {}
  async list(workspaceRoot?: string) {
    const roots: Array<{ scope: SkillScope; root: string }> = [
      { scope: "user", root: join(this.agentsDir, "skills") },
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
    const env = new RestrictedSkillExecutionEnv(
      workspaceRoot ?? this.agentsDir,
      realRoots.map((x) => x.root),
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
      const result = await loadSourcedSkills(
        env as unknown as ExecutionEnv,
        dirs.filter(Boolean).map((path) => ({ path: path!, source })),
      );
      for (const item of result.skills) {
        const dir = resolve(item.skill.filePath, "..");
        if (
          basename(item.skill.filePath) !== "SKILL.md" ||
          !dirs.includes(dir) ||
          item.skill.disableModelInvocation
        )
          continue;
        const invalid = result.diagnostics.some(
          (d) =>
            d.path === item.skill.filePath && d.code === "invalid_metadata",
        );
        if (invalid) {
          diagnostics.push({
            code: "skill_invalid",
            scope: source.scope,
            message: "Skill 元数据无效。",
          });
          continue;
        }
        if (Buffer.byteLength(item.skill.content) > MAX_SKILL_BYTES) {
          diagnostics.push({
            code: "skill_too_large",
            name: item.skill.name,
            scope: source.scope,
            message: "SKILL.md 超过大小限制。",
          });
          continue;
        }
        all.push({
          id: item.skill.name,
          skill: item.skill,
          scope: source.scope,
          directory: await realpath(dir),
          modelUri: `skill://${item.skill.name}/SKILL.md`,
          fingerprint: digest(item.skill.content),
        });
      }
      for (const diagnostic of result.diagnostics)
        if (diagnostic.code !== "invalid_metadata")
          diagnostics.push({
            code: "skill_invalid",
            scope: source.scope,
            message: "Skill 无法解析。",
          });
    }
    const byId = new Map<string, LoadedSkill>();
    // Sources are scanned workspace first, then user; first writer is active.
    for (const skill of all) {
      const old = byId.get(skill.id);
      if (old)
        diagnostics.push({
          code: "skill_shadowed",
          name: skill.id,
          scope: skill.scope,
          message: "同名 Skill 已被工作区版本覆盖。",
        });
      else byId.set(skill.id, skill);
    }
    return {
      skills: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
      diagnostics,
    };
  }
}
