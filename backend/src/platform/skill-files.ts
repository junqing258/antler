import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { filesFingerprint } from "../skills/directory-fingerprint.js";
import {
  type Prisma,
  type PrismaClient,
} from "../generated/prisma/client.js";

const MAX_FILES = 200,
  MAX_FILE_BYTES = 1024 * 1024,
  MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/** Same path rules as uploaded archives; guards anything about to be written to disk. */
export function assertSafeEntryPath(path: string) {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((p) => p === ".." || p === "." || p === "__MACOSX" || !p)
  )
    throw new Error("skill_path_escape");
}

/** Materialize an in-memory file set into a fresh cache directory. */
export async function writeSkillDirectory(
  directory: string,
  files: ReadonlyMap<string, Uint8Array>,
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [path, data] of files) {
    assertSafeEntryPath(path);
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, data, { flag: "wx", mode: 0o600 });
  }
}

/** Load a skill's files from the database; every path is re-validated before it can reach disk. */
export async function readSkillFiles(
  prisma: PrismaClient,
  skillId: string,
): Promise<Map<string, Uint8Array>> {
  const rows = await prisma.skillFile.findMany({ where: { skillId } });
  const files = new Map<string, Uint8Array>();
  for (const row of rows) {
    assertSafeEntryPath(row.path);
    files.set(row.path, row.content);
  }
  return files;
}

/** Read a legacy on-disk skill directory (pre-skill_files layout) into memory. */
export async function readSkillDirectory(
  directory: string,
): Promise<Map<string, Uint8Array>> {
  const rootInfo = await lstat(directory);
  if (rootInfo.isSymbolicLink()) throw new Error("skill_path_escape");
  if (!rootInfo.isDirectory()) throw new Error("skill_invalid");
  const files = new Map<string, Uint8Array>();
  let entryCount = 0,
    sizeBytes = 0;
  async function visit(relative: string) {
    const names = await readdir(
      relative ? join(directory, relative) : directory,
    ).then((names) => names.sort());
    for (const name of names) {
      if (++entryCount > MAX_FILES) throw new Error("skill_too_large");
      const child = relative ? `${relative}/${name}` : name;
      assertSafeEntryPath(child);
      const info = await lstat(join(directory, child));
      if (info.isSymbolicLink()) throw new Error("skill_path_escape");
      if (info.isDirectory()) await visit(child);
      else if (info.isFile()) {
        if (info.size > MAX_FILE_BYTES) throw new Error("skill_too_large");
        sizeBytes += info.size;
        if (sizeBytes > MAX_TOTAL_BYTES) throw new Error("skill_too_large");
        files.set(child, await readFile(join(directory, child)));
      } else throw new Error("skill_invalid");
    }
  }
  await visit("");
  return files;
}

/** Replace a skill's file rows inside the caller's transaction. */
export async function persistSkillFiles(
  tx: Pick<
    Prisma.TransactionClient["skillFile"],
    "deleteMany" | "createMany"
  >,
  skillId: string,
  files: ReadonlyMap<string, Uint8Array>,
) {
  for (const path of files.keys()) assertSafeEntryPath(path);
  await tx.deleteMany({ where: { skillId } });
  if (files.size)
    await tx.createMany({
      // Node buffers are ArrayBuffer-backed at runtime; the cast satisfies Prisma's Bytes input type.
      data: [...files].map(([path, content]) => ({
        skillId,
        path,
        content: content as Uint8Array<ArrayBuffer>,
      })),
    });
}

/**
 * One-time backfill from the legacy on-disk layout into skill_files, run at
 * startup where recover() used to be. Per-skill transactions keep one bad row
 * from blocking the rest; unmigratable skills are marked broken for re-upload.
 */
export async function migrateFileSkills(prisma: PrismaClient, root: string) {
  for (const name of [".staging", ".orphaned", ".lock", ".tmp"])
    await rm(join(root, name), { recursive: true, force: true }).catch(
      () => {},
    );
  const rows = await prisma.skill.findMany();
  for (const row of rows) {
    if (await prisma.skillFile.count({ where: { skillId: row.id } })) continue;
    try {
      const files = await readSkillDirectory(join(root, "skills", row.id));
      if (filesFingerprint(files).fingerprint !== row.fingerprint)
        throw new Error(`fingerprint mismatch for skill ${row.id}`);
      await prisma.$transaction((tx) =>
        persistSkillFiles(tx.skillFile, row.id, files),
      );
    } catch (error) {
      console.warn(
        `[Platform] skill ${row.id} could not be migrated from disk; re-upload to repair`,
        error,
      );
      await prisma.skill.update({
        where: { id: row.id },
        data: { state: "broken" },
      });
    }
  }
}
