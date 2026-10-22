import { isDeepStrictEqual } from "node:util";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { PlatformError } from "../platform/errors.js";
import { PrismaRunStore, type StoredRun } from "../runs/run-store.js";
import type { RunEvent } from "../agent/events.js";
import { projectEvent, type MessageContent } from "./message.js";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;

export class ConversationStore extends PrismaRunStore {
  constructor(private readonly db: PrismaClient) {
    super(db);
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
        throw new PlatformError("conversation_execution_config_mismatch", 409);
      await new PrismaRunStore(tx as PrismaClient).create(run);
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
              executionConfig: json(
                run.executionConfig ?? { schemaVersion: 1 },
              ),
              activeRunId: run.id,
            },
          });
      const last = await tx.conversationMessage.aggregate({
        where: { conversationId: run.conversationId },
        _max: { seq: true },
      });
      const seq = last._max.seq ?? 0;
      await tx.conversationMessage.createMany({
        data: [
          {
            id: `${run.id}:user`,
            userId: run.userId,
            conversationId: run.conversationId,
            runId: run.id,
            seq: seq + 1,
            role: "user",
            content: json({
              schemaVersion: 1,
              parts: [{ type: "text", text: run.input }],
            }),
            status: "complete",
          },
          {
            id: `${run.id}:assistant`,
            userId: run.userId,
            conversationId: run.conversationId,
            runId: run.id,
            seq: seq + 2,
            role: "assistant",
            content: json({ schemaVersion: 1, parts: [] }),
            status: "running",
          },
        ],
      });
      await this.change(tx, run.userId, conversation.id, conversation.revision);
    });
  }
  private async persist(event: RunEvent, run?: StoredRun) {
    const owner = run ?? (await this.get(event.runId));
    if (!owner) throw new Error("run_not_found");
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, owner.userId);
      const base = new PrismaRunStore(tx as PrismaClient);
      if (run)
        await tx.run.update({
          where: { id: run.id },
          data: {
            status: run.status,
            errorCode: run.errorCode,
            startedAt: run.startedAt ? new Date(run.startedAt) : undefined,
            finishedAt: run.finishedAt ? new Date(run.finishedAt) : undefined,
          },
        });
      await base.appendEvent(event);
      const message = await tx.conversationMessage.findUnique({
        where: { runId_role: { runId: event.runId, role: "assistant" } },
      });
      if (!message) return;
      if (message.appliedEventId >= event.id) return;
      // Replay the complete missing interval, never skip a persisted event.
      const events = await base.getEvents(event.runId, message.appliedEventId);
      let content = message.content as unknown as MessageContent;
      for (const item of events) content = projectEvent(content, item);
      await tx.conversationMessage.update({
        where: { id: message.id },
        data: {
          content: json(content),
          appliedEventId: events.at(-1)?.id ?? message.appliedEventId,
          status: run?.status ?? message.status,
        },
      });
      const terminal =
        run && ["succeeded", "failed", "cancelled"].includes(run.status);
      const conversation = await tx.conversation.update({
        where: { id: message.conversationId },
        data: {
          revision: { increment: 1 },
          ...(terminal ? { activeRunId: null } : {}),
        },
      });
      if (!conversation.deletedAt)
        await this.change(
          tx,
          owner.userId,
          conversation.id,
          conversation.revision,
        );
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
    return this.persist(event);
  }
  override transition(run: StoredRun, event: RunEvent) {
    return this.persist(event, run);
  }

  async getExecution(userId: string, id: string) {
    const row = await this.db.conversation.findUnique({ where: { id } });
    if (!row) return undefined;
    if (row.userId !== userId || row.deletedAt)
      throw new PlatformError("conversation_not_found", 404);
    return {
      config: row.executionConfig as Record<string, unknown>,
      checkpoint: row.checkpoint,
      contextState: row.contextState,
      revision: row.revision,
      titleSource: row.titleSource,
    };
  }
  async saveCheckpoint(
    userId: string,
    id: string,
    checkpoint: unknown,
    contextState: string,
  ) {
    await this.db.conversation.updateMany({
      where: { id, userId, deletedAt: null },
      data: { checkpoint: json(checkpoint), contextState },
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
    const { checkpoint: _checkpoint, ...detail } = row;
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
    return this.db.$transaction(
      async (tx) => {
        const conversation = await tx.conversation.findFirst({
          where: { id, userId, deletedAt: null },
        });
        if (!conversation)
          throw new PlatformError("conversation_not_found", 404);
        const rows = await tx.conversationMessage.findMany({
          where: {
            conversationId: id,
            userId,
            seq: {
              ...(beforeSeq ? { lt: beforeSeq } : {}),
              ...(afterSeq !== undefined ? { gt: afterSeq } : {}),
            },
          },
          orderBy: { seq: afterSeq !== undefined ? "asc" : "desc" },
          take: limit + 1,
        });
        return {
          messages: rows.slice(0, limit).sort((a, b) => a.seq - b.seq),
          hasMore: rows.length > limit,
          revision: conversation.revision,
          activeRunId: conversation.activeRunId,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
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
    return this.db.$transaction(async (tx) => {
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
