import type { RunEvent } from "../agent/events.js";
import type { StoredRun } from "../runs/run-store.js";
import type { MessageContent } from "./message.js";
import type { StagedRecord } from "./staging.js";

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
export type Batch = { version: 1; messages: LocalMessage[]; events: RunEvent[] };
export type Checkpoint = { checkpoint: unknown; contextState: string };

/** 持久化钩子：终态/正文提交确认后、暂存清理前的数据库对账入口。 */
export type PersistHooks = {
  onCommitPersisted?(record: StagedRecord): Promise<void>;
};

/**
 * 会话正文的存储抽象。ConversationStore 只依赖该接口，不依赖文件系统或 COS。
 * 同一会话的所有调用由 ConversationStore 的进程内队列串行化。
 */
export interface ConversationStorage {
  create(run: StoredRun): Promise<void>;
  /** 返回本次提交后的正文水位（manifest 提交序号）；本地实现返回 undefined。 */
  persist(
    run: StoredRun,
    events: RunEvent[],
    hooks?: PersistHooks,
  ): Promise<number | undefined>;
  messages(userId: string, id: string): Promise<LocalMessage[]>;
  page(
    userId: string,
    id: string,
    limit: number,
    beforeSeq?: number,
    afterSeq?: number,
  ): Promise<{ messages: LocalMessage[]; hasMore: boolean }>;
  events(userId: string, id: string, runId: string, after: number): Promise<RunEvent[]>;
  input(userId: string, id: string, runId: string): Promise<string>;
  checkpoint(userId: string, id: string): Promise<Checkpoint | undefined>;
  saveCheckpoint(
    userId: string,
    id: string,
    checkpoint: unknown,
    contextState: string,
    runId?: string,
  ): Promise<void>;
  importLegacy(
    userId: string,
    id: string,
    messages: LocalMessage[],
    events: RunEvent[],
    checkpoint: unknown,
    contextState: string,
  ): Promise<void>;
  remove(userId: string, id: string): Promise<void>;
  /** 迁移与回滚工具使用的完整导出；包含全部可重放事件与当前 checkpoint。 */
  exportAll(
    userId: string,
    id: string,
  ): Promise<{ messages: LocalMessage[]; events: RunEvent[]; checkpoint?: Checkpoint }>;
}
