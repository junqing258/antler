import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { assertSafeFilePath } from "../agent/secret-guard.js";
import { filesFingerprint } from "./directory-fingerprint.js";
import type { LoadedSkill } from "./types.js";

const generatedDirectories = new Set([
  ".git",
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
]);
const inside = (root: string, path: string) =>
  path === root || path.startsWith(`${root}${sep}`);

async function boundedRead(path: string, maximum: number) {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}

/** Copy bounded, regular resources, never credentials, symlinks or local dependencies. */
async function sourceFiles(skill: LoadedSkill, signal?: AbortSignal) {
  const files = new Map<string, Uint8Array>();
  let count = 0,
    bytes = 0;
  async function visit(path: string) {
    signal?.throwIfAborted();
    const absolute = join(skill.directory, path);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error("skill_path_escape");
    if (info.isDirectory()) {
      for (const name of await readdir(absolute)) {
        if (generatedDirectories.has(name)) continue;
        try {
          assertSafeFilePath(name);
        } catch {
          continue;
        }
        if (++count > 200) throw new Error("skill_too_large");
        await visit(path ? `${path}/${name}` : name);
      }
    } else if (info.isFile()) {
      const data = await boundedRead(absolute, 1024 * 1024);
      bytes += data.length;
      if (data.length > 1024 * 1024 || bytes > 20 * 1024 * 1024)
        throw new Error("skill_too_large");
      files.set(path, data);
    } else {
      throw new Error("skill_path_escape");
    }
  }
  await visit("");
  const fingerprint = filesFingerprint(files).fingerprint;
  if (skill.directoryFingerprint && fingerprint !== skill.directoryFingerprint)
    throw new Error("skill_snapshot_changed: Skill resources changed; start a new conversation.");
  const instructions = files.get("SKILL.md");
  if (
    !instructions ||
    `sha256:${createHash("sha256").update(instructions).digest("hex")}` !== skill.fingerprint
  )
    throw new Error("skill_snapshot_changed: Skill instructions changed; start a new conversation.");
  return { files, fingerprint };
}

/** Each workspace/version owns dependencies; the platform's source cache stays untouched. */
export async function prepareSkillRuntime(
  workspaceRoot: string,
  skill: LoadedSkill,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!workspaceRoot) throw new Error("skill_workspace_required");
  const workspace = await realpath(resolve(workspaceRoot));
  const { files, fingerprint } = await sourceFiles(skill, signal);
  const version = createHash("sha256")
    .update(`${skill.id}\n${fingerprint}`)
    .digest("hex");
  let parent = workspace;
  for (const part of [".antler", "skill-runtimes"]) {
    parent = join(parent, part);
    await mkdir(parent, { recursive: true });
    if (await realpath(parent) !== parent || !inside(workspace, parent))
      throw new Error("skill_path_escape");
  }
  const target = join(parent, version);
  const exists = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (!exists) {
    const staging = join(parent, `.tmp-${randomUUID()}`);
    try {
      await mkdir(staging);
      for (const [path, content] of files) {
        signal?.throwIfAborted();
        const file = join(staging, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, content, { mode: 0o700 });
      }
      try {
        await rename(staging, target);
      } catch (error) {
        // Another invocation may have finished preparing this same version.
        if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? ""))
          throw error;
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  if (await realpath(target) !== target) throw new Error("skill_path_escape");
  // Runtime copies are writable (installers may update lockfiles/manifests).
  // They must never redirect packaged files outside this workspace.
  for (const path of files.keys()) {
    signal?.throwIfAborted();
    const file = join(target, path);
    if (await realpath(file) !== file) throw new Error("skill_path_escape");
    if (!(await lstat(file)).isFile()) throw new Error("skill_path_escape");
  }
  return { directory: target, workspace };
}
