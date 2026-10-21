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
import { directoryFingerprint } from "../../src/skills/directory-fingerprint.js";
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
});
