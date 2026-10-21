import { BUILTIN_AGENTS } from "./builtin-agents.js";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import type { PrismaClient } from "../generated/prisma/client.js";
import { SkillRegistry } from "../skills/skill-registry.js";
import { parseSkillArchive } from "../skills/skill-archive.js";
import {
  directoryFingerprint,
  filesFingerprint,
} from "../skills/directory-fingerprint.js";
import {
  persistSkillFiles,
  readSkillFiles,
  writeSkillDirectory,
} from "./skill-files.js";
import { SkillLocks } from "./locks.js";
import {
  PlatformError,
  canRead,
  requireOwner,
  type AuthContext,
} from "./errors.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";

export type RunAgentContext = {
  agentId: string;
  systemPrompt: string;
  skillIds: string[];
  skillFingerprint: string;
  agentFingerprint: string;
};

/**
 * Agent/skill metadata lives in Postgres; skill files live in skill_files rows.
 * The platform root is only a disposable materialized cache of those rows, so
 * there is no filesystem state to reconcile and no cross-instance lock.
 */
export class PlatformService {
  readonly locks = new SkillLocks();
  constructor(
    readonly prisma: PrismaClient,
    readonly root: string,
    readonly registry: SkillRegistry,
  ) {}
  async ensureBuiltinAgents() {
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
  directory(row: { id: string }) {
    const path = join(this.root, "skills", row.id);
    if (!path.startsWith(`${this.root}${sep}`))
      throw new PlatformError("agent_skills_unavailable", 500);
    return path;
  }
  async getAgent(id: string, auth: AuthContext) {
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
  /**
   * Cache materialization acquires the per-skill write lock, so it must run
   * before the read lease below — the FIFO lock is not reentrant. Once the
   * lease is held, uploads (which take the write lock) cannot interleave, so
   * the (row, cache) pair stays frozen for the lease's lifetime.
   */
  private async ensureCache(row: { id: string; fingerprint: string }) {
    const cached = await directoryFingerprint(this.directory(row)).catch(
      () => undefined,
    );
    if (cached?.fingerprint === row.fingerprint) return;
    const release = await this.locks.acquire([row.id], true);
    try {
      // The database is the source of truth; one retry absorbs an upload
      // committing between the row and file reads.
      for (let attempt = 0; attempt < 2; attempt++) {
        const fresh = await this.prisma.skill.findUnique({
          where: { id: row.id },
        });
        if (!fresh) throw new PlatformError("agent_skills_unavailable", 500);
        const files = await readSkillFiles(this.prisma, fresh.id).catch(async (error) => {
          await this.prisma.skill.update({
            where: { id: fresh.id },
            data: { state: "broken" },
          });
          console.warn(`[Platform] ${fresh.id}: broken`, error);
          throw new PlatformError("agent_skills_unavailable", 500);
        });
        if (filesFingerprint(files).fingerprint === fresh.fingerprint) {
          await this.installCache(fresh, files);
          return;
        }
      }
      await this.prisma.skill.update({
        where: { id: row.id },
        data: { state: "tampered" },
      });
      console.warn(`[Platform] ${row.id}: tampered`);
      throw new PlatformError("agent_skills_unavailable", 500);
    } finally {
      release();
    }
  }
  /** Atomically swap the cache directory; callers must hold the skill write lock. */
  private async installCache(
    row: { id: string; fingerprint: string },
    files: ReadonlyMap<string, Uint8Array>,
  ) {
    if (filesFingerprint(files).fingerprint !== row.fingerprint)
      throw new PlatformError("agent_skills_unavailable", 500);
    const target = this.directory(row),
      staging = join(this.root, ".tmp", `${row.id}-${randomUUID()}`),
      previous = join(this.root, ".tmp", `${row.id}-old-${randomUUID()}`);
    await mkdir(join(this.root, "skills"), { recursive: true, mode: 0o700 });
    let backedUp = false;
    try {
      await writeSkillDirectory(staging, files);
      try {
        await rename(target, previous);
        backedUp = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(staging, target);
    } catch (error) {
      if (backedUp) await rename(previous, target).catch(() => {});
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      await rm(previous, { recursive: true, force: true }).catch(() => {});
    }
  }
  async loadSkills(ids: string[]) {
    const rows = await this.prisma.skill.findMany({
      where: { id: { in: ids } },
    });
    if (rows.length !== new Set(ids).size)
      throw new PlatformError("agent_skills_unavailable", 500);
    for (const row of rows) await this.ensureCache(row);
    const release = await this.locks.acquire(ids);
    try {
      const fresh = await this.prisma.skill.findMany({
        where: { id: { in: ids } },
      });
      if (fresh.length !== rows.length)
        throw new PlatformError("agent_skills_unavailable", 500);
      const catalog = await this.registry.listPlatform(
        fresh.map((row) => ({ ...row, directory: this.directory(row) })),
      );
      const bad = catalog.diagnostics.filter(
        (d) => d.code !== "skill_not_bindable",
      );
      if (bad.length) {
        release();
        // Recheck under the write lock; stale readers must never overwrite a repaired row.
        for (const row of fresh.filter((r) =>
          bad.some((d) => d.name === r.name),
        ))
          await this.checkSkill(row.id);
        throw new PlatformError("agent_skills_unavailable", 500);
      }
      if (fresh.some((r) => r.state !== "ready"))
        throw new PlatformError("agent_skills_unavailable", 500);
      if (catalog.skills.length !== fresh.length)
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
  /**
   * Self-healing: reinstall the cache from the database and reset the row.
   * `tampered` now only appears when the database rows themselves disagree;
   * a dirty or deleted cache is repaired and the skill returns to ready.
   */
  async checkSkill(id: string) {
    const release = await this.locks.acquire([id], true);
    try {
      const row = await this.prisma.skill.findUnique({ where: { id } });
      if (!row) return;
      let diagnostic: "broken" | "tampered" | undefined;
      try {
        const files = await readSkillFiles(this.prisma, id);
        if (filesFingerprint(files).fingerprint !== row.fingerprint)
          diagnostic = "tampered";
        else {
          await this.installCache(row, files);
          const catalog = await this.registry.listPlatform([
            { ...row, directory: this.directory(row) },
          ]);
          if (
            catalog.diagnostics.some(
              (d) => d.code === "broken" || d.code === "tampered",
            )
          )
            diagnostic = "broken";
        }
      } catch {
        diagnostic = "broken";
      }
      if (diagnostic) {
        console.warn(`[Platform] ${row.id}: ${diagnostic}`);
        await this.prisma.skill.update({
          where: { id },
          data: { state: diagnostic },
        });
      } else if (row.state !== "ready")
        await this.prisma.skill.update({
          where: { id },
          data: { state: "ready" },
        });
    } finally {
      release();
    }
  }
  async listSkills() {
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
    const parsed = await parseSkillArchive(body);
    const release = await this.locks.acquire([skillId], true);
    try {
      if (id) {
        const row = await this.prisma.skill.findUnique({ where: { id } });
        requireOwner(row, auth);
        if (parsed.name !== row!.name)
          throw new PlatformError("skill_invalid", 422);
      }
      let row;
      try {
        row = await this.prisma.$transaction(async (tx) => {
          const data = {
            name: parsed.name,
            description: parsed.description,
            disableModelInvocation: parsed.disableModelInvocation,
            state: "ready" as const,
            fileCount: parsed.fileCount,
            sizeBytes: parsed.sizeBytes,
            fingerprint: parsed.fingerprint,
          };
          const saved = id
            ? await tx.skill.update({ where: { id }, data })
            : await tx.skill.create({
                data: {
                  ...data,
                  id: skillId,
                  ownerId: auth.userId,
                  directory: `skills/${skillId}`,
                },
              });
          await persistSkillFiles(tx.skillFile, skillId, parsed.files);
          return saved;
        });
      } catch (error) {
        if ((error as { code?: string }).code === "P2002")
          throw new PlatformError("skill_name_taken", 422);
        throw error;
      }
      // Best-effort cache refresh while still holding the write lock; the read path self-heals.
      await this.installCache(row, parsed.files).catch((error) =>
        console.warn("[Platform] cache refresh failed", error),
      );
      return { ...row, diagnostics: [], bindable: !row.disableModelInvocation };
    } finally {
      release();
    }
  }
  async deleteSkill(id: string, auth: AuthContext) {
    const release = await this.locks.acquire([id], true);
    try {
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
      await rm(this.directory(row!), { recursive: true, force: true }).catch(
        (error) => console.warn("[Platform] cache removal failed", error),
      );
    } finally {
      release();
    }
  }
}
