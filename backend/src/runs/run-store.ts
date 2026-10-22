import { type Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { RunEvent, RunStatus } from "../agent/events.js";
import type { Run } from "../agent/host-runtime.js";

export type StoredRun = Run;

export interface RunStore {
  getExecution?(userId: string, id: string): Promise<{ config: Record<string, unknown>; checkpoint: unknown; contextState: string; revision: number; titleSource?: string } | undefined>;
  saveCheckpoint?(userId: string, id: string, checkpoint: unknown, contextState: string): Promise<void>;
  generatedTitle?(userId: string, id: string, title: string): Promise<void>;
  findRequest?(userId: string, clientRequestId: string, requestHash: string): Promise<StoredRun | undefined>;
  create(run: StoredRun): Promise<void>;
  update(run: StoredRun): Promise<void>;
  transition(run: StoredRun, event: RunEvent): Promise<void>;
  appendEvent(event: RunEvent): Promise<void>;
  get(runId: string): Promise<StoredRun | undefined>;
  getLatestByConversation?(
    conversationId: string,
  ): Promise<StoredRun | undefined>;
  getConversationOwners?(conversationId: string): Promise<string[]>;
  getEvents(runId: string, afterSeq: number): Promise<RunEvent[]>;
  recoverInterrupted(): Promise<void>;
}

function toRunStatus(status: string): RunStatus {
  return status as RunStatus;
}

function asDate(value: string | undefined) {
  return value ? new Date(value) : undefined;
}

export class PrismaRunStore implements RunStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(run: StoredRun) {
    await this.prisma.run.create({
      data: {
        id: run.id,
        clientRequestId: run.clientRequestId,
        requestHash: run.requestHash,
        executionConfig: run.executionConfig as Prisma.InputJsonValue | undefined,
        userId: run.userId,
        projectId: run.projectId,
        conversationId: run.conversationId,
        agentId: run.agentId,
        agentFingerprint: run.agentFingerprint,
        skillPolicy: run.skillPolicy as Prisma.InputJsonValue | undefined,
        catalogFingerprint: run.catalogFingerprint,
        input: run.input,
        status: run.status,
        createdAt: new Date(run.createdAt),
      },
    });
  }

  async update(run: StoredRun) {
    await this.prisma.run.update({
      where: { id: run.id },
      data: {
        status: run.status,
        errorCode: run.errorCode,
        startedAt: asDate(run.startedAt),
        finishedAt: asDate(run.finishedAt),
      },
    });
  }

  async transition(run: StoredRun, event: RunEvent) {
    await this.prisma.$transaction([
      this.prisma.run.update({
        where: { id: run.id },
        data: {
          status: run.status,
          errorCode: run.errorCode,
          startedAt: asDate(run.startedAt),
          finishedAt: asDate(run.finishedAt),
        },
      }),
      this.prisma.runEvent.create({
        data: {
          runId: event.runId,
          seq: event.id,
          type: event.type,
          payload: event.payload as Prisma.InputJsonValue,
          createdAt: new Date(event.createdAt),
        },
      }),
    ]);
  }

  async appendEvent(event: RunEvent) {
    await this.prisma.runEvent.create({
      data: {
        runId: event.runId,
        seq: event.id,
        type: event.type,
        payload: event.payload as Prisma.InputJsonValue,
        createdAt: new Date(event.createdAt),
      },
    });
  }

  async get(runId: string): Promise<StoredRun | undefined> {
    const run = await this.prisma.run.findUnique({ where: { id: runId } });
    if (!run) return undefined;
    return {
      id: run.id,
      clientRequestId: run.clientRequestId ?? undefined,
      requestHash: run.requestHash ?? undefined,
      executionConfig: run.executionConfig as Record<string, unknown> | undefined,
      userId: run.userId,
      projectId: run.projectId,
      conversationId: run.conversationId,
      agentId: run.agentId,
      agentFingerprint: run.agentFingerprint,
      skillPolicy: run.skillPolicy,
      catalogFingerprint: run.catalogFingerprint,
      input: run.input,
      status: toRunStatus(run.status),
      ...(run.errorCode ? { errorCode: run.errorCode } : {}),
      createdAt: run.createdAt.toISOString(),
      ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
      ...(run.finishedAt ? { finishedAt: run.finishedAt.toISOString() } : {}),
    };
  }

  async getLatestByConversation(conversationId: string) {
    const row = await this.prisma.run.findFirst({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return row ? this.get(row.id) : undefined;
  }
  async getConversationOwners(conversationId: string) {
    const rows = await this.prisma.run.findMany({
      where: { conversationId },
      select: { userId: true },
      distinct: ["userId"],
    });
    return rows.map((row) => row.userId);
  }
  async getEvents(runId: string, afterSeq: number) {
    const events = await this.prisma.runEvent.findMany({
      where: { runId, seq: { gt: afterSeq } },
      orderBy: { seq: "asc" },
    });
    return events.map((event) => ({
      id: event.seq,
      runId: event.runId,
      type: event.type as RunEvent["type"],
      payload: event.payload as Record<string, unknown>,
      createdAt: event.createdAt.toISOString(),
    }));
  }

  async recoverInterrupted() {
    // Conversations, schedulers and active runs are in-process state; a second
    // backend sharing this database would mark the first one's runs here.
    const interrupted = await this.prisma.run.count({
      where: { status: { in: ["queued", "running", "awaiting_approval"] } },
    });
    if (interrupted)
      console.warn(
        `[Runs] Marked ${interrupted} in-flight runs as interrupted at startup — only one backend should run per database.`,
      );
    await this.prisma.run.updateMany({
      where: { status: { in: ["queued", "running", "awaiting_approval"] } },
      data: {
        status: "failed",
        errorCode: "interrupted",
        finishedAt: new Date(),
      },
    });
  }
}
