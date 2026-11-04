import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { RunEvent } from "../agent/events.js";
import type { StoredRun } from "../runs/run-store.js";
import { projectEvent, type MessageContent } from "./message.js";

export type LocalMessage = {
  id: string;
  conversationId: string;
  userId: string;
  seq: number;
  runId: string;
  role: string;
  content: MessageContent;
  status: string;
  appliedEventId: number;
  error?: { code?: string; message: string };
  createdAt: string;
  updatedAt: string;
};
type Batch = { version: 1; messages: LocalMessage[]; events: RunEvent[] };
type Checkpoint = { checkpoint: unknown; contextState: string };
function applyFailures(
  messages: Map<string, LocalMessage>,
  events: RunEvent[],
) {
  for (const event of events) {
    if (event.type !== "run.failed") continue;
    const message = messages.get(`${event.runId}:assistant`);
    const error = event.payload.error as
      { code?: unknown; message?: unknown } | undefined;
    if (message && typeof error?.message === "string") {
      message.error = {
        ...(typeof error.code === "string" ? { code: error.code } : {}),
        message: error.message,
      };
    }
  }
}
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/** Single-backend local history. Each newline commits one complete batch. */
export class LocalConversationStorage {
  private readonly root: string;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly cache = new Map<string, Map<string, LocalMessage>>();

  constructor(root: string) {
    this.root = resolve(root);
  }

  directory(userId: string, conversationId: string) {
    const key = createHash("sha256")
      .update(JSON.stringify([userId, conversationId]))
      .digest("hex");
    return join(this.root, key);
  }

