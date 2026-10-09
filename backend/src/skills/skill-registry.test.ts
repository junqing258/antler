import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSkillSnapshot } from "./skill-policy.js";
import { SkillRegistry } from "./skill-registry.js";
import { createSkillTools } from "./skill-tools.js";

const temporaryDirectories: string[] = [];
const content = "---\nname: example\ndescription: Example skill.\n---\n\n# Instructions\n";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function setupSkill() {
  const root = await mkdtemp(join(tmpdir(), "antler-skill-"));
  temporaryDirectories.push(root);
  const directory = join(root, ".agents", "skills", "example");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "SKILL.md");
  await writeFile(file, content);
  await writeFile(join(directory, "reference.md"), "Reference content.");
  const catalog = await new SkillRegistry(join(root, "user-agents")).list(root);
  expect(catalog.diagnostics).toEqual([]);
  expect(catalog.skills.map((skill) => skill.id)).toEqual(["example"]);
  const snapshot = createSkillSnapshot(root, { mode: "auto" }, catalog);
  const tools = createSkillTools(snapshot);
  return { file, tools };
}

describe("SkillRegistry fingerprints", () => {
  it("loads an unchanged skill with frontmatter and reads its resources", async () => {
    const { tools } = await setupSkill();
    const invocation = await tools[0].execute("load", { skillId: "example" });
    expect(invocation.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining("# Instructions") }),
    ]);
    const resource = await tools[1].execute("resource", {
      skillId: "example",
      path: "reference.md",
    });
    expect(resource.content).toEqual([
      expect.objectContaining({ text: "Reference content." }),
    ]);
  });

  it.each([
    content.replace("Example skill.", "Changed description."),
    content.replace("# Instructions", "# Changed instructions"),
  ])("rejects a skill when its metadata or body changes", async (changed) => {
    const { file, tools } = await setupSkill();
    await writeFile(file, changed);
    for (const tool of tools) {
      await expect(
        tool.execute("changed", { skillId: "example", path: "reference.md" }),
      ).rejects.toThrow("skill_snapshot_changed");
    }
  });
});
