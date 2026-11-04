import { isDeepStrictEqual } from "node:util";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { PlatformError } from "../platform/errors.js";
import { PrismaRunStore, type StoredRun } from "../runs/run-store.js";
import type { RunEvent } from "../agent/events.js";
import type { MessageContent } from "./message.js";
import { LocalConversationStorage } from "./local-storage.js";
import { CosClient, type CosClientConfig } from "./cos-client.js";
import { CosConversationStorage, type CosObjectStore } from "./cos-storage.js";
import type { ConversationStorage } from "./storage.js";
import { StagingJournal, type StagedRecord } from "./staging.js";
import { createLogger } from "../logger.js";
import type { Conversation } from "../generated/prisma/client.js";

const logger = createLogger("Conversations");

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;

const terminalStatus = (status: string) =>
  ["succeeded", "failed", "cancelled"].includes(status);

export type ConversationStorageOptions = {
  /** 只决定新会话的目标介质；不覆盖已有会话的 messageStorage。 */
  conversationStorage?: "local" | "cos";
  cosPrefix?: string;
  cos?: CosClientConfig;
  /** 测试注入：代替真实 CosClient 的对象存储。 */
  cosObjectStore?: CosObjectStore;
  /** 跨容器重建保留的持久暂存日志（仅 COS 模式使用）。 */
  journal?: StagingJournal;
  /** GC 宽限期；必须大于允许的最长读取、提交时长。 */
  gcGraceMs?: number;
};

