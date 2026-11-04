import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RunEvent } from "../agent/events.js";
import type { StoredRun } from "../runs/run-store.js";
import { projectEvent } from "./message.js";
import type { CosClient } from "./cos-client.js";
import { applyFailures, initialMessages } from "./local-storage.js";
import type { StagingJournal } from "./staging.js";
import type {
  Batch,
  Checkpoint,
  ConversationStorage,
  LocalMessage,
  PersistHooks,
} from "./storage.js";
import { createLogger } from "../logger.js";

const logger = createLogger("Conversations");

const ULID_ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 单调性不跨进程保证；对象键唯一性对本方案已足够。 */
export function ulid(now = Date.now()): string {
  let time = now;
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = ULID_ENCODING[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  let value = 0n;
  for (const byte of randomBytes(10)) value = (value << 8n) | BigInt(byte);
  let random = "";
  for (let i = 0; i < 16; i++) {
    random = ULID_ENCODING[Number(value & 31n)] + random;
    value >>= 5n;
  }
  return timePart + random;
}

/** manifest 引用的对象缺失或内容哈希不符：禁止降级为空历史。 */
export class ConversationStorageIntegrityError extends Error {
  constructor(readonly detail: string) {
    super(`conversation_storage_integrity_error: ${detail}`);
    this.name = "ConversationStorageIntegrityError";
  }
}

export type ManifestBatch = { seq: number; key: string; lastEventId: number };
export type Manifest = {
  version: 1;
  generation: number;
  snapshot?: { key: string; lastEventId: number };
  batches: ManifestBatch[];
  checkpoint?: { key: string; runId?: string };
  commitSeq: number;
};
type ManifestState = {
  manifest: Manifest;
  messages: Map<string, LocalMessage>;
  events: RunEvent[];
};
export type CosObjectStore = Pick<CosClient, "put" | "get" | "delete">;

export type CosStorageOptions = {
  /** 跨容器重建保留的持久暂存日志。 */
  journal?: StagingJournal;
  /** 对象变为不可达时上报 GC 候选（键 + 会话）。 */
  recordGarbage?: (conversationId: string, keys: string[]) => void;
  /** 暂存提交在 COS 与数据库间对账的回调；须在持有会话队列时调用。 */
  onCommitPersisted?: (record: StagedRecord2) => Promise<void>;
};
/** 避免与 staging.ts 的类型-only 环形导入：运行时仅引用其类。 */
type StagedRecord2 = import("./staging.js").StagedRecord;

const hashPayload = (payload: object) => {
  const { sha256: _omitted, ...rest } = payload as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
};

const terminal = (status: string) =>
  ["succeeded", "failed", "cancelled"].includes(status);

/**
 * 腾讯云 COS 会话历史存储（messageStorage=cos-v1）。
 *
 * 对象布局（键不含原始用户/会话 ID）：
 *   ${prefix}/${conversationKey}/manifest.json
 *   ${prefix}/${conversationKey}/snapshots/<generation>.json
 *   ${prefix}/${conversationKey}/batches/<generation>/<batch-id>.json
 *   ${prefix}/${conversationKey}/checkpoints/<checkpoint-id>.json
 *
 * manifest 是正文、事件与 checkpoint 指针的权威；读取顺序为
 * manifest → snapshot → 按序重放其后 batches。未被 manifest 引用的对象
 * 不可见，经 GC 候选宽限期确认后删除。
 *
 * 可靠性协议（docs/21 §4.3）：配置暂存日志后，batch/manifest 提交先写入
 * 持久暂存再上传 COS，确认后由回调对账数据库并清除暂存；进程崩溃后按
 * 暂存重放补齐 COS 与数据库，不重复应用事件。
 */
export class CosConversationStorage implements ConversationStorage {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly cache = new Map<string, ManifestState>();
  private readonly journal?: StagingJournal;
  private readonly recordGarbage?: (conversationId: string, keys: string[]) => void;
  private readonly onCommitPersisted?: (record: StagedRecord2) => Promise<void>;

  constructor(
    private readonly client: CosObjectStore,
    private readonly prefix: string,
    options?: CosStorageOptions,
  ) {
    this.journal = options?.journal;
    this.recordGarbage = options?.recordGarbage;
    this.onCommitPersisted = options?.onCommitPersisted;
  }

  conversationKey(userId: string, conversationId: string) {
    return createHash("sha256")
      .update(JSON.stringify([userId, conversationId]))
      .digest("hex");
  }

  private base(userId: string, id: string) {
    return `${this.prefix}/${this.conversationKey(userId, id)}`;
  }

  private async serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(work);
    this.queues.set(key, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(key) === next) this.queues.delete(key);
    }
  }

  private remember(key: string, state: ManifestState) {
    this.cache.delete(key);
    this.cache.set(key, state);
    if (this.cache.size > 32)
      this.cache.delete(this.cache.keys().next().value!);
  }

  private async putObject(key: string, payload: object) {
    await this.client.put(
      key,
      JSON.stringify({ ...payload, sha256: hashPayload(payload) }),
    );
  }

  private async getObject<T>(key: string): Promise<T | undefined> {
    const raw = await this.client.get(key);
    if (raw === undefined) return undefined;
    let parsed: T & { sha256?: string };
    try {
      parsed = JSON.parse(raw) as T & { sha256?: string };
    } catch {
      throw new ConversationStorageIntegrityError(`unparseable:${key}`);
    }
    if (!parsed.sha256 || hashPayload(parsed) !== parsed.sha256)
      throw new ConversationStorageIntegrityError(`hash_mismatch:${key}`);
    return parsed;
  }

  /** 读取 manifest 并确认缓存投影与其一致；cos-v1 缺 manifest 属完整性错误。 */
  private async manifestState(base: string): Promise<Manifest | undefined> {
    const manifest = await this.getObject<Manifest>(`${base}/manifest.json`);
    if (!manifest) {
      const key = this.conversationKeyOf(base);
      if (key) this.cache.delete(key);
      return undefined;
    }
    if (manifest.version !== 1)
      throw new ConversationStorageIntegrityError(
        `unsupported_manifest_version:${base}`,
      );
    return manifest;
  }

  private conversationKeyOf(base: string): string | undefined {
    const prefix = `${this.prefix}/`;
    return base.startsWith(prefix) ? base.slice(prefix.length) : undefined;
  }

  private async state(
    userId: string,
    id: string,
    options?: { allowMissing?: boolean },
  ): Promise<ManifestState> {
    const key = this.conversationKey(userId, id);
    const base = this.base(userId, id);
    const manifest = await this.manifestState(base);
    if (!manifest) {
      // 创建探测：全新会话尚无 manifest；已标记 cos-v1 的会话缺失
      // manifest 属于存储完整性错误，禁止当作空历史。
      if (options?.allowMissing)
        return {
          manifest: { version: 1, generation: 0, batches: [], commitSeq: 0 },
          messages: new Map(),
          events: [],
        };
      throw new ConversationStorageIntegrityError(`manifest_missing:${base}`);
    }
    const cached = this.cache.get(key);
    if (cached && cached.manifest.commitSeq === manifest.commitSeq) {
      this.remember(key, cached);
      return cached;
    }
    const messages = new Map<string, LocalMessage>();
    const events: RunEvent[] = [];
    if (manifest.snapshot) {
      const snapshot = await this.getObject<Batch>(manifest.snapshot.key);
      if (!snapshot)
        throw new ConversationStorageIntegrityError(
          `snapshot_missing:${manifest.snapshot.key}`,
        );
      for (const message of snapshot.messages) messages.set(message.id, message);
      applyFailures(messages, snapshot.events);
      events.push(...snapshot.events);
    }
    for (const entry of manifest.batches) {
      const batch = await this.getObject<Batch>(entry.key);
      if (!batch)
        throw new ConversationStorageIntegrityError(`batch_missing:${entry.key}`);
      for (const message of batch.messages) messages.set(message.id, message);
      applyFailures(messages, batch.events);
      events.push(...batch.events);
    }
    const state: ManifestState = { manifest, messages, events };
    this.remember(key, state);
    return state;
  }

  /** 直连提交一版 manifest（不经暂存；用于紧凑/导入/checkpoint）。 */
  private async commit(
    userId: string,
    id: string,
    manifest: Manifest,
    state: ManifestState,
  ) {
    await this.putObject(`${this.base(userId, id)}/manifest.json`, manifest);
    this.remember(this.conversationKey(userId, id), state);
  }

  /** 暂存 → 上传对象 → 切换 manifest → 数据库对账 → 清暂存。 */
  private async commitStaged(
    userId: string,
    id: string,
    objects: { key: string; payload: object }[],
    manifest: Manifest,
    record: Partial<StagedRecord2> & Pick<StagedRecord2, "commitId"> = {
      commitId: randomUUID(),
    },
  ): Promise<number> {
    const key = this.conversationKey(userId, id);
    const full: StagedRecord2 = {
      userId,
      conversationId: id,
      objects,
      manifest,
      ...record,
    };
    if (this.journal)
      await this.journal.append(key, full);
    for (const object of objects) await this.putObject(object.key, object.payload);
    await this.putObject(`${this.base(userId, id)}/manifest.json`, manifest);
    // 数据库对账在暂存清除之前完成：对账失败/崩溃时按暂存重放补齐。
    if (this.journal) {
      await this.onCommitPersisted?.(full);
      await this.journal.remove(key, full.commitId);
    }
    return manifest.commitSeq;
  }

  /** 上报本轮提交中被新 manifest 替换、不再可达的对象。 */
  private garbage(conversationId: string, keys: string[]) {
    if (keys.length) this.recordGarbage?.(conversationId, keys);
  }

  async create(run: StoredRun) {
    const userId = run.userId;
    const id = run.conversationId;
    await this.serial(this.conversationKey(userId, id), async () => {
      const state = await this.state(userId, id, { allowMissing: true });
      if (state.messages.has(`${run.id}:user`)) return;
      const seq = [...state.messages.values()].reduce(
        (max, message) => Math.max(max, message.seq),
        0,
      );
      const batch: Batch = {
        version: 1,
        messages: initialMessages(run, seq),
        events: [],
      };
      const manifest = state.manifest;
      const batchKey = `${this.base(userId, id)}/batches/${manifest.generation}/${randomUUID()}.json`;
      const batches = [
        ...manifest.batches,
        { seq: manifest.batches.length + 1, key: batchKey, lastEventId: 0 },
      ];
      // 初始提交不推进 revision：会话创建的数据库可见性由 store 的事务负责。
      await this.commitStaged(
        userId,
        id,
        [{ key: batchKey, payload: batch }],
        { ...manifest, batches, commitSeq: manifest.commitSeq + 1 },
        {
          commitId: randomUUID(),
          initial: true,
          run,
        },
      );
      this.remember(this.conversationKey(userId, id), {
        manifest: { ...manifest, batches, commitSeq: manifest.commitSeq + 1 },
        messages: new Map([
          ...state.messages,
          ...batch.messages.map((message) => [message.id, message] as const),
        ]),
        events: state.events,
      });
    });
  }

  async persist(
    run: StoredRun,
    events: RunEvent[],
    hooks?: PersistHooks,
  ): Promise<number | undefined> {
    const userId = run.userId;
    const id = run.conversationId;
    return await this.serial(this.conversationKey(userId, id), async () => {
      const state = await this.state(userId, id);
      const existing = state.messages.get(`${run.id}:assistant`);
      const initial = existing
        ? []
        : initialMessages(
            run,
            [...state.messages.values()].reduce(
              (max, message) => Math.max(max, message.seq),
              0,
            ),
          );
      const message = structuredClone(existing ?? initial[1]);
      const pending = events.filter(
        (event) => event.runId === run.id && event.id > message.appliedEventId,
      );
      if (!pending.length) return state.manifest.commitSeq;
      for (const event of pending)
        message.content = projectEvent(message.content, event);
      message.appliedEventId = pending.at(-1)!.id;
      applyFailures(new Map([[message.id, message]]), pending);
      message.status = run.status;
      message.updatedAt = pending.at(-1)!.createdAt;
      const batch: Batch = {
        version: 1,
        messages: [...initial.filter((item) => item.role === "user"), message],
        events: pending,
      };
      // 先上传不可变 batch，再原子切换 manifest；切换失败时 batch 成为
      // 未引用对象（有暂存时按暂存重放重试同一键）。
      const manifest = state.manifest;
      const batchKey = `${this.base(userId, id)}/batches/${manifest.generation}/${randomUUID()}.json`;
      const batches = [
        ...manifest.batches,
        {
          seq: manifest.batches.length + 1,
          key: batchKey,
          lastEventId: pending.at(-1)!.id,
        },
      ];
      const nextManifest: Manifest = {
        ...manifest,
        batches,
        commitSeq: manifest.commitSeq + 1,
      };
      const isTerminal = terminal(run.status);
      let seq: number;
      try {
        seq = await this.commitStaged(
          userId,
          id,
          [{ key: batchKey, payload: batch }],
          nextManifest,
          {
            commitId: randomUUID(),
            run,
            ...(isTerminal && hooks ? { terminal: pending.at(-1) } : {}),
          },
        );
      } catch (error) {
        if (!this.journal) this.garbage(id, [batchKey]);
        throw error;
      }
      this.remember(this.conversationKey(userId, id), {
        manifest: nextManifest,
        messages: (() => {
          const next = new Map(state.messages);
          for (const item of batch.messages) next.set(item.id, item);
          return next;
        })(),
        events: [...state.events, ...pending],
      });
      if (isTerminal) {
        try {
          await this.compact(userId, id);
        } catch (error) {
          logger.warn("cos history compaction failed", {
            conversationId: id,
            error,
          });
        }
      }
      return seq;
    });
  }

  /** 终态后的紧凑：新世代 snapshot 保留全部可重放事件与消息投影。 */
  private async compact(userId: string, id: string) {
    const state = await this.state(userId, id);
    const generation = state.manifest.generation + 1;
    const snapshotKey = `${this.base(userId, id)}/snapshots/${generation}.json`;
    const snapshot: Batch = {
      version: 1,
      messages: [...state.messages.values()].sort((a, b) => a.seq - b.seq),
      events: state.events,
    };
    await this.putObject(snapshotKey, snapshot);
    const manifest: Manifest = {
      version: 1,
      generation,
      snapshot: {
        key: snapshotKey,
        lastEventId: state.events.at(-1)?.id ?? 0,
      },
      batches: [],
      checkpoint: state.manifest.checkpoint,
      commitSeq: state.manifest.commitSeq + 1,
    };
    await this.commit(userId, id, manifest, { ...state, manifest });
    this.garbage(id, [
      ...(state.manifest.snapshot ? [state.manifest.snapshot.key] : []),
      ...state.manifest.batches.map((batch) => batch.key),
    ]);
  }

  async messages(userId: string, id: string) {
    return this.serial(this.conversationKey(userId, id), async () =>
      structuredClone(
        [...(await this.state(userId, id)).messages.values()].sort(
          (a, b) => a.seq - b.seq,
        ),
      ),
    );
  }

  async input(userId: string, id: string, runId: string) {
    return this.serial(this.conversationKey(userId, id), async () => {
      const message = (await this.state(userId, id)).messages.get(
        `${runId}:user`,
      );
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
    return this.serial(this.conversationKey(userId, id), async () => {
      const rows = [...(await this.state(userId, id)).messages.values()]
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
    return this.serial(this.conversationKey(userId, id), async () =>
      (await this.state(userId, id))
        .events.filter((event) => event.runId === runId && event.id > after)
        .sort((a, b) => a.id - b.id),
    );
  }

  /** 须在会话队列内调用；串行包装内部的裸读取，避免同队列死锁。 */
  private async readCheckpoint(
    manifest: Manifest,
  ): Promise<Checkpoint | undefined> {
    if (!manifest.checkpoint) return undefined;
    const stored = await this.getObject<Checkpoint>(manifest.checkpoint.key);
    if (!stored)
      throw new ConversationStorageIntegrityError(
        `checkpoint_missing:${manifest.checkpoint.key}`,
      );
    return {
      checkpoint: stored.checkpoint,
      contextState: stored.contextState,
    };
  }

  async checkpoint(
    userId: string,
    id: string,
  ): Promise<Checkpoint | undefined> {
    return this.serial(this.conversationKey(userId, id), async () => {
      const manifest = await this.manifestState(`${this.base(userId, id)}`);
      if (!manifest)
        throw new ConversationStorageIntegrityError(
          `manifest_missing:${this.base(userId, id)}`,
        );
      return this.readCheckpoint(manifest);
    });
  }

  async saveCheckpoint(
    userId: string,
    id: string,
    checkpoint: unknown,
    contextState: string,
    runId?: string,
  ) {
    await this.serial(this.conversationKey(userId, id), async () => {
      const state = await this.state(userId, id);
      // checkpoint 对象不可变：不递增会话 revision，重复保存生成新 ULID。
      const checkpointKey = `${this.base(userId, id)}/checkpoints/${ulid()}.json`;
      await this.putObject(checkpointKey, {
        checkpoint,
        contextState,
        ...(runId ? { runId } : {}),
      });
      const manifest: Manifest = {
        ...state.manifest,
        checkpoint: { key: checkpointKey, ...(runId ? { runId } : {}) },
        commitSeq: state.manifest.commitSeq + 1,
      };
      await this.commit(userId, id, manifest, { ...state, manifest });
      if (state.manifest.checkpoint)
        this.garbage(id, [state.manifest.checkpoint.key]);
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
    await this.serial(this.conversationKey(userId, id), async () => {
      const base = this.base(userId, id);
      const ordered = [...messages].sort((a, b) => a.seq - b.seq);
      // 保持传入的事件顺序（event.id 只在单 run 内递增，禁止跨 run 排序）。
      const orderedEvents = [...events];
      // 记录旧 manifest 引用的对象：被本世代替换后进入 GC 候选。
      const previous = await this.getObject<Manifest>(`${base}/manifest.json`);
      const previousKeys = previous
        ? [
            ...(previous.snapshot ? [previous.snapshot.key] : []),
            ...previous.batches.map((batch) => batch.key),
            ...(previous.checkpoint ? [previous.checkpoint.key] : []),
          ]
        : [];
      const snapshotKey = `${base}/snapshots/1.json`;
      await this.putObject(snapshotKey, {
        version: 1,
        messages: ordered,
        events: orderedEvents,
      });
      let checkpointPointer: Manifest["checkpoint"];
      if (checkpoint != null) {
        const checkpointKey = `${base}/checkpoints/${ulid()}.json`;
        await this.putObject(checkpointKey, { checkpoint, contextState });
        checkpointPointer = { key: checkpointKey };
      }
      const manifest: Manifest = {
        version: 1,
        generation: 1,
        snapshot: {
          key: snapshotKey,
          lastEventId: orderedEvents.at(-1)?.id ?? 0,
        },
        batches: [],
        ...(checkpointPointer ? { checkpoint: checkpointPointer } : {}),
        commitSeq: 1,
      };
      await this.commit(userId, id, manifest, {
        manifest,
        messages: new Map(ordered.map((message) => [message.id, message])),
        events: orderedEvents,
      });
      // 旧 manifest 引用的对象已被本世代替换，进入 GC 候选。
      this.garbage(id, previousKeys);
    });
  }

  async remove(userId: string, id: string) {
    await this.serial(this.conversationKey(userId, id), async () => {
      const base = this.base(userId, id);
      const manifestKey = `${base}/manifest.json`;
      const manifest = await this.getObject<Manifest>(manifestKey);
      if (manifest) {
        // 仅依据 manifest 列举的可达对象删除，不要求 ListBucket 权限。
        const keys = [
          ...(manifest.snapshot ? [manifest.snapshot.key] : []),
          ...manifest.batches.map((batch) => batch.key),
          ...(manifest.checkpoint ? [manifest.checkpoint.key] : []),
        ];
        for (const key of keys) await this.client.delete(key);
      }
      await this.client.delete(manifestKey);
      await this.journal?.removeConversation(this.conversationKey(userId, id));
      this.cache.delete(this.conversationKey(userId, id));
    });
  }

  async exportAll(userId: string, id: string) {
    return this.serial(this.conversationKey(userId, id), async () => {
      const state = await this.state(userId, id);
      return {
        messages: structuredClone(
          [...state.messages.values()].sort((a, b) => a.seq - b.seq),
        ),
        events: [...state.events],
        checkpoint: await this.readCheckpoint(state.manifest),
      };
    });
  }

  /** 删除任务：manifest 列举的可达键（不含 manifest 自身）。缺 manifest 返回空。 */
  async reachableKeys(userId: string, id: string): Promise<string[]> {
    return await this.serial(this.conversationKey(userId, id), async () => {
      const manifest = await this.getObject<Manifest>(
        `${this.base(userId, id)}/manifest.json`,
      );
      if (!manifest) return [];
      return [
        ...(manifest.snapshot ? [manifest.snapshot.key] : []),
        ...manifest.batches.map((batch) => batch.key),
        ...(manifest.checkpoint ? [manifest.checkpoint.key] : []),
      ];
    });
  }

  /** GC/删除任务使用：删除任意对象键，404 视为已删除。 */
  async deleteObject(key: string): Promise<void> {
    await this.client.delete(key);
  }

  async deleteManifest(userId: string, id: string): Promise<void> {
    await this.client.delete(`${this.base(userId, id)}/manifest.json`);
    await this.journal?.removeConversation(this.conversationKey(userId, id));
    this.cache.delete(this.conversationKey(userId, id));
  }

  /**
   * 崩溃恢复：按暂存顺序重放单条记录。先补齐 COS 对象与 manifest（幂等，
   * 仅当当前 manifest 落后于暂存目标时切换），再经回调对账数据库，最后清暂存。
   * 须在持有该会话队列时调用。
   */
  async replayRecord(record: StagedRecord2): Promise<void> {
    if (!this.journal) return;
    for (const object of record.objects) {
      if (object.payload != null)
        await this.putObject(object.key, object.payload);
    }
    if (record.manifest) {
      const base = this.base(record.userId, record.conversationId);
      const current = await this.manifestState(base);
      if (!current || current.commitSeq < record.manifest.commitSeq)
        await this.putObject(`${base}/manifest.json`, record.manifest);
    }
    await this.onCommitPersisted?.(record);
    await this.journal.remove(
      this.conversationKey(record.userId, record.conversationId),
      record.commitId,
    );
  }
}
