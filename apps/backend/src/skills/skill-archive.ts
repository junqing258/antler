import { parse as parseYaml } from "yaml";
import yauzl from "yauzl";
import { parseSkill } from "./skill-loader.js";
import { filesFingerprint } from "./directory-fingerprint.js";
import { PlatformError } from "../platform/errors.js";

export type ParsedSkillArchive = {
  name: string;
  description: string;
  disableModelInvocation: boolean;
  files: Map<string, Uint8Array>;
  fingerprint: string;
  fileCount: number;
  sizeBytes: number;
};

export async function parseSkillArchive(
  body: unknown,
): Promise<ParsedSkillArchive> {
  const { archive, name, description } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (
    typeof archive !== "string" ||
    !archive ||
    archive.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(archive) ||
    typeof name !== "string" ||
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ||
    name.length > 64
  )
    throw new PlatformError("skill_invalid", 422);
  const buffer = Buffer.from(archive, "base64");
  if (buffer.length > 5 * 1024 * 1024)
    throw new PlatformError("skill_too_large", 422);
  const files = new Map<string, Uint8Array>();
  try {
    await new Promise<void>((resolve, reject) => {
      yauzl.fromBuffer(
        buffer,
        { lazyEntries: true, strictFileNames: true },
        (error, zip) => {
          if (error || !zip) return reject(error);
          let count = 0,
            total = 0;
          const seen = new Set<string>();
          const fail = (error: unknown) => {
            zip.close();
            reject(error);
          };
          zip.on("error", fail);
          zip.on("end", resolve);
          zip.on("entry", (entry: yauzl.Entry) => {
            void (async () => {
              const path = entry.fileName;
              const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
              if (
                ++count > 200 ||
                entry.uncompressedSize > 1024 * 1024 ||
                (total += entry.uncompressedSize) > 20 * 1024 * 1024
              )
                throw new PlatformError("skill_too_large", 422);
              if (
                path.startsWith("/") ||
                path.includes("\\") ||
                path.includes("\0") ||
                /^[A-Za-z]:/.test(path) ||
                path
                  .replace(/\/$/, "")
                  .split("/")
                  .some((p) => !p || p === ".." || p === "." || p === "__MACOSX") ||
                kind === 0o120000 ||
                (kind && kind !== 0o100000 && kind !== 0o040000) ||
                entry.generalPurposeBitFlag & 65 ||
                seen.has(path)
              )
                throw new PlatformError("skill_invalid", 422);
              seen.add(path);
              if (!path.endsWith("/")) {
                const stream = await new Promise<NodeJS.ReadableStream>(
                  (accept, decline) =>
                    zip.openReadStream(entry, (err, stream) =>
                      err ? decline(err) : accept(stream!),
                    ),
                );
                const chunks: Buffer[] = [];
                let size = 0;
                for await (const chunk of stream) {
                  size += (chunk as Buffer).length;
                  if (size > 1024 * 1024)
                    throw new PlatformError("skill_too_large", 422);
                  chunks.push(chunk as Buffer);
                }
                files.set(path, Buffer.concat(chunks));
              }
              zip.readEntry();
            })().catch(fail);
          });
          zip.readEntry();
        },
      );
    });
    let prefix = "";
    if (!files.has("SKILL.md")) {
      const top = [...files.keys()][0]?.split("/")[0];
      if (
        !top ||
        ![...files.keys()].every((path) => path.startsWith(`${top}/`)) ||
        !files.has(`${top}/SKILL.md`)
      )
        throw new PlatformError("skill_invalid", 422);
      prefix = `${top}/`;
    }
    const stripped = new Map<string, Uint8Array>();
    for (const [path, data] of files)
      stripped.set(path.slice(prefix.length), data);
    // A file path that is also a directory prefix could never be materialized;
    // disk writes used to fail this via mkdir, so reject it up front.
    for (const path of stripped.keys())
      for (
        let slash = path.indexOf("/");
        slash > 0;
        slash = path.indexOf("/", slash + 1)
      )
        if (stripped.has(path.slice(0, slash)))
          throw new PlatformError("skill_invalid", 422);
    const raw = stripped.get("SKILL.md")!;
    if (raw.length > 64 * 1024) throw new PlatformError("skill_too_large", 422);
    // Uploads require an explicit frontmatter name; directory discovery retains its legacy fallback.
    const normalized = new TextDecoder().decode(raw).replace(/\r\n?/g, "\n");
    const end = normalized.startsWith("---\n")
      ? normalized.indexOf("\n---", 3)
      : -1;
    if (end < 0) throw new PlatformError("skill_invalid", 422);
    const metadata = parseYaml(normalized.slice(4, end)) as Record<
      string,
      unknown
    > | null;
    if (!metadata || metadata.name !== name)
      throw new PlatformError("skill_invalid", 422);
    const skill = parseSkill(new TextDecoder().decode(raw), name, "SKILL.md");
    if (description !== undefined && description !== skill.description)
      throw new PlatformError("skill_invalid", 422);
    return {
      name,
      description: skill.description,
      disableModelInvocation: skill.disableModelInvocation,
      files: stripped,
      ...filesFingerprint(stripped),
    };
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    if (error instanceof Error && error.message === "skill_too_large")
      throw new PlatformError("skill_too_large", 422);
    throw new PlatformError("skill_invalid", 422);
  }
}
