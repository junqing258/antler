import { createHash } from "node:crypto";
import { lstat, readdir, open } from "node:fs/promises";
import { join } from "node:path";

function finalize(
  entries: [string, string][],
  fileCount: number,
  sizeBytes: number,
) {
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(entries)).digest("hex")}`,
    fileCount,
    sizeBytes,
  };
}

/** Byte-identical to directoryFingerprint over the same files; enforces the same size limits. */
export function filesFingerprint(files: ReadonlyMap<string, Uint8Array>) {
  if (files.size > 200) throw new Error("skill_too_large");
  const entries: [string, string][] = [];
  const paths = new Set<string>();
  let sizeBytes = 0;
  for (const [path, data] of files) {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++)
      paths.add(parts.slice(0, i).join("/"));
    if (paths.size > 200) throw new Error("skill_too_large");
    if (data.length > 1024 * 1024) throw new Error("skill_too_large");
    sizeBytes += data.length;
    if (sizeBytes > 20 * 1024 * 1024) throw new Error("skill_too_large");
    entries.push([path, createHash("sha256").update(data).digest("hex")]);
  }
  return finalize(entries, files.size, sizeBytes);
}

/** All regular files, including ignored resources; empty directories do not affect the digest. */
export async function directoryFingerprint(directory: string) {
  const entries: [string, string][] = [];
  let fileCount = 0,
    sizeBytes = 0,
    entryCount = 0;
  async function visit(relative: string) {
    const path = join(directory, relative);
    const info = await lstat(path);
    if (relative && ++entryCount > 200) throw new Error("skill_too_large");
    if (info.isSymbolicLink()) throw new Error("skill_path_escape");
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort())
        await visit(relative ? `${relative}/${name}` : name);
    } else if (info.isFile()) {
      if (info.size > 1024 * 1024) throw new Error("skill_too_large");
      // Bound reads independently of stat in case bash changes a file concurrently.
      const file = await open(path, "r");
      let data: Buffer;
      try {
        const buffer = Buffer.alloc(1024 * 1024 + 1);
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
        if (length > 1024 * 1024) throw new Error("skill_too_large");
        data = buffer.subarray(0, length);
      } finally {
        await file.close();
      }
      fileCount++;
      sizeBytes += data.length;
      if (sizeBytes > 20 * 1024 * 1024) throw new Error("skill_too_large");
      entries.push([relative, createHash("sha256").update(data).digest("hex")]);
    } else throw new Error("skill_invalid");
  }
  await visit("");
  return finalize(entries, fileCount, sizeBytes);
}
