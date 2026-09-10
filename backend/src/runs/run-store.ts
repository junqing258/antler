import { type Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { RunEvent, RunStatus } from "../agent/events.js";
import type { Run } from "../agent/host-runtime.js";

export type StoredRun = Run;

export interface RunStore {
  create(run: StoredRun): Promise<void>;
  update(run: StoredRun): Promise<void>;
  transition(run: StoredRun, event: RunEvent): Promise<void>;
  appendEvent(event: RunEvent): Promise<void>;
  get(runId: string): Promise<StoredRun | undefined>;
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
        projectId: run.projectId,
        conversationId: run.conversationId,
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
      projectId: run.projectId,
      conversationId: run.conversationId,
      input: run.input,
      status: toRunStatus(run.status),
      ...(run.errorCode ? { errorCode: run.errorCode } : {}),
      createdAt: run.createdAt.toISOString(),
      ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
      ...(run.finishedAt ? { finishedAt: run.finishedAt.toISOString() } : {}),
    };
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
