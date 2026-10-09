import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSkillSnapshot } from "./skill-policy.js";
import { SkillRegistry } from "./skill-registry.js";
import { createSkillTools } from "./skill-tools.js";
import { createWorkspaceTools } from "../agent/workspace-tools.js";
import { composeSkillPrompt } from "./skill-prompt.js";

const temporaryDirectories: string[] = [];
const content =
  "---\nname: example\ndescription: Example skill.\n---\n\n# Instructions\n";

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
  const catalog = await new SkillRegistry(
    join(root, "user-agents"),
    join(root, "bundled-skills"),
  ).list(root);
  expect(catalog.diagnostics).toEqual([]);
  expect(catalog.skills.map((skill) => skill.id)).toEqual(["example"]);
  const snapshot = createSkillSnapshot(root, { mode: "auto" }, catalog);
  const tools = createSkillTools(snapshot);
  return { file, tools };
}

describe("SkillRegistry fingerprints", () => {
  it("denies environment resources and their symlink aliases", async () => {
    const { file, tools } = await setupSkill();
    const directory = join(file, "..");
    await writeFile(join(directory, ".env"), "SECRET=skill-private-value\n");
    await symlink(join(directory, ".env"), join(directory, "alias.md"));
    for (const path of [".env", "alias.md"]) {
      await expect(
        tools[1].execute("resource", { skillId: "example", path }),
      ).rejects.toThrow("secret_access_denied");
    }
  });
  it("loads an unchanged skill with frontmatter and reads its resources", async () => {
    const { tools } = await setupSkill();
    const invocation = await tools[0].execute("load", { skillId: "example" });
    expect(invocation.content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("# Instructions"),
      }),
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

describe("backend bundled skills", () => {
  it("discovers and loads antler-rag independently of workspace and user skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-bundled-skills-"));
    temporaryDirectories.push(root);
    const registry = new SkillRegistry(join(root, "user-agents"));

    for (const workspace of [undefined, root, join(root, "other-workspace")]) {
      const catalog = await registry.list(workspace);
      expect(catalog.diagnostics).toEqual([]);
      expect(catalog.skills).toEqual([
        expect.objectContaining({ id: "antler-rag", scope: "bundled" }),
      ]);
      const snapshot = createSkillSnapshot(
        workspace ?? "",
        { mode: "auto" },
        catalog,
      );
      expect(composeSkillPrompt("Base prompt", snapshot)).toContain(
        'id="antler-rag"',
      );
      const tools = createSkillTools(snapshot);
      const invocation = await tools[0].execute("load", {
        skillId: "antler-rag",
      });
      expect(invocation.content).toEqual([
        expect.objectContaining({
          text: expect.stringContaining("ANTLER_RAG_URL"),
        }),
      ]);
    }

    const snapshot = createSkillSnapshot(
      root,
      { mode: "auto" },
      await registry.list(root),
    );
    const resource = await createSkillTools(snapshot)[1].execute("resource", {
      skillId: "antler-rag",
      path: "scripts/rag.py",
    });
    const script = resource.content[0];
    if (script.type !== "text") throw new Error("Expected Python script text.");
    const workspaceTools = createWorkspaceTools(root);
    await workspaceTools
      .find((tool) => tool.name === "write")!
      .execute("write", {
        path: "rag.py",
        content: script.text,
      });
    const help = await workspaceTools
      .find((tool) => tool.name === "bash")!
      .execute("help", {
        command: "python3 rag.py --help",
      });
    expect(help.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining("list-kbs") }),
    ]);
  });

  it("allows workspace and user skills to override a bundled skill", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-skill-precedence-"));
    temporaryDirectories.push(root);
    const agentsDir = join(root, "user-agents");
    const registry = new SkillRegistry(agentsDir);
    for (const scope of ["user", "workspace"] as const) {
      const directory = join(
        scope === "user" ? agentsDir : join(root, ".agents"),
        "skills",
        "antler-rag",
      );
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "SKILL.md"),
        content.replace("example", "antler-rag"),
      );
      const catalog = await registry.list(root);
      expect(catalog.skills).toEqual([
        expect.objectContaining({ id: "antler-rag", scope }),
      ]);
      expect(catalog.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "skill_shadowed",
          name: "antler-rag",
          scope: "bundled",
        }),
      );
    }
  });
});
