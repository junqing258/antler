import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunEvent } from "../agent/events.js";
import type { StoredRun } from "../runs/run-store.js";
import type { Manifest } from "./cos-storage.js";

/** 一次待确认的存储提交：先持久暂存，再上传对象并切换 manifest。 */
export type StagedRecord = {
  commitId: string;
  userId: string;
  conversationId: string;
  objects: { key: string; payload: object }[];
  manifest?: Manifest;
  /** 初始（创建会话）提交：数据库对账仅推进诊断水位，不改 revision。 */
  initial?: boolean;
  /** 关联的 run（用于数据库状态对账）。 */
  run?: StoredRun;
  /** 终态标记：取值为该 run 的终态事件。 */
  terminal?: RunEvent;
};

/** 暂存达到容量上限：必须中止运行并明确报告，禁止静默丢弃。 */
export class StagingCapacityError extends Error {
  constructor(readonly usedBytes: number, readonly maxBytes: number) {
    super(
      `staging capacity exhausted: ${usedBytes}/${maxBytes} bytes；请检查持久暂存卷并扩容。`,
    );
    this.name = "StagingCapacityError";
  }
}

const newlineCommitted = (raw: string) => raw.endsWith("\n");

/**
 * 跨容器重建保留的持久暂存日志（docs/21 §4.3）。
 * 每个会话一个 JSONL 文件，换行符提交语义与本地 JSONL 相同：
 * 追加中断留下的不完整尾行在下次写入前截断，重放时忽略。
 */
export class StagingJournal {
  constructor(
    readonly root: string,
    private readonly maxBytes: number,
  ) {}

  file(conversationKey: string) {
    return join(this.root, `${conversationKey}.jsonl`);
  }

  /** 启动时验证可写与剩余容量；失败必须拒绝启动相关写入。 */
  async validate() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const probe = join(this.root, `.probe-${randomUUID()}`);
    try {
      await writeFile(probe, "", { mode: 0o600, flag: "wx" });
    } finally {
      await rm(probe, { force: true });
    }
    const used = await this.totalSize();
    if (used >= this.maxBytes)
      throw new StagingCapacityError(used, this.maxBytes);
  }

  async append(conversationKey: string, record: StagedRecord) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const used = await this.totalSize();
    const line = `${JSON.stringify(record)}\n`;
    if (used + Buffer.byteLength(line) > this.maxBytes)
      throw new StagingCapacityError(used, this.maxBytes);
    const path = this.file(conversationKey);
    const handle = await open(path, "a+", 0o600).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return open(path, "w", 0o600);
    });
    try {
      // 移除上次崩溃留下的不完整尾行，再追加完整记录。
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
      await handle.writeFile(line, "utf8");
    } finally {
      await handle.close();
    }
  }

  /** 读取暂存记录；仅换行终止的记录视为已提交。 */
  async records(conversationKey?: string): Promise<StagedRecord[]> {
    const files = conversationKey
      ? [this.file(conversationKey)]
      : (await readdir(this.root))
          .filter((name) => name.endsWith(".jsonl"))
          .map((name) => join(this.root, name));
    const result: StagedRecord[] = [];
    for (const path of files) {
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      // 仅以换行终止的记录视为已提交；崩溃留下的不完整尾行被忽略。
      if (!newlineCommitted(raw))
        raw = raw.slice(0, raw.lastIndexOf("\n") + 1);
      for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
          result.push(JSON.parse(line) as StagedRecord);
        } catch {
          // 不完整或损坏的中间行不可能出现（换行提交）；跳过并告警由调用方负责。
        }
      }
    }
    return result;
  }

  /** 提交确认后移除单条暂存；文件为空时一并删除。 */
  async remove(conversationKey: string, commitId: string) {
    const path = this.file(conversationKey);
    const remaining = (await this.records(conversationKey)).filter(
      (record) => record.commitId !== commitId,
    );
    if (!remaining.length) {
      await rm(path, { force: true });
      return;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        remaining.map((record) => `${JSON.stringify(record)}\n`).join(""),
        { mode: 0o600, flag: "wx" },
      );
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  /** 删除整个会话的暂存（删除任务收尾）。 */
  async removeConversation(conversationKey: string) {
    await rm(this.file(conversationKey), { force: true });
  }

  /** GC 引用检查：暂存中是否有任何记录引用该对象键。 */
  async references(objectKey: string): Promise<boolean> {
    for (const record of await this.records()) {
      if (record.objects.some((object) => object.key === objectKey))
        return true;
      if (record.manifest) {
        const manifest = record.manifest;
        if (
          manifest.snapshot?.key === objectKey ||
          manifest.batches.some((batch) => batch.key === objectKey) ||
          manifest.checkpoint?.key === objectKey
        )
          return true;
      }
    }
    return false;
  }

  private async totalSize() {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    let total = 0;
    for (const name of names) {
      const info = await stat(join(this.root, name)).catch(() => undefined);
      if (info?.isFile()) total += info.size;
    }
    return total;
  }
}