  private async serial<T>(
    directory: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const next = (this.queues.get(directory) ?? Promise.resolve())
      .catch(() => {})
      .then(work);
    this.queues.set(directory, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(directory) === next) this.queues.delete(directory);
    }
  }

  private async prepare(directory: string) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }

  private async atomic(path: string, value: string) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, value, { mode: 0o600, flag: "wx" });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async *records(directory: string): AsyncGenerator<Batch> {
    let handle;
    try {
      handle = await open(join(directory, "messages.jsonl"), "r");
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
    let complete = false;
    try {
      const { size } = await handle.stat();
      if (!size) return;
      const byte = Buffer.alloc(1);
      await handle.read(byte, 0, 1, size - 1);
      complete = byte[0] === 10;
    } finally {
      await handle.close();
    }
    const stream = createReadStream(join(directory, "messages.jsonl"), {
      encoding: "utf8",
    });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let previous: string | undefined;
    try {
      for await (const line of lines) {
        if (previous) yield JSON.parse(previous) as Batch;
        previous = line;
      }
      // A killed append can leave a partial UTF-8/JSON tail. Only newline-
      // terminated batches are committed, even if the final JSON parses.
      if (complete && previous) yield JSON.parse(previous) as Batch;
    } finally {
      lines.close();
      stream.destroy();
    }
  }

  private remember(directory: string, messages: Map<string, LocalMessage>) {
    this.cache.delete(directory);
    this.cache.set(directory, messages);
    if (this.cache.size > 32)
      this.cache.delete(this.cache.keys().next().value!);
  }

  private async state(directory: string) {
    const cached = this.cache.get(directory);
    if (cached) {
      this.remember(directory, cached);
      return cached;
    }
    const messages = new Map<string, LocalMessage>();
    for await (const batch of this.records(directory)) {
      if (batch.version !== 1)
        throw new Error("unsupported_conversation_storage_version");
      for (const message of batch.messages) messages.set(message.id, message);
      applyFailures(messages, batch.events);
    }
    this.remember(directory, messages);
    return messages;
  }

  private async append(directory: string, batch: Batch) {
    await this.prepare(directory);
    const handle = await open(join(directory, "messages.jsonl"), "a+", 0o600);
    try {
      // Remove an incomplete previous batch before appending a new one.
      let end = (await handle.stat()).size;
      const originalEnd = end;
      const chunk = Buffer.alloc(4096);
      while (end) {
        const start = Math.max(0, end - chunk.length);
        const { bytesRead } = await handle.read(chunk, 0, end - start, start);
        const newline = chunk.subarray(0, bytesRead).lastIndexOf(10);
        if (newline >= 0) {
          end = start + newline + 1;
          break;
        }
        end = start;
      }
      if (end !== originalEnd) await handle.truncate(end);
      await handle.writeFile(`${JSON.stringify(batch)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    const messages = new Map(await this.state(directory));
    for (const message of batch.messages) messages.set(message.id, message);
    this.remember(directory, messages);
  }

  private initial(run: StoredRun, seq: number): LocalMessage[] {
    const common = {
      conversationId: run.conversationId,
      userId: run.userId,
      runId: run.id,
      appliedEventId: 0,
      createdAt: run.createdAt,
      updatedAt: run.createdAt,
    };
    return [
      {
        ...common,
        id: `${run.id}:user`,
        seq: seq + 1,
        role: "user",
        status: "complete",
        content: {
          schemaVersion: 1,
          parts: [{ type: "text", text: run.input }],
        },
      },
      {
        ...common,
        id: `${run.id}:assistant`,
        seq: seq + 2,
        role: "assistant",
        status: run.status,
        content: { schemaVersion: 1, parts: [] },
      },
    ];
  }

  async create(run: StoredRun) {
    const directory = this.directory(run.userId, run.conversationId);
    await this.serial(directory, async () => {
      const messages = await this.state(directory);
      if (messages.has(`${run.id}:user`)) return;
      const seq = [...messages.values()].reduce(
        (max, message) => Math.max(max, message.seq),
        0,
      );
      await this.append(directory, {
        version: 1,
        messages: this.initial(run, seq),
        events: [],
      });
    });
  }

  async persist(run: StoredRun, events: RunEvent[]) {
    const directory = this.directory(run.userId, run.conversationId);
    await this.serial(directory, async () => {
      const messages = await this.state(directory);
      const existing = messages.get(`${run.id}:assistant`);
      const initial = existing
        ? []
        : this.initial(
            run,
            [...messages.values()].reduce(
              (max, message) => Math.max(max, message.seq),
              0,
            ),
          );
      const message = structuredClone(existing ?? initial[1]);
      const pending = events.filter(
        (event) => event.runId === run.id && event.id > message.appliedEventId,
      );
      if (!pending.length) return;
      for (const event of pending)
        message.content = projectEvent(message.content, event);
      message.appliedEventId = pending.at(-1)!.id;
      applyFailures(new Map([[message.id, message]]), pending);
      message.status = run.status;
      message.updatedAt = pending.at(-1)!.createdAt;
      await this.append(directory, {
        version: 1,
        messages: [...initial.filter((item) => item.role === "user"), message],
        events: pending,
      });
      if (["succeeded", "failed", "cancelled"].includes(run.status)) {
        // Keep event replay, but remove obsolete full-message snapshots after
        // a run finishes so long streams do not grow the file quadratically.
        try {
          await this.compact(directory);
        } catch {
          console.warn(
            `[Conversations] History compaction failed for ${run.conversationId}`,
          );
        }
      }
    });
  }

  private async compact(directory: string) {
    const path = join(directory, "messages.jsonl");
    const temporary = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      const messages = [...(await this.state(directory)).values()];
      await handle.writeFile(
        `${JSON.stringify({ version: 1, messages, events: [] })}\n`,
      );
      for await (const batch of this.records(directory)) {
        if (batch.events.length) {
          await handle.writeFile(
            `${JSON.stringify({ version: 1, messages: [], events: batch.events })}\n`,
          );
        }
      }
      await handle.close();
      await rename(temporary, path);
    } finally {
      await handle.close();
      await rm(temporary, { force: true });
    }
  }

  async messages(userId: string, id: string) {
    const directory = this.directory(userId, id);
    return this.serial(directory, async () =>
      structuredClone(
        [...(await this.state(directory)).values()].sort(
          (a, b) => a.seq - b.seq,
        ),
      ),
    );
  }

  async input(userId: string, id: string, runId: string) {
    const directory = this.directory(userId, id);
    return this.serial(directory, async () => {
      const message = (await this.state(directory)).get(`${runId}:user`);
      return (
        message?.content.parts
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("") ?? ""
      );
    });
  }

  async page(
    userId: string,
    id: string,
    limit: number,
    beforeSeq?: number,
    afterSeq?: number,
  ) {
    const directory = this.directory(userId, id);
    return this.serial(directory, async () => {
      const rows = [...(await this.state(directory)).values()]
        .filter(
          (message) =>
            (beforeSeq === undefined || message.seq < beforeSeq) &&
            (afterSeq === undefined || message.seq > afterSeq),
        )
        .sort((a, b) =>
          afterSeq === undefined ? b.seq - a.seq : a.seq - b.seq,
        );
      return {
        messages: structuredClone(
          rows.slice(0, limit).sort((a, b) => a.seq - b.seq),
        ),
        hasMore: rows.length > limit,
      };
    });
  }

  async events(userId: string, id: string, runId: string, after: number) {
    const directory = this.directory(userId, id);
    return this.serial(directory, async () => {
      const events = new Map<number, RunEvent>();
      for await (const batch of this.records(directory)) {
        for (const event of batch.events) {
          if (event.runId === runId && event.id > after)
            events.set(event.id, event);
        }
      }
      return [...events.values()].sort((a, b) => a.id - b.id);
    });
  }

  async checkpoint(
    userId: string,
    id: string,
  ): Promise<Checkpoint | undefined> {
    const directory = this.directory(userId, id);
    return this.serial(directory, async () => {
      try {
        return JSON.parse(
          await readFile(join(directory, "checkpoint.json"), "utf8"),
        ) as Checkpoint;
      } catch (error) {
        if (missing(error)) return undefined;
        throw error;
      }
    });
  }

  async saveCheckpoint(
    userId: string,
    id: string,
    checkpoint: unknown,
    contextState: string,
  ) {
    const directory = this.directory(userId, id);
    await this.serial(directory, async () => {
      await this.prepare(directory);
      await this.atomic(
        join(directory, "checkpoint.json"),
        JSON.stringify({ checkpoint, contextState }),
      );
    });
  }

  async importLegacy(
    userId: string,
    id: string,
    messages: LocalMessage[],
    events: RunEvent[],
    checkpoint: unknown,
    contextState: string,
  ) {
    const directory = this.directory(userId, id);
    await this.serial(directory, async () => {
      await this.prepare(directory);
      await this.atomic(
        join(directory, "messages.jsonl"),
        `${JSON.stringify({ version: 1, messages, events })}\n`,
      );
      if (checkpoint != null)
        await this.atomic(
          join(directory, "checkpoint.json"),
          JSON.stringify({ checkpoint, contextState }),
        );
      const state = new Map(messages.map((message) => [message.id, message]));
      applyFailures(state, events);
      this.remember(directory, state);
    });
  }

  async remove(userId: string, id: string) {
    const directory = this.directory(userId, id);
    await this.serial(directory, async () => {
      await rm(directory, { recursive: true, force: true });
      this.cache.delete(directory);
    });
  }
}
