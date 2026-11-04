import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  writeFile,
  rename,
  rm,
  mkdir,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  directoryFingerprint,
  filesFingerprint,
} from "../../src/skills/directory-fingerprint.js";
let root: string;
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("directory integrity fingerprint", () => {
  it("uses sorted path/raw-byte SHA256 pairs and detects additions, deletion, rename and resource-only edits", async () => {
    root = await mkdtemp(join(tmpdir(), "antler-fingerprint-"));
    await writeFile(join(root, "z.txt"), "z");
    await writeFile(join(root, "SKILL.md"), "instructions");
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    const expected = `sha256:${sha(
      JSON.stringify([
        ["SKILL.md", sha("instructions")],
        ["z.txt", sha("z")],
      ]),
    )}`;
    expect((await directoryFingerprint(root)).fingerprint).toBe(expected);
    await mkdir(join(root, "empty"));
    expect((await directoryFingerprint(root)).fingerprint).toBe(expected);
    await writeFile(join(root, "z.txt"), "changed");
    const edited = (await directoryFingerprint(root)).fingerprint;
    expect(edited).not.toBe(expected);
    await rename(join(root, "z.txt"), join(root, "other.txt"));
    const renamed = (await directoryFingerprint(root)).fingerprint;
    expect(renamed).not.toBe(edited);
    await writeFile(join(root, "new.txt"), "new");
    const added = (await directoryFingerprint(root)).fingerprint;
    expect(added).not.toBe(renamed);
    await rm(join(root, "other.txt"));
    expect((await directoryFingerprint(root)).fingerprint).not.toBe(added);
    await symlink(join(root, "SKILL.md"), join(root, "link"));
    await expect(directoryFingerprint(root)).rejects.toThrow(
      "skill_path_escape",
    );
  });
  it("filesFingerprint is byte-identical to directoryFingerprint over the same files", async () => {
    root = await mkdtemp(join(tmpdir(), "antler-fingerprint-"));
    const files = new Map<string, Uint8Array>([
      ["SKILL.md", Buffer.from("instructions")],
      ["data.txt", Buffer.from("resource")],
      ["nested/dir/file.txt", Buffer.from("nested")],
      ["empty-dir-keeps-only-file-sibling", Buffer.from([0, 1, 255])],
    ]);
    await mkdir(join(root, "nested", "dir"), { recursive: true });
    await mkdir(join(root, "empty"));
    for (const [path, data] of files)
      await writeFile(join(root, path), data);
    const fromDirectory = await directoryFingerprint(root);
    expect(filesFingerprint(files)).toEqual(fromDirectory);
  });
  it("counts implicit directories exactly as the materialized directory walk", async () => {
    root = await mkdtemp(join(tmpdir(), "antler-fingerprint-"));
    const files = new Map<string, Uint8Array>(Array.from(
      { length: 100 }, (_, i) => [`dir${i}/file`, Buffer.from("x")],
    ));
    for (const [path, data] of files) {
      await mkdir(join(root, path.split("/")[0]!));
      await writeFile(join(root, path), data);
    }
    expect(filesFingerprint(files)).toEqual(await directoryFingerprint(root));
    files.set("SKILL.md", Buffer.from("instructions"));
    await writeFile(join(root, "SKILL.md"), "instructions");
    expect(() => filesFingerprint(files)).toThrow("skill_too_large");
    await expect(directoryFingerprint(root)).rejects.toThrow("skill_too_large");
  });
  it("enforces the same size limits as the directory walk", () => {
    const many = new Map(
      Array.from({ length: 201 }, (_, i) => [`f${i}`, Buffer.from("x")]),
    );
    expect(() => filesFingerprint(many)).toThrow("skill_too_large");
    expect(() =>
      filesFingerprint(
        new Map([["big", Buffer.alloc(1024 * 1024 + 1)]]),
      ),
    ).toThrow("skill_too_large");
  });
});
