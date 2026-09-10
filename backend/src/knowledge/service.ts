import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

const LIMIT = 1024 * 1024;
const ALLOWED = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".css",
  ".html",
  ".sql",
]);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const json = (value: unknown) => value as Prisma.InputJsonValue;

export class KnowledgeService {
  private readonly listeners = new Map<
    string,
    Set<(event: { seq: number; type: string; payload: unknown }) => void>
  >();
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workspaceRoot: string,
  ) {}
  async list(projectId: string) {
    return this.prisma.knowledgeBase.findMany({
      where: { projectId, archivedAt: null },
      include: {
        _count: {
          select: { sources: { where: { archivedAt: null } } },
        },
        sources: {
          where: { archivedAt: null },
          select: {
            id: true,
            displayName: true,
            type: true,
            status: true,
            lastIndexedAt: true,
            errorCode: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }
  async create(projectId: string, name: string, description?: string) {
    const id = randomUUID();
    const isDefault =
      (await this.prisma.knowledgeBase.count({
        where: { projectId, archivedAt: null },
      })) === 0;
    return this.prisma.knowledgeBase.create({
      data: {
        id,
        projectId,
        name,
        description,
        isDefault,
        retrievalConfig: json({}),
      },
    });
  }
  async get(id: string) {
    return this.prisma.knowledgeBase.findFirst({
      where: { id, archivedAt: null },
      include: {
        sources: {
          where: { archivedAt: null },
          orderBy: { updatedAt: "desc" },
        },
      },
    });
  }
  async addSource(
    baseId: string,
    input: {
      type: "text" | "file" | "directory";
      displayName?: string;
      text?: string;
      path?: string;
    },
  ) {
    const base = await this.get(baseId);
    if (!base) throw new Error("knowledge_base_not_found");
    if (input.type === "text" && !input.text?.trim())
      throw new Error("source_text_required");
    if (input.type !== "text" && !input.path)
      throw new Error("source_path_required");
    const uri = input.path ? await this.safePath(input.path) : undefined;
    const source = await this.prisma.knowledgeSource.create({
      data: {
        id: randomUUID(),
        knowledgeBaseId: baseId,
        type: input.type,
        uri,
        displayName:
          input.displayName?.trim() || (uri ? basename(uri) : "Pasted text"),
        config: json(input.type === "text" ? { text: input.text } : {}),
      },
    });
    const job = await this.queue(source.id);
    return { source, job };
  }
  async reindex(sourceId: string) {
    const source = await this.prisma.knowledgeSource.findFirst({
      where: { id: sourceId, archivedAt: null },
    });
    if (!source) throw new Error("knowledge_source_not_found");
    return this.queue(sourceId);
  }
  async archiveBase(id: string) {
    const result = await this.prisma.knowledgeBase.updateMany({
      where: { id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return result.count > 0;
  }
  async archiveSource(id: string) {
    const source = await this.prisma.knowledgeSource.findFirst({
      where: { id, archivedAt: null },
    });
    if (!source) return false;
    await this.prisma.$transaction([
      this.prisma.knowledgeSource.update({
        where: { id },
        data: { archivedAt: new Date(), status: "archived" },
      }),
      this.prisma.knowledgeDocument.updateMany({
        where: { sourceId: id, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    ]);
    return true;
  }
  async job(id: string) {
    return this.prisma.knowledgeIngestionJob.findUnique({ where: { id } });
  }
  async events(id: string, after = 0) {
    return this.prisma.knowledgeIngestionEvent.findMany({
      where: { jobId: id, seq: { gt: after } },
      orderBy: { seq: "asc" },
    });
  }
  subscribe(
    id: string,
    listener: (event: { seq: number; type: string; payload: unknown }) => void,
  ) {
    const set = this.listeners.get(id) ?? new Set();
    set.add(listener);
    this.listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(id);
    };
  }
  async cancel(id: string) {
    await this.prisma.knowledgeIngestionJob.update({
      where: { id },
      data: { cancelRequested: true },
    });
    return this.job(id);
  }
  async recover() {
    await this.prisma.knowledgeIngestionJob.updateMany({
      where: {
        status: {
          in: ["queued", "scanning", "parsing", "chunking", "committing"],
        },
      },
      data: { status: "interrupted", phase: "interrupted" },
    });
  }
  private async queue(sourceId: string) {
    await this.prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: "pending", errorCode: null },
    });
    const job = await this.prisma.knowledgeIngestionJob.create({
      data: { id: randomUUID(), sourceId },
    });
    queueMicrotask(() => void this.ingest(job.id));
    return job;
  }
  private async emit(jobId: string, type: string, payload: unknown) {
    const seq =
      (await this.prisma.knowledgeIngestionEvent.count({ where: { jobId } })) +
      1;
    await this.prisma.knowledgeIngestionEvent.create({
      data: { jobId, seq, type, payload: json(payload) },
    });
    for (const listener of this.listeners.get(jobId) ?? [])
      listener({ seq, type, payload });
  }
  private async ingest(jobId: string) {
    let sourceId: string | undefined;
    try {
      const job = await this.job(jobId);
      if (!job) return;
      const source = await this.prisma.knowledgeSource.findUniqueOrThrow({
        where: { id: job.sourceId },
      });
      sourceId = source.id;
      await this.prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: "indexing", errorCode: null },
      });
      await this.prisma.knowledgeIngestionJob.update({
        where: { id: jobId },
        data: { status: "scanning", phase: "scanning" },
      });
      await this.emit(jobId, "knowledge.job.started", {});
      const entries = await this.resolve(source);
      await this.prisma.knowledgeIngestionJob.update({
        where: { id: jobId },
        data: { total: entries.length, status: "parsing", phase: "parsing" },
      });
      let processed = 0;
      for (const entry of entries) {
        if ((await this.job(jobId))?.cancelRequested)
          return this.finishCancelled(jobId, source.id);
        await this.upsert(source.id, entry.path, entry.text);
        processed++;
        await this.prisma.knowledgeIngestionJob.update({
          where: { id: jobId },
          data: { processed },
        });
        await this.emit(jobId, "knowledge.job.progress", {
          phase: "parsing",
          processed,
          total: entries.length,
        });
      }
      await this.prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: "ready", lastIndexedAt: new Date() },
      });
      await this.prisma.knowledgeIngestionJob.update({
        where: { id: jobId },
        data: { status: "succeeded", phase: "committing", processed },
      });
      await this.emit(jobId, "knowledge.job.completed", { processed });
    } catch (e) {
      await this.prisma.knowledgeIngestionJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          phase: "failed",
          errorCode: "ingestion_failed",
        },
      });
      if (sourceId)
        await this.prisma.knowledgeSource.update({
          where: { id: sourceId },
          data: { status: "failed", errorCode: "ingestion_failed" },
        });
      await this.emit(jobId, "knowledge.job.failed", {
        error: "ingestion_failed",
      });
    }
  }
  private async finishCancelled(id: string, sourceId: string) {
    await this.prisma.knowledgeIngestionJob.update({
      where: { id },
      data: { status: "cancelled", phase: "cancelled" },
    });
    await this.prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: "pending" },
    });
    await this.emit(id, "knowledge.job.cancelled", {});
  }
  private async resolve(source: {
    type: string;
    uri: string | null;
    config: unknown;
  }) {
    if (source.type === "text")
      return [
        { path: "pasted.txt", text: (source.config as { text: string }).text },
      ];
    if (!source.uri) return [];
    const stat = await fs.stat(source.uri);
    if (stat.isFile())
      return [
        { path: basename(source.uri), text: await this.read(source.uri) },
      ];
    const files: string[] = [];
    const walk = async (d: string) => {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        if (
          e.name.startsWith(".") ||
          ["node_modules", "dist", "build"].includes(e.name)
        )
          continue;
        const p = resolve(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && ALLOWED.has(extname(e.name).toLowerCase()))
          files.push(p);
      }
    };
    await walk(source.uri);
    return Promise.all(
      files.map(async (p) => ({
        path: relative(source.uri!, p),
        text: await this.read(p),
      })),
    );
  }
  private async read(path: string) {
    const s = await fs.stat(path);
    if (s.size > LIMIT) throw new Error("file_too_large");
    return fs.readFile(path, "utf8");
  }
  private async safePath(path: string) {
    const root = await fs.realpath(this.workspaceRoot);
    const target = await fs.realpath(resolve(root, path));
    if (target !== root && !target.startsWith(`${root}/`))
      throw new Error("path_outside_workspace");
    return target;
  }
  private async upsert(sourceId: string, path: string, text: string) {
    const contentHash = hash(text);
    let doc = await this.prisma.knowledgeDocument.findUnique({
      where: { sourceId_logicalPath: { sourceId, logicalPath: path } },
    });
    if (doc?.contentHash === contentHash) return;
    if (doc) {
      await this.prisma.$executeRawUnsafe(
        "DELETE FROM knowledge_chunks_fts WHERE chunkId IN (SELECT id FROM knowledge_chunks WHERE documentId=?)",
        doc.id,
      );
      await this.prisma.knowledgeChunk.deleteMany({
        where: { documentId: doc.id },
      });
      doc = await this.prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: { contentHash, deletedAt: null, title: basename(path) },
      });
    } else
      doc = await this.prisma.knowledgeDocument.create({
        data: {
          id: randomUUID(),
          sourceId,
          logicalPath: path,
          title: basename(path),
          mimeType: "text/plain",
          contentHash,
          metadata: json({}),
        },
      });
    const blocks = text.split(/\n\s*\n/);
    let buffer = "",
      ordinal = 0;
    for (const block of blocks) {
      if ((buffer + "\n\n" + block).length > 2800 && buffer) {
        await this.chunk(doc.id, ordinal++, buffer);
        buffer = block;
      } else buffer += (buffer ? "\n\n" : "") + block;
    }
    if (buffer) await this.chunk(doc.id, ordinal, buffer);
  }
  private async chunk(documentId: string, ordinal: number, text: string) {
    const chunk = await this.prisma.knowledgeChunk.create({
      data: {
        id: randomUUID(),
        documentId,
        ordinal,
        text,
        tokenCount: Math.ceil(text.length / 4),
        locator: json({}),
        contentHash: hash(text),
        chunkerVersion: 1,
        indexVersion: 1,
      },
      include: { document: { include: { source: true } } },
    });
    await this.prisma.$executeRawUnsafe(
      "INSERT INTO knowledge_chunks_fts(chunkId,knowledgeBaseId,title,text) VALUES(?,?,?,?)",
      chunk.id,
      chunk.document.source.knowledgeBaseId,
      chunk.document.title,
      text,
    );
  }
}
