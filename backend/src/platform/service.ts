import { BUILTIN_AGENTS } from "./builtin-agents.js";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, access, lstat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { PrismaClient } from "../generated/prisma/client.js";
import { SkillRegistry } from "../skills/skill-registry.js";
import { extractSkillArchive } from "../skills/skill-archive.js";
import { SkillLocks } from "./locks.js";
import {
  PlatformError,
  canRead,
  requireOwner,
  type AuthContext,
} from "./errors.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const entries = (path: string) =>
  readdir(path).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
export type RunAgentContext = {
  agentId: string;
  systemPrompt: string;
  skillIds: string[];
  skillFingerprint: string;
  agentFingerprint: string;
};

export class PlatformService {
  readonly locks = new SkillLocks();
  private halted = false;
  halt() {
    this.halted = true;
  }
  private healthy() {
    if (this.halted) throw new PlatformError("platform_unavailable", 503);
  }
  constructor(
    readonly prisma: PrismaClient,
    readonly root: string,
    readonly registry: SkillRegistry,
    private readonly onFatal: (error: unknown) => void = (error) => {
      console.error("Fatal platform storage error", error);
      process.exit(1);
    },
  ) {}
  async ensureBuiltinAgents() {
    this.healthy();
    for (const agent of BUILTIN_AGENTS) {
      await this.prisma.agent.upsert({
        where: { id: agent.id },
        create: {
          ...agent,
          ownerId: "antler-system",
          status: "published",
          publishedAt: new Date(),
        },
        update: {},
      });
    }
  }
  directory(row: { id: string; directory: string }) {
    const path = resolve(this.root, row.directory);
    if (
      path !== join(this.root, "skills", row.id) ||
      !path.startsWith(`${this.root}${sep}`)
    )
      throw new PlatformError("agent_skills_unavailable", 500);
    return path;
  }
  async getAgent(id: string, auth: AuthContext) {
    this.healthy();
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: {
        skills: { orderBy: { position: "asc" }, include: { skill: true } },
      },
    });
    if (!agent || !canRead(agent, auth))
      throw new PlatformError("agent_not_found", 404);
    return agent;
  }
  async listAgents(auth: AuthContext, mine = false) {
    this.healthy();
    return this.prisma.agent.findMany({
      where:
        auth.authMode === "local"
          ? {}
          : mine
            ? { ownerId: auth.userId }
            : { OR: [{ status: "published" }, { ownerId: auth.userId }] },
      include: { _count: { select: { skills: true } } },
      orderBy: { updatedAt: "desc" },
    });
  }
  private fields(body: unknown, creating: boolean) {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new PlatformError("agent_invalid", 422);
    const value = body as Record<string, unknown>;
    const fields: {
      name?: string;
      description?: string;
      systemPrompt?: string;
    } = {};
    for (const [key, max] of [
      ["name", 64],
      ["description", 1024],
      ["systemPrompt", 32000],
    ] as const) {
      if (value[key] === undefined && !creating) continue;
      const text = value[key] ?? (key === "systemPrompt" ? "" : undefined);
      if (
        typeof text !== "string" ||
        text.length > max ||
        (key !== "systemPrompt" && !text.trim())
      )
        throw new PlatformError("agent_invalid", 422);
      fields[key] = text;
    }
    const skillIds = value.skillIds;
    if (
      skillIds !== undefined &&
      (!Array.isArray(skillIds) ||
        skillIds.length > 16 ||
        !skillIds.every((id) => typeof id === "string" && id))
    )
      throw new PlatformError("agent_invalid", 422);
    return {
      fields,
      skillIds:
        skillIds === undefined ? undefined : [...new Set(skillIds as string[])],
    };
  }
  async createAgent(body: unknown, auth: AuthContext) {
    const { fields, skillIds = [] } = this.fields(body, true);
    const lease = await this.loadSkills(skillIds);
    try {
      return await this.prisma.agent.create({
        data: {
          ownerId: auth.userId,
          name: fields.name!,
          description: fields.description!,
          systemPrompt: fields.systemPrompt!,
          skills: {
            create: skillIds.map((skillId, position) => ({
              skillId,
              position,
            })),
          },
        },
      });
    } finally {
      lease.release();
    }
  }
  async updateAgent(
    id: string,
    body: unknown,
    auth: AuthContext,
    action?: "publish" | "unpublish",
  ) {
    // Serialize edits/publication per Agent so validation covers the configuration actually committed.
    const unlock = await this.locks.acquire([`agent:${id}`], true);
    try {
      const existing = await this.prisma.agent.findUnique({
        where: { id },
        include: { skills: true },
      });
      requireOwner(existing, auth);
      const { fields, skillIds } = this.fields(body, false);
      const ids = skillIds ?? existing!.skills.map((s) => s.skillId);
      const status =
        action === "publish"
          ? "published"
          : action === "unpublish"
            ? "draft"
            : existing!.status;
      if (
        status === "published" &&
        !(fields.systemPrompt ?? existing!.systemPrompt).trim()
      )
        throw new PlatformError("agent_prompt_required", 422);
      const lease = await this.loadSkills(ids);
      try {
        return await this.prisma.agent.update({
          where: { id },
          data: {
            ...fields,
            status,
            ...(action === "publish" ? { publishedAt: new Date() } : {}),
            ...(skillIds
              ? {
                  skills: {
                    deleteMany: {},
                    create: ids.map((skillId, position) => ({
                      skillId,
                      position,
                    })),
                  },
                }
              : {}),
          },
        });
      } finally {
        lease.release();
      }
    } finally {
      unlock();
    }
  }
  async deleteAgent(id: string, auth: AuthContext) {
    const release = await this.locks.acquire([`agent:${id}`], true);
    try {
      requireOwner(await this.prisma.agent.findUnique({ where: { id } }), auth);
      await this.prisma.agent.delete({ where: { id } });
    } finally {
      release();
    }
  }
  async loadSkills(ids: string[]) {
    const release = await this.locks.acquire(ids);
    try {
      this.healthy();
      const rows = await this.prisma.skill.findMany({
        where: { id: { in: ids } },
      });
      if (rows.length !== new Set(ids).size)
        throw new PlatformError("agent_skills_unavailable", 500);
      const catalog = await this.registry.listPlatform(
        rows.map((row) => ({ ...row, directory: this.directory(row) })),
      );
      const bad = catalog.diagnostics.filter(
        (d) => d.code !== "skill_not_bindable",
      );
      if (bad.length) {
        release();
        // Recheck under the write lock; stale readers must never overwrite a repaired row.
        for (const row of rows.filter((r) =>
          bad.some((d) => d.name === r.name),
        ))
          await this.checkSkill(row.id);
        throw new PlatformError("agent_skills_unavailable", 500);
      }
      if (rows.some((r) => r.state !== "ready"))
        throw new PlatformError("agent_skills_unavailable", 500);
      if (catalog.skills.length !== rows.length)
        throw new PlatformError("skill_not_bindable", 422);
      return { ...catalog, release };
    } catch (error) {
      release();
      throw error;
    }
  }
  async resolveAgent(id: string, auth: AuthContext, requirePublished = false) {
    const agent = await this.getAgent(id, auth);
    if (requirePublished && agent.status !== "published")
      throw new PlatformError("agent_not_published");
    const lease = await this.loadSkills(agent.skills.map((s) => s.skillId));
    const systemPrompt = buildSystemPrompt(agent.systemPrompt);
    const skills = [...lease.skills].sort((a, b) => a.id.localeCompare(b.id));
    const skillFingerprint = skills
      .map((s) => `${s.id}:${s.directoryFingerprint}`)
      .join("\n");
    const agentFingerprint = `sha256:${createHash("sha256")
      .update(systemPrompt + "\n" + skillFingerprint)
      .digest("hex")}`;
    return {
      ...lease,
      context: {
        agentId: id,
        systemPrompt,
        skillIds: skills.map((s) => s.id),
        skillFingerprint,
        agentFingerprint,
      } satisfies RunAgentContext,
    };
  }
  async checkSkill(id: string) {
    const release = await this.locks.acquire([id], true);
    try {
      this.healthy();
      const row = await this.prisma.skill.findUnique({ where: { id } });
      if (!row) return;
      const catalog = await this.registry.listPlatform([
        { ...row, directory: this.directory(row) },
      ]);
      const diagnostic = catalog.diagnostics.find(
        (d) => d.code === "broken" || d.code === "tampered",
      );
      if (diagnostic) {
        console.warn(`[Platform] ${row.id}: ${diagnostic.code}`);
        await this.prisma.skill.update({
          where: { id },
          data: { state: diagnostic.code as "broken" | "tampered" },
        });
      }
    } finally {
      release();
    }
  }
  async listSkills() {
    this.healthy();
    const rows = await this.prisma.skill.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((row) => ({
      ...row,
      scope: "platform",
      bindable: row.state === "ready" && !row.disableModelInvocation,
      unbindableReason:
        row.state !== "ready"
          ? row.state
          : row.disableModelInvocation
            ? "disable_model_invocation"
            : null,
    }));
  }
  async upload(body: unknown, auth: AuthContext, id?: string) {
    if (
      id !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new PlatformError("not_found", 404);
    const skillId = id ?? randomUUID();
    const operation = id
      ? join(this.root, ".staging", "updates", id, randomUUID())
      : join(this.root, ".staging", skillId);
    const stage = id ? join(operation, "new") : operation;
    let release: (() => void) | undefined;
    const target = join(this.root, "skills", skillId),
      old = join(operation, "old");
    let backedUp = false,
      installed = false,
      committed = false,
      preserveOperation = false,
      writingDatabase = false;
    try {
      const metadata = await extractSkillArchive(body, stage);
      release = await this.locks.acquire([skillId], true);
      this.healthy();
      if (id) {
        const row = await this.prisma.skill.findUnique({ where: { id } });
        requireOwner(row, auth);
        if (metadata.name !== row!.name)
          throw new PlatformError("skill_invalid", 422);
        try {
          await rename(target, old);
          backedUp = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      await mkdir(join(this.root, "skills"), { recursive: true, mode: 0o700 });
      await rename(stage, target);
      installed = true;
      this.healthy();
      writingDatabase = true;
      const row = id
        ? await this.prisma.skill.update({
            where: { id },
            data: { ...metadata, state: "ready" },
          })
        : await this.prisma.skill.create({
            data: {
              ...metadata,
              id: skillId,
              ownerId: auth.userId,
              directory: `skills/${skillId}`,
            },
          });
      committed = true;
      return { ...row, diagnostics: [], bindable: !row.disableModelInvocation };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (
        writingDatabase &&
        [
          "P1001",
          "P1002",
          "P1008",
          "P1017",
          "P2024",
          "ECONNRESET",
          "ETIMEDOUT",
        ].includes(code ?? "")
      ) {
        preserveOperation = true;
        this.halted = true;
        this.onFatal(error);
        throw error;
      }
      if (!committed) {
        try {
          if (installed) await rm(target, { recursive: true, force: true });
          if (backedUp) await rename(old, target);
        } catch (compensationError) {
          // Preserve the operation directory for startup recovery and terminate instead of exposing mixed state.
          console.error("Platform compensation failed", compensationError);
          preserveOperation = true;
          this.halted = true;
          this.onFatal(compensationError);
          throw compensationError;
        }
      }
      if ((error as { code?: string }).code === "P2002")
        throw new PlatformError("skill_name_taken", 422);
      throw error;
    } finally {
      try {
        if (!preserveOperation)
          await rm(operation, { recursive: true, force: true });
      } finally {
        release?.();
      }
    }
  }
  async deleteSkill(id: string, auth: AuthContext) {
    const release = await this.locks.acquire([id], true);
    try {
      this.healthy();
      const row = await this.prisma.skill.findUnique({
        where: { id },
        include: { agents: { include: { agent: true } } },
      });
      requireOwner(row, auth);
      if (row!.agents.length) {
        const visible = row!.agents.filter((r) => canRead(r.agent, auth));
        throw new PlatformError("skill_in_use", 409, {
          agents: visible.map((r) => ({ id: r.agent.id, name: r.agent.name })),
          hasHiddenReferences: visible.length !== row!.agents.length,
        });
      }
      await this.prisma.skill.delete({ where: { id } });
      await rm(this.directory(row!), { recursive: true, force: true });
    } finally {
      release();
    }
  }
  /** Called only under the lifetime storage lock, before any request or scheduler. */
  async recover() {
    for (const name of ["skills", ".staging", ".orphaned"]) {
      const info = await lstat(join(this.root, name)).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT") throw e;
          return undefined;
        },
      );
      if (info && (!info.isDirectory() || info.isSymbolicLink()))
        throw new Error(`Unsafe platform directory: ${name}`);
    }
    const rows = await this.prisma.skill.findMany();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const staging = join(this.root, ".staging"),
      updates = join(staging, "updates");
    for (const id of await entries(updates)) {
      if (!/^[a-zA-Z0-9-]+$/.test(id))
        throw new Error("Invalid update recovery directory");
      const operations = await entries(join(updates, id));
      const withOld: string[] = [];
      for (const op of operations)
        if (await exists(join(updates, id, op, "old"))) withOld.push(op);
      if (withOld.length > 1)
        throw new Error(`Ambiguous skill recovery: ${id}`);
      const target = join(this.root, "skills", id);
      if (byId.has(id) && !(await exists(target)) && withOld[0])
        await rename(join(updates, id, withOld[0], "old"), target);
      if (!byId.has(id)) {
        await mkdir(join(this.root, ".orphaned"), {
          recursive: true,
          mode: 0o700,
        });
        await rename(
          join(updates, id),
          join(this.root, ".orphaned", `update-${id}-${randomUUID()}`),
        );
      }
    }
    await rm(staging, { recursive: true, force: true });
    for (const id of await entries(join(this.root, "skills"))) {
      if (byId.has(id)) continue;
      await mkdir(join(this.root, ".orphaned"), {
        recursive: true,
        mode: 0o700,
      });
      await rename(
        join(this.root, "skills", id),
        join(this.root, ".orphaned", `${id}-${randomUUID()}`),
      );
    }
    for (const row of rows) await this.checkSkill(row.id);
  }
}
