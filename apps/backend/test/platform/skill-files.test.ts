import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { schedulerDatabase } from "../scheduler/helpers.js";
import {
  assertSafeEntryPath,
  migrateFileSkills,
  readSkillDirectory,
  readSkillFiles,
  writeSkillDirectory,
} from "../../src/platform/skill-files.js";
import { filesFingerprint } from "../../src/skills/directory-fingerprint.js";
import { instruction } from "./helpers.js";

let db: Awaited<ReturnType<typeof schedulerDatabase>>;
let root: string;
beforeAll(async () => {
  db = await schedulerDatabase();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await db.skill.deleteMany();
  root = await mkdtemp(join(tmpdir(), "antler-skill-files-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A pre-skill_files database row plus, unless suppressed, its on-disk directory. */
async function createLegacySkill(
  files: Map<string, Uint8Array>,
  options: { write?: boolean; tamper?: boolean } = {},
) {
  const id = randomUUID(),
    summary = filesFingerprint(files);
  await db.skill.create({
    data: {
      id,
      name: `legacy-${id.slice(0, 8)}`,
      description: "legacy",
      directory: `skills/${id}`,
      fileCount: summary.fileCount,
      sizeBytes: summary.sizeBytes,
      fingerprint: summary.fingerprint,
    },
  });
  if (options.write !== false)
    await writeSkillDirectory(
      join(root, "skills", id),
      options.tamper
        ? new Map([...files, ["SKILL.md", Buffer.from("tampered")]])
        : files,
    );
  return id;
}

describe("skill file storage", () => {
  it("round-trips file maps through writeSkillDirectory and readSkillDirectory", async () => {
    const files = new Map<string, Uint8Array>([
      ["SKILL.md", Buffer.from(instruction())],
      ["data.txt", Buffer.from("resource")],
      ["nested/dir/file.txt", Buffer.from("nested")],
    ]);
    const directory = join(root, "skills", "roundtrip");
    await writeSkillDirectory(directory, files);
    expect(await readSkillDirectory(directory)).toEqual(files);
  });
  it("rejects unsafe entry paths before they can reach disk", () => {
    for (const path of [
      "../escape",
      "/absolute",
      "a\\b",
      "C:/x",
      "a/./b",
      "a//b",
      "__MACOSX/x",
      "a\0b",
    ])
      expect(() => assertSafeEntryPath(path)).toThrow("skill_path_escape");
    expect(() => assertSafeEntryPath("a/b/c.txt")).not.toThrow();
  });
  it("re-validates every path read back from the database", async () => {
    const id = await createLegacySkill(
      new Map([["SKILL.md", Buffer.from(instruction())]]),
    );
    await db.skillFile.create({
      data: { skillId: id, path: "../escape", content: Buffer.from("x") },
    });
    await expect(readSkillFiles(db, id)).rejects.toThrow("skill_path_escape");
  });
  it("backfills legacy on-disk skills, stays idempotent and cleans legacy directories", async () => {
    const id = await createLegacySkill(
      new Map([
        ["SKILL.md", Buffer.from(instruction())],
        ["data.txt", Buffer.from("original resource")],
      ]),
    );
    for (const name of [".staging", ".orphaned", ".tmp"])
      await mkdir(join(root, name));
    await writeFile(join(root, ".lock"), "legacy");
    await migrateFileSkills(db, root);
    expect(await db.skillFile.count({ where: { skillId: id } })).toBe(2);
    expect(
      Buffer.from((await readSkillFiles(db, id)).get("data.txt")!).toString(),
    ).toBe("original resource");
    expect(
      (await db.skill.findUniqueOrThrow({ where: { id } })).state,
    ).toBe("ready");
    // Second run is a no-op for already-backfilled skills.
    await migrateFileSkills(db, root);
    expect(await db.skillFile.count({ where: { skillId: id } })).toBe(2);
    for (const name of [".staging", ".orphaned", ".tmp", ".lock"])
      await expect(access(join(root, name))).rejects.toMatchObject({
        code: "ENOENT",
      });
  });
  it("rejects a symlinked legacy root instead of importing files outside the skill directory", async () => {
    const id = await createLegacySkill(
      new Map([["SKILL.md", Buffer.from(instruction())]]),
      { write: false },
    );
    const outside = join(root, "outside");
    await writeSkillDirectory(outside, new Map([["SKILL.md", Buffer.from(instruction())]]));
    await mkdir(join(root, "skills"));
    await symlink(outside, join(root, "skills", id));
    await expect(readSkillDirectory(join(root, "skills", id))).rejects.toThrow("skill_path_escape");
    await migrateFileSkills(db, root);
    expect(await db.skillFile.count()).toBe(0);
    expect((await db.skill.findUniqueOrThrow({ where: { id } })).state).toBe("broken");
  });
  it("marks skills broken when the legacy directory is missing or fails the fingerprint check", async () => {
    const files = new Map([["SKILL.md", Buffer.from(instruction())]]);
    const missing = await createLegacySkill(files, { write: false });
    const mismatch = await createLegacySkill(files, { tamper: true });
    await migrateFileSkills(db, root);
    expect(
      (await db.skill.findUniqueOrThrow({ where: { id: missing } })).state,
    ).toBe("broken");
    expect(
      (await db.skill.findUniqueOrThrow({ where: { id: mismatch } })).state,
    ).toBe("broken");
    expect(await db.skillFile.count()).toBe(0);
  });
});