export class ConversationStore extends PrismaRunStore {
  readonly storage: LocalConversationStorage;
  private readonly cos?: ConversationStorage;
  private readonly cosImpl?: CosConversationStorage;
  private readonly journal?: StagingJournal;
  private readonly gcGraceMs: number;
  private readonly defaultMarker: "local-jsonl" | "cos-v1";
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: PrismaClient,
    storageRoot: string,
    options?: ConversationStorageOptions,
  ) {
    super(db);
    this.storage = new LocalConversationStorage(storageRoot);
    this.journal = options?.journal;
    this.gcGraceMs = options?.gcGraceMs ?? 86_400_000;
    this.defaultMarker =
      options?.conversationStorage === "cos" ? "cos-v1" : "local-jsonl";
    this.cosImpl =
      options?.cos || options?.cosObjectStore
        ? new CosConversationStorage(
            options.cosObjectStore ?? new CosClient(options.cos!),
            options.cosPrefix ?? "antler/conversations/v1",
            {
              journal: options.journal,
              recordGarbage: (conversationId, keys) => {
                void this.db.storageGarbageCandidate
                  .createMany({
                    data: keys.map((key) => ({ key, conversationId })),
                    skipDuplicates: true,
                  })
                  .catch(() => {});
              },
              onCommitPersisted: (record) => this.reconcileStaged(record),
            },
          )
        : undefined;
    this.cos = this.cosImpl;
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

  /** 按 messageStorage 标记路由；缺配置时报错，绝不把会话当作空历史。 */
  private storageFor(marker: string): ConversationStorage {
    if (marker === "cos-v1") {
      if (!this.cos) throw new PlatformError("storage_unavailable", 503);
      return this.cos;
    }
    return this.storage;
  }

  // Called under the conversation queue. Publish the backend marker only
  // after copying all legacy payloads successfully; a failed copy is retryable.
  // Checkpoints remain in Postgres as a sanitized recovery copy.
  private async ensureStored(row: Conversation): Promise<Conversation> {
    if (row.messageStorage !== "database") return row;
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
    const marker = this.defaultMarker;
    await this.storageFor(marker).importLegacy(
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
      data: { messageStorage: marker },
    });
    return { ...row, messageStorage: marker };
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
      let marker = this.defaultMarker as string;
      if (existing) {
        if (existing.userId !== run.userId || existing.deletedAt)
          throw new PlatformError("conversation_not_found", 404);
        marker = (await this.ensureStored(existing)).messageStorage;
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
                messageStorage: marker,
              },
            });
        await this.change(
          tx,
          run.userId,
          conversation.id,
          conversation.revision,
        );
      });
      // Never hold a database transaction open while performing storage IO.
      try {
        await this.storageFor(marker).create(run);
      } catch {
        logger.warn("initial message write failed", {
          conversationId: run.conversationId,
        });
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
        const stored = await this.ensureStored(row);
        const storage = this.storageFor(stored.messageStorage);
        let committed = false;
        let reconciled = false;
        let seq: number | undefined;
        try {
          seq = await storage.persist(owner, events, {
            onCommitPersisted: async (record) => {
              reconciled = true;
              await this.reconcileStaged(record);
            },
          });
          committed = true;
        } catch {
          logger.warn("conversation message write failed", {
            conversationId: row.id,
          });
        }
        // 暂存路径的数据库更新已在回调中完成；其余路径在此收尾。
        if (!reconciled) {
          await this.db.$transaction(async (tx) => {
            await this.lock(tx, owner.userId);
            if (run) await new PrismaRunStore(tx as PrismaClient).update(run);
            const terminal =
              run && terminalStatus(run.status);
            const conversation = await tx.conversation.update({
              where: { id: row.id },
              data: {
                revision: { increment: 1 },
                ...(terminal ? { activeRunId: null } : {}),
                // 诊断 hint：记录已确认的 COS 正文提交序号，不参与条件更新。
                ...(committed && seq !== undefined
                  ? { storageGeneration: seq }
                  : {}),
              },
            });
            await this.change(tx, owner.userId, row.id, conversation.revision);
          });
        }
        return;
      }
      await this.db.$transaction(async (tx) => {
        await this.lock(tx, owner.userId);
        if (run) await new PrismaRunStore(tx as PrismaClient).update(run);
      });
    });
  }

  /**
   * 暂存提交的数据库对账（docs/21 §4.3.3/§4.3.5）。须在持有会话队列时调用：
   * persist 回调与 recover() 的重放均已串行。
   * 以 storageGeneration（已对账正文水位）为幂等 guard，不可因 hint 落后回退历史。
   */
  private async reconcileStaged(record: StagedRecord) {
    const seq = record.manifest?.commitSeq;
    if (record.terminal) {
      const run = record.run;
      if (!run) return;
      const row = await this.db.conversation.findUnique({
        where: { id: run.conversationId },
      });
      if (!row || row.userId !== run.userId) return;
      const dbRun = await super.get(run.id);
      if (dbRun && !terminalStatus(dbRun.status)) {
        // 按持久终态意图补齐数据库事务，绝不生成 interrupted。
        await this.db.$transaction(async (tx) => {
          await this.lock(tx, run.userId);
          await new PrismaRunStore(tx as PrismaClient).update(run);
          const conversation = await tx.conversation.update({
            where: { id: run.conversationId },
            data: {
              revision: { increment: 1 },
              activeRunId: null,
              ...(seq !== undefined ? { storageGeneration: seq } : {}),
            },
          });
          await this.change(
            tx,
            run.userId,
            run.conversationId,
            conversation.revision,
          );
        });
      } else if (seq !== undefined && row.storageGeneration < seq) {
        await this.db.conversation.update({
          where: { id: run.conversationId },
          data: { storageGeneration: seq },
        });
      }
      return;
    }
    if (seq === undefined) return;
    const row = await this.db.conversation.findUnique({
      where: { id: record.conversationId },
    });
    if (
      !row ||
      row.userId !== record.userId ||
      row.storageGeneration >= seq
    )
      return;
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, record.userId);
      if (record.run)
        await new PrismaRunStore(tx as PrismaClient).update(record.run);
      const conversation = await tx.conversation.update({
        where: { id: record.conversationId },
        data: { revision: { increment: 1 }, storageGeneration: seq },
      });
      await this.change(
        tx,
        record.userId,
        record.conversationId,
        conversation.revision,
      );
    });
  }

  /**
   * 启动恢复（docs/21 §4.3.6/§4.5）：先按会话串行重放持久暂存并对账终态意图
   * （先于 recoverInterrupted），再处理删除任务与垃圾回收。
   */
  async recover() {
    if (this.cosImpl && this.journal) {
      for (const record of await this.journal.records()) {
        await this.serial(record.conversationId, async () => {
          try {
            await this.cosImpl!.replayRecord(record);
          } catch (error) {
            // 重放失败保留暂存，下次启动重试；期间该会话不得当作已恢复。
            logger.error("staged commit replay failed", {
              conversationId: record.conversationId,
              commitId: record.commitId,
              error,
            });
          }
        });
      }
    }
    await this.processDeletionTasks();
    await this.collectGarbage();
  }

  /** 删除任务工作器（docs/21 §4.5）：分阶段持久进度，崩溃后续跑；404 视为已删除。 */
  async processDeletionTasks(conversationId?: string) {
    const tasks = await this.db.conversationDeletionTask.findMany({
      where: {
        ...(conversationId ? { conversationId } : {}),
        stage: { not: "done" },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const task of tasks) {
      await this.serial(task.conversationId, () =>
        this.processDeletionTask(task),
      );
    }
  }

  /** 须在持有该会话队列时调用（remove 与 processDeletionTasks 均已串行）。 */
  private async processDeletionTask(task: {
    id: string;
    conversationId: string;
    userId: string;
    marker: string;
    keys: unknown;
    stage: string;
  }) {
    try {
      let stage = task.stage;
      let keys = (task.keys as string[] | null) ?? null;
      if (task.marker === "cos-v1" && this.cosImpl) {
        if (stage === "pending") {
          // 先读取 manifest 并持久记录可达键；读取失败保持待重试，不当空会话。
          keys = await this.cosImpl.reachableKeys(
            task.userId,
            task.conversationId,
          );
          await this.db.conversationDeletionTask.update({
            where: { id: task.id },
            data: { keys, stage: "deleting" },
          });
          stage = "deleting";
        }
        if (stage === "deleting") {
          for (const key of keys ?? [])
            await this.cosImpl.deleteObject(key);
          await this.db.conversationDeletionTask.update({
            where: { id: task.id },
            data: { stage: "manifest" },
          });
          stage = "manifest";
        }
        if (stage === "manifest") {
          await this.cosImpl.deleteManifest(
            task.userId,
            task.conversationId,
          );
          await this.db.conversationDeletionTask.update({
            where: { id: task.id },
            data: { stage: "done" },
          });
        }
      } else {
        await this.storage.remove(task.userId, task.conversationId);
        await this.db.conversationDeletionTask.update({
          where: { id: task.id },
          data: { stage: "done" },
        });
      }
      // 清除数据库 checkpoint 镜像（墓碑行的敏感载荷）。
      await this.db.conversation.update({
        where: { id: task.conversationId },
        data: { checkpoint: Prisma.DbNull, contextState: "not_restored" },
      });
    } catch (error) {
      await this.db.conversationDeletionTask
        .update({
          where: { id: task.id },
          data: {
            attempts: { increment: 1 },
            lastError: error instanceof Error ? error.message : String(error),
          },
        })
        .catch(() => {});
    }
  }

  /**
   * 协调式 GC（docs/21 §4.4）：只删除达到宽限期、且重新确认不被当前
   * manifest、在途删除任务或持久暂存引用的候选对象；由单 backend 调度，
   * 与写入/紧凑/删除共用会话串行队列，不要求 ListBucket 权限。
   */
  async collectGarbage() {
    if (!this.cosImpl) return;
    const cutoff = new Date(Date.now() - this.gcGraceMs);
    const candidates = await this.db.storageGarbageCandidate.findMany({
      where: { firstSeenAt: { lt: cutoff } },
      take: 100,
    });
    if (!candidates.length) return;
    const pendingTasks = await this.db.conversationDeletionTask.findMany({
      where: { stage: { not: "done" } },
    });
    const claimed = new Set(
      pendingTasks.flatMap((task) => (task.keys as string[] | null) ?? []),
    );
    const byConversation = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      const list = byConversation.get(candidate.conversationId) ?? [];
      list.push(candidate);
      byConversation.set(candidate.conversationId, list);
    }
    for (const [conversationId, items] of byConversation) {
      await this.serial(conversationId, async () => {
        const row = await this.db.conversation.findUnique({
          where: { id: conversationId },
        });
        if (!row) {
          // 会话行不存在的历史孤儿：仅受删除任务认领约束。
          for (const item of items) {
            if (claimed.has(item.key)) continue;
            try {
              await this.cosImpl!.deleteObject(item.key);
              await this.db.storageGarbageCandidate
                .delete({ where: { key: item.key } })
                .catch(() => {});
            } catch (error) {
              logger.warn("garbage collection failed", { conversationId, error });
            }
          }
          return;
        }
        const reachable = new Set(
          await this.cosImpl!.reachableKeys(row.userId, conversationId),
        );
        for (const item of items) {
          try {
            if (reachable.has(item.key)) {
              // 重新变为可达（重放复活）：撤销候选。
              await this.db.storageGarbageCandidate
                .delete({ where: { key: item.key } })
                .catch(() => {});
              continue;
            }
            if (claimed.has(item.key)) continue;
            if (this.journal && (await this.journal.references(item.key)))
              continue;
            await this.cosImpl!.deleteObject(item.key);
            await this.db.storageGarbageCandidate
              .delete({ where: { key: item.key } })
              .catch(() => {});
          } catch (error) {
            logger.warn("garbage collection failed", { conversationId, error });
          }
        }
      });
    }
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
    const row = await this.db.conversation.findUnique({
      where: { id: run.conversationId },
    });
    if (!row) return run;
    const stored = await this.ensureStored(row);
    run.input = await this.storageFor(stored.messageStorage).input(
      run.userId,
      run.conversationId,
      runId,
    );
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
      const stored = await this.ensureStored(row);
      return this.storageFor(stored.messageStorage).events(
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
      const stored = await this.ensureStored(row);
      const local = await this.storageFor(stored.messageStorage).checkpoint(
        userId,
        id,
      );
      const checkpoint = local?.checkpoint ?? row.checkpoint ?? null;
      return {
        config: row.executionConfig as Record<string, unknown>,
        checkpoint,
        contextState: local?.contextState ?? (checkpoint ? row.contextState : "not_restored"),
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
    runId?: string,
  ) {
    await this.serial(id, async () => {
      const row = await this.owned(userId, id);
      const stored = await this.ensureStored(row);
      try {
        await this.storageFor(stored.messageStorage).saveCheckpoint(
          userId,
          id,
          checkpoint,
          contextState,
          runId,
        );
      } catch (error) {
        // The database mirror preserves safe contexts when the storage backend
        // is temporarily unavailable or has been recreated.
        logger.warn("conversation checkpoint persistence failed", { conversationId: id, error });
      }
      await this.db.conversation.update({
        where: { id },
        data: { checkpoint: json(checkpoint), contextState },
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
      row.messageStorage !== "database" &&
      row.contextState === "available" &&
      !row.checkpoint
    ) {
      try {
        if (!(await this.storageFor(row.messageStorage).checkpoint(userId, id))) {
          logger.warn(
            "context downgrade: contextState=available but storage checkpoint and database mirror are both missing",
            { conversationId: id },
          );
          detail.contextState = "not_restored";
        }
      } catch (error) {
        logger.warn("checkpoint availability check failed", {
          conversationId: id,
          error,
        });
      }
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
      const stored = await this.ensureStored(conversation);
      const page = await this.storageFor(stored.messageStorage).page(
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
    const runId = await this.serial(id, async () => {
      const { runId } = await this.db.$transaction(async (tx) => {
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
        // 墓碑、变更事件与唯一删除任务在同一事务写入；墓碑阻止新提交
        // 与暂存重放复活会话。
        const existing = await tx.conversationDeletionTask.findFirst({
          where: { conversationId: id, stage: { not: "done" } },
        });
        if (!existing)
          await tx.conversationDeletionTask.create({
            data: { conversationId: id, userId, marker: row.messageStorage },
          });
        return { runId: row.activeRunId };
      });
      return runId;
    });
    // 墓碑已持久；工作器与该会话后续操作串行，各阶段可重试。
    await this.processDeletionTasks(id);
    return runId;
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
      let events: RunEvent[];
      try {
        events = await this.getEvents(row.id, 0);
      } catch (error) {
        // 存储读取失败无法判断终态：保持运行中并重试，不猜测终态。
        logger.error("interrupted-recovery storage read failed", {
          runId: row.id,
          error,
        });
        continue;
      }
      const terminalEvent = events.find((event) =>
        ["run.completed", "run.failed", "run.cancelled"].includes(event.type),
      );
      if (terminalEvent) {
        // 存储已含真实终态（docs/21 §4.3.6）：按终态补齐数据库，绝不生成 interrupted。
        const status =
          terminalEvent.type === "run.completed"
            ? "succeeded"
            : terminalEvent.type === "run.cancelled"
              ? "cancelled"
              : "failed";
        const error = terminalEvent.payload.error as
          | { code?: unknown; message?: unknown }
          | undefined;
        await this.db.$transaction(async (tx) => {
          await this.lock(tx, run.userId);
          await new PrismaRunStore(tx as PrismaClient).update({
            ...run,
            status,
            errorCode:
              typeof error?.code === "string" ? error.code : run.errorCode,
            finishedAt: terminalEvent.createdAt,
          });
          const conversation = await tx.conversation.update({
            where: { id: run.conversationId },
            data: { revision: { increment: 1 }, activeRunId: null },
          });
          await this.change(
            tx,
            run.userId,
            run.conversationId,
            conversation.revision,
          );
        });
        continue;
      }
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
