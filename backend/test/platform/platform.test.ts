import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdir, mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { schedulerDatabase } from "../scheduler/helpers.js";
import { PlatformService } from "../../src/platform/service.js";
import { SkillRegistry } from "../../src/skills/skill-registry.js";
import { PlatformError, type AuthContext } from "../../src/platform/errors.js";
import { registerSkillRoutes } from "../../src/routes/skills.js";
import { registerAgentRoutes } from "../../src/routes/agents.js";
import { createSkillTools } from "../../src/skills/skill-tools.js";
import { createSkillSnapshot } from "../../src/skills/skill-policy.js";
import { archive, instruction, uploadBody } from "./helpers.js";

const author: AuthContext = { userId: "alice", authMode: "supabase" };
const other: AuthContext = { userId: "bob", authMode: "supabase" };
const local: AuthContext = { userId: "", authMode: "local" };
let db: Awaited<ReturnType<typeof schedulerDatabase>>;
let root: string, service: PlatformService;
const draft = (skillIds: string[] = []) => ({
  name: "Example",
  description: "An example Agent",
  systemPrompt: "Be precise.",
  skillIds,
});
beforeAll(async () => {
  db = await schedulerDatabase();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await db.agent.deleteMany();
  await db.skill.deleteMany();
  root = await mkdtemp(join(tmpdir(), "antler-platform-test-"));
  service = new PlatformService(
    db,
    root,
    new SkillRegistry(join(root, "unused")),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("Agent platform", () => {
  it("seeds preset Agents once and preserves edits in both auth modes", async () => {
    await service.ensureBuiltinAgents();
    await service.ensureBuiltinAgents();
    const agents = await service.listAgents(other);
    expect(agents.map((agent) => agent.name).sort()).toEqual(["股票分析师", "默认助手"].sort());
    expect(agents).toHaveLength(2);
    for (const agent of agents) {
      expect(agent.status).toBe("published");
      expect(agent.systemPrompt.length).toBeGreaterThan(0);
      const resolved = await service.resolveAgent(agent.id, other, true);
      resolved.release();
      for (const auth of [local, other]) {
        await service.updateAgent(agent.id, { name: "changed", systemPrompt: "Custom prompt" }, auth);
        await service.updateAgent(agent.id, {}, auth, "unpublish");
        expect(await service.getAgent(agent.id, auth)).toMatchObject({ name: "changed", status: "draft" });
        await service.ensureBuiltinAgents();
        expect(await service.getAgent(agent.id, auth)).toMatchObject({ name: "changed", systemPrompt: "Custom prompt", status: "draft" });
      }
    }
  });
  it("executes an uploaded and bound skill in an empty Agent workspace", async () => {
    const row = await service.upload({
      name: "sample-skill",
      archive: archive({
        "SKILL.md": instruction(),
        "pyproject.toml": '[project]\nname = "sample-skill"\nversion = "0.1.0"\n',
        "data.txt": "uploaded resource",
        "scripts/report.cjs": `const fs = require('node:fs'); const path = require('node:path'); fs.mkdirSync('reports', { recursive: true }); fs.writeFileSync('reports/uploaded.txt', fs.readFileSync(path.join(__dirname, '../data.txt')));`,
      }),
    }, author);
    const agent = await service.createAgent(draft([row.id]), author);
    const resolved = await service.resolveAgent(agent.id, author);
    const workspace = join(root, "agent-workspace");
    await mkdir(workspace);
    try {
      const snapshot = createSkillSnapshot(workspace, { mode: "selected", skillIds: resolved.context.skillIds }, resolved);
      const run = createSkillTools(snapshot).find((tool) => tool.name === "run_skill")!;
      await run.execute("report", { skillId: "sample-skill", command: 'node "$ANTLER_SKILL_DIR/scripts/report.cjs"' });
      await run.execute("dependencies", { skillId: "sample-skill", command: 'mkdir -p "$ANTLER_SKILL_DIR/.venv"' });
      expect(await readFile(join(workspace, "reports/uploaded.txt"), "utf8")).toBe("uploaded resource");
      expect(await readdir(service.directory(row))).not.toContain(".venv");
    } finally {
      resolved.release();
    }
    await service.checkSkill(row.id);
    expect(await db.skill.findUnique({ where: { id: row.id } })).toMatchObject({ state: "ready" });
  });
  it("keeps database UUIDs separate from skill names and tools' file fingerprints", async () => {
    const row = await service.upload(uploadBody(), author);
    expect(row.id).not.toBe(row.name);
    const agent = await service.createAgent(draft([row.id]), author);
    const resolved = await service.resolveAgent(agent.id, author);
    try {
      expect(resolved.context.skillIds).toEqual(["sample-skill"]);
      expect(resolved.skills[0]!.fingerprint).not.toBe(
        resolved.skills[0]!.directoryFingerprint,
      );
      const snapshot = createSkillSnapshot(
        root,
        { mode: "selected", skillIds: resolved.context.skillIds },
        resolved,
      );
      const tools = createSkillTools(snapshot);
      const loaded = await tools[0]!.execute("1", { skillId: "sample-skill" });
      expect(JSON.stringify(loaded)).toContain("Use resources carefully");
      expect(
        JSON.stringify(
          await tools[1]!.execute("2", {
            skillId: "sample-skill",
            path: "data.txt",
          }),
        ),
      ).toContain("original resource");
    } finally {
      resolved.release();
    }
  });
  it("enforces visibility and authorship by authMode, including local single user semantics", async () => {
    const agent = await service.createAgent(draft(), author);
    await expect(service.getAgent(agent.id, other)).rejects.toMatchObject({
      code: "agent_not_found",
    });
    await expect(
      service.updateAgent(agent.id, { name: "stolen" }, other),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await service.getAgent(agent.id, local)).id).toBe(agent.id);
    await service.updateAgent(agent.id, { name: "local edit" }, local);
    await service.updateAgent(agent.id, {}, author, "publish");
    expect((await service.getAgent(agent.id, other)).status).toBe("published");
    await service.updateAgent(agent.id, {}, author, "unpublish");
    await expect(service.getAgent(agent.id, other)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it.each(["", " \n\t"])(
    "permits blank draft prompts but atomically rejects blank published updates (%j)",
    async (prompt) => {
      const row = await service.createAgent(
        { ...draft(), systemPrompt: prompt },
        author,
      );
      await expect(
        service.updateAgent(row.id, {}, author, "publish"),
      ).rejects.toMatchObject({ code: "agent_prompt_required" });
      await service.updateAgent(row.id, { systemPrompt: "valid" }, author);
      const published = await service.updateAgent(
        row.id,
        {},
        author,
        "publish",
      );
      await expect(
        service.updateAgent(
          row.id,
          {
            name: "changed",
            description: "changed",
            systemPrompt: prompt,
            skillIds: [],
          },
          author,
        ),
      ).rejects.toMatchObject({ code: "agent_prompt_required" });
      const preserved = await db.agent.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(preserved).toMatchObject({
        name: row.name,
        description: row.description,
        systemPrompt: "valid",
        status: "published",
        publishedAt: published.publishedAt,
      });
      await service.updateAgent(
        row.id,
        { name: "allowed without prompt" },
        author,
      );
      await service.updateAgent(row.id, {}, author, "unpublish");
      await service.updateAgent(row.id, { systemPrompt: prompt }, author);
      await expect(
        service.updateAgent(row.id, {}, author, "publish"),
      ).rejects.toMatchObject({ code: "agent_prompt_required" });
    },
  );
  it("accepts non-invocable uploads but rejects bindings and publication server-side", async () => {
    const row = await service.upload(uploadBody("Hidden", true), author);
    expect(row).toMatchObject({
      state: "ready",
      bindable: false,
      disableModelInvocation: true,
    });
    expect((await service.listSkills())[0]).toMatchObject({ bindable: false });
    const agent = await service.createAgent(draft(), author);
    await expect(
      service.updateAgent(agent.id, { skillIds: [row.id] }, author),
    ).rejects.toMatchObject({ code: "skill_not_bindable" });
    await db.agentSkill.create({
      data: { agentId: agent.id, skillId: row.id },
    });
    await expect(
      service.updateAgent(agent.id, {}, author, "publish"),
    ).rejects.toMatchObject({ code: "skill_not_bindable" });
    expect(
      (await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).status,
    ).toBe("draft");
  });
  it("rejects duplicate names, owner changes and mismatched descriptions without changing files", async () => {
    const row = await service.upload(uploadBody(), author);
    await expect(service.upload(uploadBody(), author)).rejects.toMatchObject({
      code: "skill_name_taken",
    });
    await expect(
      service.upload(uploadBody(), other, row.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.upload({ ...uploadBody(), description: "fake" }, author, row.id),
    ).rejects.toMatchObject({ code: "skill_invalid" });
    expect(
      (await db.skill.findUniqueOrThrow({ where: { id: row.id } })).fingerprint,
    ).toBe(row.fingerprint);
    expect(await db.skillFile.count({ where: { skillId: row.id } })).toBe(
      row.fileCount,
    );
    expect(await readFile(join(root, row.directory, "data.txt"), "utf8")).toBe(
      "original resource",
    );
  });
  it("self-heals a tampered or deleted cache from the database and repairs broken rows on re-upload", async () => {
    const row = await service.upload(uploadBody(), author);
    const agent = await service.createAgent(draft([row.id]), author);
    // A bash-modified cache file never poisons the database: the next read
    // detects the fingerprint mismatch and reinstalls from skill_files.
    await writeFile(join(root, row.directory, "data.txt"), "tampered");
    let resolved = await service.resolveAgent(agent.id, author);
    try {
      expect(JSON.stringify(resolved.skills)).not.toContain("tampered");
    } finally {
      resolved.release();
    }
    expect(await readFile(join(root, row.directory, "data.txt"), "utf8")).toBe(
      "original resource",
    );
    expect(
      (await db.skill.findUniqueOrThrow({ where: { id: row.id } })).state,
    ).toBe("ready");
    // Deleting the whole cache directory rebuilds it on the next read.
    await rm(join(root, row.directory), { recursive: true, force: true });
    resolved = await service.resolveAgent(agent.id, author);
    resolved.release();
    expect(await readFile(join(root, row.directory, "data.txt"), "utf8")).toBe(
      "original resource",
    );
    // Only database-side inconsistency marks the row tampered.
    await db.skillFile.deleteMany({
      where: { skillId: row.id, path: "data.txt" },
    });
    await service.checkSkill(row.id);
    expect(
      (await db.skill.findUniqueOrThrow({ where: { id: row.id } })).state,
    ).toBe("tampered");
    await service.upload(uploadBody(), author, row.id);
    resolved = await service.resolveAgent(agent.id, author);
    resolved.release();
    expect(
      (await db.skill.findUniqueOrThrow({ where: { id: row.id } })).state,
    ).toBe("ready");
  });
  it("synchronizes frontmatter description across re-uploads", async () => {
    const row = await service.upload(uploadBody(), author);
    const changed = await service.upload(
      uploadBody("Updated description"),
      author,
      row.id,
    );
    expect(changed).toMatchObject({
      description: "Updated description",
      state: "ready",
    });
    expect(changed.fingerprint).not.toBe(row.fingerprint);
    const same = await service.upload(
      uploadBody("Updated description"),
      author,
      row.id,
    );
    expect(same.fingerprint).toBe(changed.fingerprint);
    expect(await db.skillFile.count({ where: { skillId: row.id } })).toBe(
      changed.fileCount,
    );
  });
  it("does not leak hidden draft references when rejecting skill deletion", async () => {
    const row = await service.upload(uploadBody(), author);
    const hidden = await service.createAgent(
      { ...draft([row.id]), name: "Secret Bob Agent" },
      other,
    );
    await expect(service.deleteSkill(row.id, author)).rejects.toMatchObject({
      code: "skill_in_use",
      details: { agents: [], hasHiddenReferences: true },
    });
    try {
      await service.deleteSkill(row.id, author);
    } catch (e) {
      expect(JSON.stringify(e)).not.toContain(hidden.id);
      expect(JSON.stringify(e)).not.toContain(hidden.name);
    }
    await service.updateAgent(hidden.id, {}, other, "publish");
    await expect(service.deleteSkill(row.id, author)).rejects.toMatchObject({
      details: {
        agents: [{ id: hidden.id, name: hidden.name }],
        hasHiddenReferences: false,
      },
    });
    await service.deleteAgent(hidden.id, other);
    await service.deleteSkill(row.id, author);
    expect(await db.skill.findUnique({ where: { id: row.id } })).toBeNull();
  });
  it("holds read leases across runs, serializes PUTs and checks bindings under the same lock", async () => {
    const row = await service.upload(uploadBody(), author);
    const lease = await service.loadSkills([row.id]);
    let completed = false;
    const update = service
      .upload(uploadBody("second"), author, row.id)
      .then(() => {
        completed = true;
      });
    await new Promise((r) => setTimeout(r, 30));
    expect(completed).toBe(false);
    expect(
      await readFile(join(root, row.directory, "SKILL.md"), "utf8"),
    ).toContain("Example skill");
    lease.release();
    await update;
    await Promise.all([
      service.upload(uploadBody("third"), author, row.id),
      service.upload(uploadBody("fourth"), author, row.id),
    ]);
    const checked = await service.loadSkills([row.id]);
    checked.release();
    expect(["third", "fourth"]).toContain(
      (await db.skill.findUniqueOrThrow({ where: { id: row.id } })).description,
    );
  });
  it("commits skill and file rows atomically, leaving no half state on failure", async () => {
    const first = await service.upload(uploadBody(), author);
    // A unique-name violation inside the transaction rolls back the file rows too.
    await expect(service.upload(uploadBody(), author)).rejects.toMatchObject({
      code: "skill_name_taken",
    });
    expect(await db.skill.count()).toBe(1);
    expect(await db.skillFile.count()).toBe(first.fileCount);
    expect(await readdir(join(root, "skills"))).toEqual([first.id]);
    expect(await readdir(join(root, ".tmp")).catch(() => [])).toEqual([]);
    // Invalid archives fail before any row is written.
    await expect(
      service.upload({ name: "sample-skill", archive: "not-base64!" }, author),
    ).rejects.toMatchObject({ code: "skill_invalid" });
    expect(await db.skill.count()).toBe(1);
  });
  it("rejects inconsistent database files and marks the skill tampered", async () => {
    const row = await service.upload(uploadBody(), author);
    await db.skillFile.update({
      where: { skillId_path: { skillId: row.id, path: "data.txt" } },
      data: { content: Buffer.from("corrupted") },
    });
    await rm(service.directory(row), { recursive: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(service.loadSkills([row.id])).rejects.toMatchObject({ code: "agent_skills_unavailable" });
    expect((await db.skill.findUniqueOrThrow({ where: { id: row.id } })).state).toBe("tampered");
  });
  it("rolls back metadata and deleted file rows when replacement fails", async () => {
    const first = await service.upload(uploadBody(), author);
    const originalFiles = await db.skillFile.findMany({ where: { skillId: first.id } });
    const transaction = db.$transaction.bind(db);
    vi.spyOn(db, "$transaction").mockImplementationOnce(((callback: any) =>
      transaction(async (tx) => {
        tx.skillFile.createMany = () => { throw new Error("file write failed"); };
        return callback(tx);
      })) as typeof db.$transaction);
    await expect(service.upload(uploadBody("Changed"), author, first.id))
      .rejects.toThrow("file write failed");
    expect((await db.skill.findUniqueOrThrow({ where: { id: first.id } })).description)
      .toBe(first.description);
    expect(await db.skillFile.findMany({ where: { skillId: first.id } }))
      .toEqual(originalFiles);
  });
  it("rebuilds committed files after cache installation fails and cascades deletion", async () => {
    await writeFile(join(root, ".tmp"), "blocked");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const row = await service.upload(uploadBody(), author);
    expect(await db.skillFile.count({ where: { skillId: row.id } })).toBe(2);
    await rm(join(root, ".tmp"));
    const lease = await service.loadSkills([row.id]);
    try {
      expect(await readFile(join(service.directory(row), "data.txt"), "utf8"))
        .toBe("original resource");
    } finally {
      lease.release();
    }
    await service.deleteSkill(row.id, author);
    expect(await db.skillFile.count()).toBe(0);
  });
  it("accepts wrapped archives, rejects unsafe paths, missing metadata, symlinks and encrypted entries", async () => {
    const good = {
      name: "sample-skill",
      archive: archive({
        "wrapper/SKILL.md": instruction(),
        "wrapper/res.txt": "hi",
      }),
    };
    const row = await service.upload(good, author);
    expect(row.fileCount).toBe(2);
    for (const files of [
      { "../escape": "x", "SKILL.md": instruction() },
      { "/absolute": "x", "SKILL.md": instruction() },
      { "__MACOSX/file": "x", "SKILL.md": instruction() },
      { "wrong.md": instruction() },
      { "SKILL.md": instruction().replace("sample-skill", "wrong") },
    ] as Record<string, string>[]) {
      await expect(
        service.upload(
          { name: "sample-skill", archive: archive(files) },
          author,
        ),
      ).rejects.toMatchObject({ code: "skill_invalid" });
    }
    for (const options of [{ symlink: "resource" }, { encrypted: "resource" }])
      await expect(
        service.upload(
          {
            name: "sample-skill",
            archive: archive(
              { "SKILL.md": instruction(), resource: "x" },
              options,
            ),
          },
          author,
        ),
      ).rejects.toMatchObject({ code: "skill_invalid" });
  });
  it("rejects empty path segments before writing database rows", async () => {
    await expect(service.upload({
      name: "sample-skill",
      archive: archive({ "SKILL.md": instruction(), "data//file": "x" }),
    }, author)).rejects.toMatchObject({ code: "skill_invalid", statusCode: 422 });
    expect(await db.skill.count()).toBe(0);
    expect(await db.skillFile.count()).toBe(0);
  });
  it("enforces entry and single file limits before installation", async () => {
    for (const files of [
      Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}`, "x"])),
      { "SKILL.md": instruction(), large: Buffer.alloc(1024 * 1024 + 1) },
      { "SKILL.md": instruction(), ...Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`dir${i}/file`, "x"]),
      ) },
    ])
      await expect(
        service.upload(
          { name: "sample-skill", archive: archive(files) },
          author,
        ),
      ).rejects.toMatchObject({ code: "skill_too_large" });
  });
  it("allows a 4.9 MiB valid archive through the route limit and enforces HTTP authorship", async () => {
    const app = Fastify();
    app.addHook("preHandler", async (req) => {
      req.antlerUser = { id: (req.headers["x-user"] as string) || "alice" };
    });
    app.setErrorHandler((e, _req, reply) =>
      reply
        .code(e instanceof PlatformError ? e.statusCode : 500)
        .send({ error: (e as Error).message }),
    );
    registerSkillRoutes(app, service, "supabase");
    registerAgentRoutes(app, service, "supabase");
    try {
      const files: Record<string, string | Buffer> = {
        "SKILL.md": instruction(),
      };
      for (let i = 0; i < 5; i++)
        files[`data-${i}`] = Buffer.alloc(1000 * 1024, i);
      const response = await app.inject({
        method: "POST",
        url: "/api/skills",
        payload: { name: "sample-skill", archive: archive(files) },
      });
      expect(response.statusCode).toBe(201);
      const list = await app.inject({
        method: "GET",
        url: "/api/skills?workingDirectory=/ignored",
      });
      expect(list.json().skills[0]).toMatchObject({
        scope: "platform",
        bindable: true,
      });
      const agent = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: draft([response.json().id]),
      });
      expect(agent.statusCode).toBe(201);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/agents/${agent.json().id}`,
            headers: { "x-user": "bob" },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/api/agents/${agent.json().id}`,
            headers: { "x-user": "bob" },
            payload: { name: "stolen" },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });
});
