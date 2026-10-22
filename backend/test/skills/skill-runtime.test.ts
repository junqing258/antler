import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createSkillTools } from "../../src/skills/skill-tools.js";
import { filesFingerprint, directoryFingerprint } from "../../src/skills/directory-fingerprint.js";
import { SecretGuard } from "../../src/agent/secret-guard.js";
import type { LoadedSkill, SkillSnapshot } from "../../src/skills/types.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "antler skill runtime ")));
  roots.push(root);
  const directory = join(root, "platform", "skill");
  const workspace = join(root, "empty workspace");
  await mkdir(join(directory, "scripts"), { recursive: true });
  await mkdir(workspace);
  const files = new Map([
    ["SKILL.md", Buffer.from("---\nname: example\ndescription: Example\n---\nRun the example script.")],
    ["pyproject.toml", Buffer.from('[project]\nname = "example"\nversion = "0.1.0"\n')],
    ["data.txt", Buffer.from("resource from skill")],
    ["scripts/run.cjs", Buffer.from(`const fs = require('node:fs'); const path = require('node:path'); fs.mkdirSync('reports', { recursive: true }); fs.writeFileSync('reports/result.txt', fs.readFileSync(path.join(__dirname, '../data.txt'))); console.log(process.cwd()); console.log(process.env.SKILL_TEST_TOKEN || 'no-token');`)],
  ]);
  for (const [path, value] of files) await writeFile(join(directory, path), value);
  const skill: LoadedSkill = {
    id: "example", scope: "platform", directory, modelUri: "skill://example/SKILL.md",
    fingerprint: `sha256:${createHash("sha256").update(files.get("SKILL.md")!).digest("hex")}`,
    directoryFingerprint: filesFingerprint(files).fingerprint,
    skill: { name: "example", description: "Example", content: "Run the example script.", filePath: join(directory, "SKILL.md"), disableModelInvocation: false },
  };
  const snapshot: SkillSnapshot = { workspaceRoot: workspace, policy: { mode: "selected", skillIds: [skill.id] }, catalogFingerprint: "test", contextFingerprint: "test", skills: [skill], diagnostics: [] };
  const guard = new SecretGuard(workspace, () => ({ SKILL_TEST_TOKEN: "runtime-test-private-value" }));
  const tools = createSkillTools(snapshot, guard);
  const run = tools.find((tool) => tool.name === "run_skill")!;
  return { root, directory, workspace, files, skill, snapshot, tools, run };
}

it("runs scripts and resources in an empty workspace, preserves dependencies, and leaves source intact", async () => {
  const { directory, workspace, skill, tools, run } = await setup();
  const loaded = await tools[0].execute("load", { skillId: skill.id });
  expect(JSON.stringify(loaded)).toContain("run_skill");
  expect(JSON.stringify(loaded)).not.toContain(directory);
  const output = await run.execute("run", { skillId: skill.id, command: 'node "$ANTLER_SKILL_DIR/scripts/run.cjs"' });
  expect(JSON.stringify(output)).toContain(workspace);
  expect(JSON.stringify(output)).toContain("[REDACTED]");
  expect(JSON.stringify(output)).not.toContain("runtime-test-private-value");
  expect(await readFile(join(workspace, "reports/result.txt"), "utf8")).toBe("resource from skill");
  await run.execute("deps", { skillId: skill.id, command: 'mkdir -p "$ANTLER_SKILL_DIR/.venv"; touch "$ANTLER_SKILL_DIR/.venv/keep"' });
  await run.execute("lockfile", { skillId: skill.id, command: 'echo updated > "$ANTLER_SKILL_DIR/pyproject.toml"' });
  await run.execute("reuse", { skillId: skill.id, command: 'test -f "$ANTLER_SKILL_DIR/.venv/keep"; test -f "$ANTLER_SKILL_DIR/pyproject.toml"' });
  expect((await directoryFingerprint(directory)).fingerprint).toBe(skill.directoryFingerprint);
  expect(await readdir(directory)).not.toContain(".venv");
  expect(await readdir(join(workspace, ".antler/skill-runtimes"))).toHaveLength(1);
});

