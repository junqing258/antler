import { isDeepStrictEqual } from "node:util";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { PlatformError } from "../platform/errors.js";
import { PrismaRunStore, type StoredRun } from "../runs/run-store.js";
import type { RunEvent } from "../agent/events.js";
import type { MessageContent } from "./message.js";
import { LocalConversationStorage } from "./local-storage.js";
import type { Conversation } from "../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;

export class ConversationStore extends PrismaRunStore {
  readonly storage: LocalConversationStorage;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: PrismaClient,
    storageRoot: string,
  ) {
    super(db);
    this.storage = new LocalConversationStorage(storageRoot);
  }

  private async serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(work);
    this.queues.set(id, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(id) === next) this.queues.delete(id);
    }
  }

  // Called under the conversation queue. Publish the backend marker only
  // after copying all legacy payloads successfully; a failed copy is retryable.
  private async ensureLocal(row: Conversation) {
    if (row.messageStorage === "local-jsonl") return;
    const [messages, events] = await Promise.all([
      this.db.conversationMessage.findMany({
        where: { conversationId: row.id, userId: row.userId },
        orderBy: { seq: "asc" },
      }),
      this.db.runEvent.findMany({
        where: { run: { conversationId: row.id, userId: row.userId } },
        orderBy: { seq: "asc" },
      }),
    ]);
    await this.storage.importLegacy(
      row.userId,
      row.id,
      messages.map((message) => ({
        ...message,
        content: message.content as unknown as MessageContent,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
      })),
      events.map((event) => ({
        id: event.seq,
        runId: event.runId,
        type: event.type as RunEvent["type"],
        payload: event.payload as Record<string, unknown>,
        createdAt: event.createdAt.toISOString(),
      })),
      row.checkpoint,
      row.contextState,
    );
    await this.db.conversation.update({
      where: { id: row.id },
      data: { messageStorage: "local-jsonl", checkpoint: Prisma.DbNull },
    });
  }

  private async owned(userId: string, id: string) {
    const row = await this.db.conversation.findUnique({ where: { id } });
    if (!row || row.userId !== userId || row.deletedAt)
      throw new PlatformError("conversation_not_found", 404);
    return row;
  }

  /** Upsert acquires the per-user row lock and holds it until commit. */
  private async lock(tx: Tx, userId: string) {
    return tx.conversationSyncState.upsert({
      where: { userId },
      create: { userId },
      update: { lastChangeId: { increment: 0 } },
    });
  }
  private async change(
    tx: Tx,
    userId: string,
    conversationId: string,
    revision: number,
    type = "updated",
  ) {
    const state = await tx.conversationSyncState.update({
      where: { userId },
      data: { lastChangeId: { increment: 1 } },
    });
    await tx.conversationChange.create({
      data: {
        userId,
        conversationId,
        revision,
        type,
        changeId: state.lastChangeId,
      },
    });
  }
  async findRequest(
    userId: string,
    clientRequestId: string,
    requestHash: string,
  ) {
    const row = await this.db.run.findUnique({
      where: { userId_clientRequestId: { userId, clientRequestId } },
    });
    if (!row) return undefined;
    if (row.requestHash !== requestHash)
      throw new PlatformError("client_request_conflict", 409);
    return this.get(row.id);
  }
  override async create(run: StoredRun) {
    await this.serial(run.conversationId, async () => {
      const existing = await this.db.conversation.findUnique({
        where: { id: run.conversationId },
      });
      if (existing) {
        if (existing.userId !== run.userId || existing.deletedAt)
          throw new PlatformError("conversation_not_found", 404);
        await this.ensureLocal(existing);
      }
      await this.db.$transaction(async (tx) => {
        await this.lock(tx, run.userId);
        const current = await tx.conversation.findUnique({
          where: { id: run.conversationId },
        });
        if (current && (current.userId !== run.userId || current.deletedAt))
          throw new PlatformError("conversation_not_found", 404);
        if (current?.activeRunId)
          throw new PlatformError("conversation_busy", 409);
        if (
          run.expectedRevision !== undefined &&
          (current?.revision ?? 0) !== run.expectedRevision
        )
          throw new PlatformError("conversation_revision_conflict", 409);
        if (
          current &&
          !isDeepStrictEqual(current.executionConfig, run.executionConfig)
        )
          throw new PlatformError(
            "conversation_execution_config_mismatch",
            409,
          );
        await new PrismaRunStore(tx as PrismaClient).create({
          ...run,
          input: "",
        });
        const conversation = current
          ? await tx.conversation.update({
              where: { id: current.id },
              data: {
                revision: { increment: 1 },
                activeRunId: run.id,
                lastMessageAt: new Date(),
              },
            })
          : await tx.conversation.create({
              data: {
                id: run.conversationId,
                userId: run.userId,
                agentId: run.agentId,
                title: run.input.slice(0, 48),
                activeRunId: run.id,
                executionConfig: json(
                  run.executionConfig ?? { schemaVersion: 1 },
                ),
                messageStorage: "local-jsonl",
              },
            });
        await this.change(
          tx,
          run.userId,
          conversation.id,
          conversation.revision,
        );
      });
      // Never hold a database transaction open while performing filesystem IO.
      try {
        await this.storage.create(run);
      } catch {
        console.warn(
          `[Conversations] Initial message write failed for ${run.conversationId}`,
        );
      }
    });
  }

  private async persist(events: RunEvent[], run?: StoredRun) {
    const event = events.at(-1);
    if (!event) return;
    const owner = run ?? (await this.get(event.runId));
    if (!owner) throw new Error("run_not_found");
    await this.serial(owner.conversationId, async () => {
      const row = await this.db.conversation.findUnique({
        where: { id: owner.conversationId },
      });
      if (!row || row.userId !== owner.userId)
        throw new PlatformError("conversation_not_found", 404);
      if (!row.deletedAt) {
        await this.ensureLocal(row);
        try {
          await this.storage.persist(owner, events);
        } catch {
          console.warn(
            `[Conversations] Local message write failed for ${row.id}`,
          );
        }
      }
      // Only metadata and synchronization cursors touch Postgres. Message
      // bodies, event payloads and checkpoints are exclusively local.
      await this.db.$transaction(async (tx) => {
        await this.lock(tx, owner.userId);
        if (run) await new PrismaRunStore(tx as PrismaClient).update(run);
        if (row.deletedAt) return;
        const terminal =
          run && ["succeeded", "failed", "cancelled"].includes(run.status);
        const conversation = await tx.conversation.update({
          where: { id: row.id },
          data: {
            revision: { increment: 1 },
            ...(terminal ? { activeRunId: null } : {}),
          },
        });
        await this.change(tx, owner.userId, row.id, conversation.revision);
      });
    });
  }

  override async update(run: StoredRun) {
    if (["failed", "cancelled", "succeeded"].includes(run.status)) {
      const events = await this.getEvents(run.id, 0);
      await this.transition(run, {
        id: (events.at(-1)?.id ?? 0) + 1,
        runId: run.id,
        type:
          run.status === "succeeded"
            ? "run.completed"
            : run.status === "cancelled"
              ? "run.cancelled"
              : "run.failed",
        payload: { status: run.status, error: { code: run.errorCode } },
        createdAt: run.finishedAt ?? new Date().toISOString(),
      });
    } else await super.update(run);
  }
  override appendEvent(event: RunEvent) {
    return this.persist([event]);
  }
  override appendEvents(events: RunEvent[]) {
    return this.persist(events);
  }
  override transition(run: StoredRun, event: RunEvent) {
    return this.persist([event], run);
  }

  override async get(runId: string): Promise<StoredRun | undefined> {
    const run = await super.get(runId);
    if (!run || run.input) return run;
    run.input = await this.storage.input(run.userId, run.conversationId, runId);
    return run;
  }

  override async getEvents(runId: string, afterSeq: number) {
    const run = await this.get(runId);
    if (!run) return [];
    return this.serial(run.conversationId, async () => {
      const row = await this.db.conversation.findUnique({
        where: { id: run.conversationId },
      });
      if (!row || row.userId !== run.userId || row.deletedAt) return [];
      await this.ensureLocal(row);
      return this.storage.events(
        run.userId,
        run.conversationId,
        runId,
        afterSeq,
      );
    });
  }

  async getExecution(userId: string, id: string) {
    return this.serial(id, async () => {
      const row = await this.db.conversation.findUnique({ where: { id } });
      if (!row) return undefined;
      if (row.userId !== userId || row.deletedAt)
        throw new PlatformError("conversation_not_found", 404);
      await this.ensureLocal(row);
      const local = await this.storage.checkpoint(userId, id);
      return {
        config: row.executionConfig as Record<string, unknown>,
        checkpoint: local?.checkpoint ?? null,
        contextState: local?.contextState ?? "not_restored",
        revision: row.revision,
        titleSource: row.titleSource,
      };
    });
  }

  async saveCheckpoint(
    userId: string,
    id: string,
    checkpoint: unknown,
    contextState: string,
  ) {
    await this.serial(id, async () => {
      const row = await this.owned(userId, id);
      await this.ensureLocal(row);
      await this.storage.saveCheckpoint(userId, id, checkpoint, contextState);
      await this.db.conversation.update({
        where: { id },
        data: { checkpoint: Prisma.DbNull, contextState },
      });
    });
  }
  async generatedTitle(userId: string, id: string, title: string) {
    await this.title(userId, id, title, undefined, true);
  }
  async detail(userId: string, id: string) {
    const row = await this.db.conversation.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!row) return null;
    const {
      checkpoint: _checkpoint,
      messageStorage: _storage,
      ...detail
    } = row;
    if (
      row.messageStorage === "local-jsonl" &&
      row.contextState === "available" &&
      !(await this.storage.checkpoint(userId, id))
    ) {
      detail.contextState = "not_restored";
    }
    return detail;
  }
  async list(userId: string, limit: number, cursor?: string, agentId?: string) {
    return this.db.$transaction(
      async (tx) => {
        const state = await tx.conversationSyncState.findUnique({
          where: { userId },
        });
        let boundary: { time: string; id: string } | undefined;
        if (cursor) {
          try {
            boundary = JSON.parse(
              Buffer.from(cursor, "base64url").toString("utf8"),
            );
          } catch {
            throw new PlatformError("invalid_cursor", 400);
          }
          if (
            !boundary ||
            typeof boundary.id !== "string" ||
            !Number.isFinite(Date.parse(boundary.time))
          )
            throw new PlatformError("invalid_cursor", 400);
        }
        const rows = await tx.conversation.findMany({
          where: {
            userId,
            deletedAt: null,
            ...(agentId ? { agentId } : {}),
            ...(boundary
              ? {
                  OR: [
                    { lastMessageAt: { lt: new Date(boundary.time) } },
                    {
                      lastMessageAt: new Date(boundary.time),
                      id: { lt: boundary.id },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          select: {
            id: true,
            userId: true,
            agentId: true,
            title: true,
            titleSource: true,
            revision: true,
            activeRunId: true,
            createdAt: true,
            updatedAt: true,
            lastMessageAt: true,
          },
        });
        return {
          conversations: rows.slice(0, limit),
          nextCursor:
            rows.length > limit
              ? Buffer.from(
                  JSON.stringify({
                    time: rows[limit - 1].lastMessageAt.toISOString(),
                    id: rows[limit - 1].id,
                  }),
                ).toString("base64url")
              : null,
          lastChangeId: state?.lastChangeId ?? 0,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async messages(
    userId: string,
    id: string,
    limit: number,
    beforeSeq?: number,
    afterSeq?: number,
  ) {
    return this.serial(id, async () => {
      const conversation = await this.owned(userId, id);
      await this.ensureLocal(conversation);
      const page = await this.storage.page(
        userId,
        id,
        limit,
        beforeSeq,
        afterSeq,
      );
      return {
        ...page,
        revision: conversation.revision,
        activeRunId: conversation.activeRunId,
      };
    });
  }
  async title(
    userId: string,
    id: string,
    title: string,
    expectedRevision?: number,
    generated = false,
  ) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, userId);
      const current = await tx.conversation.findFirst({
        where: { id, userId, deletedAt: null },
      });
      if (!current) throw new PlatformError("conversation_not_found", 404);
      if (generated && current.titleSource !== "fallback")
        return { ...current, checkpoint: undefined };
      if (!generated && expectedRevision !== current.revision)
        throw new PlatformError("conversation_revision_conflict", 409, {
          conversation: { ...current, checkpoint: undefined },
        });
      const row = await tx.conversation.update({
        where: { id },
        data: {
          title,
          titleSource: generated ? "generated" : "manual",
          revision: { increment: 1 },
        },
      });
      await this.change(tx, userId, id, row.revision);
      return { ...row, checkpoint: undefined };
    });
  }
  async remove(userId: string, id: string) {
    return this.serial(id, async () => {
      const runId = await this.db.$transaction(async (tx) => {
        await this.lock(tx, userId);
        const row = await tx.conversation.findFirst({ where: { id, userId } });
        if (!row) throw new PlatformError("conversation_not_found", 404);
        if (!row.deletedAt) {
          const updated = await tx.conversation.update({
            where: { id },
            data: { deletedAt: new Date(), revision: { increment: 1 } },
          });
          await this.change(tx, userId, id, updated.revision, "deleted");
        }
        return row.activeRunId;
      });
      await this.storage.remove(userId, id);
      return runId;
    });
  }
  async syncBounds(userId: string) {
    const [state, first] = await Promise.all([
      this.db.conversationSyncState.findUnique({ where: { userId } }),
      this.db.conversationChange.findFirst({
        where: { userId },
        orderBy: { changeId: "asc" },
        select: { changeId: true },
      }),
    ]);
    return {
      lastChangeId: state?.lastChangeId ?? 0,
      firstChangeId: first?.changeId ?? 1,
    };
  }
  async changes(userId: string, afterChangeId: number) {
    return this.db.conversationChange.findMany({
      where: { userId, changeId: { gt: afterChangeId } },
      orderBy: { changeId: "asc" },
      take: 100,
    });
  }
  override async recoverInterrupted() {
    const rows = await this.db.run.findMany({
      where: { status: { in: ["queued", "running", "awaiting_approval"] } },
    });
    for (const row of rows) {
      const run = (await this.get(row.id))!;
      const events = await this.getEvents(row.id, 0);
      run.status = "failed";
      run.errorCode = "interrupted";
      run.finishedAt = new Date().toISOString();
      await this.transition(run, {
        id: (events.at(-1)?.id ?? 0) + 1,
        runId: run.id,
        type: "run.failed",
        payload: {
          status: "failed",
          error: { code: "interrupted", message: "服务重启，运行已中断。" },
        },
        createdAt: run.finishedAt,
      });
    }
  }
}