it("rejects unbound and disabled skills", async () => {
  const { snapshot, run } = await setup();
  await expect(run.execute("missing", { skillId: "other", command: "pwd" })).rejects.toThrow("skill_not_found");
  expect(createSkillTools({ ...snapshot, policy: { mode: "disabled" } })).toEqual([]);
});

it("rejects changed resources and symlink escapes before executing", async () => {
  const { directory, workspace, run } = await setup();
  await writeFile(join(directory, "data.txt"), "changed");
  await expect(run.execute("changed", { skillId: "example", command: "touch executed" })).rejects.toThrow("skill_snapshot_changed");
  expect(await readdir(workspace)).toEqual([]);
  await rm(join(directory, "data.txt"));
  await symlink(join(directory, "../outside.txt"), join(directory, "data.txt"));
  await expect(run.execute("escape", { skillId: "example", command: "pwd" })).rejects.toThrow("skill_path_escape");
});

it("keeps credential files out of local skill runtime copies", async () => {
  const { directory, workspace, skill, run } = await setup();
  delete skill.directoryFingerprint; // Workspace/user skills may contain local credentials.
  await writeFile(join(directory, ".env"), "PRIVATE=never-copy-me");
  await run.execute("safe", { skillId: "example", command: "pwd" });
  const [version] = await readdir(join(workspace, ".antler/skill-runtimes"));
  expect(await readdir(join(workspace, ".antler/skill-runtimes", version))).not.toContain(".env");
  await expect(run.execute("secret", { skillId: "example", command: 'cat "$ANTLER_SKILL_DIR/.env"' })).rejects.toThrow("secret_access_denied");
});

it("rejects a symlinked runtime parent", async () => {
  const { root, workspace, run } = await setup();
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(workspace, ".antler"));
  await expect(run.execute("escape", { skillId: "example", command: "pwd" })).rejects.toThrow("skill_path_escape");
  expect(await readdir(outside)).toEqual([]);
});

it("isolates skill versions and workspaces", async () => {
  const { root, workspace, directory, files, skill, snapshot, run } = await setup();
  await run.execute("v1", { skillId: "example", command: "pwd" });
  files.set("data.txt", Buffer.from("version two"));
  await writeFile(join(directory, "data.txt"), files.get("data.txt")!);
  const updated = { ...skill, directoryFingerprint: filesFingerprint(files).fingerprint };
  const next = { ...snapshot, skills: [updated] };
  await createSkillTools(next)[2].execute("v2", { skillId: "example", command: "pwd" });
  expect(await readdir(join(workspace, ".antler/skill-runtimes"))).toHaveLength(2);
  const other = join(root, "other workspace");
  await mkdir(other);
  await createSkillTools({ ...next, workspaceRoot: other })[2].execute("other", { skillId: "example", command: "pwd" });
  expect(await readdir(join(other, ".antler/skill-runtimes"))).toHaveLength(1);
});

it("propagates command errors, timeouts and cancellation", async () => {
  const { run } = await setup();
  await expect(run.execute("error", { skillId: "example", command: "echo diagnostic; exit 7" })).rejects.toThrow("diagnostic");
  await expect(run.execute("timeout", { skillId: "example", command: 'node -e "setTimeout(() => {}, 10000)"', timeoutMs: 1000 })).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(run.execute("cancel", { skillId: "example", command: "pwd" }, controller.signal)).rejects.toThrow();
});

it("prepares one complete runtime for concurrent calls", async () => {
  const { workspace, run } = await setup();
  await Promise.all(["one", "two"].map((id) => run.execute(id, {
    skillId: "example", command: 'test -f "$ANTLER_SKILL_DIR/scripts/run.cjs"',
  })));
  expect(await readdir(join(workspace, ".antler/skill-runtimes"))).toHaveLength(1);
});

it("creates and reuses a real Python environment without changing the skill source", async () => {
  const { directory, skill, run } = await setup();
  await run.execute("venv", {
    skillId: "example",
    command: 'python3 -m venv --without-pip "$ANTLER_SKILL_DIR/.venv"',
  });
  const output = await run.execute("python", {
    skillId: "example",
    command: '"$ANTLER_SKILL_DIR/.venv/bin/python3" -c "print(42)"',
  });
  expect(JSON.stringify(output)).toContain("42");
  expect((await directoryFingerprint(directory)).fingerprint).toBe(skill.directoryFingerprint);
});
