import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config/env.js";
import { createDatabase } from "../src/plugins/database.js";
import { LocalConversationStorage } from "../src/conversations/local-storage.js";
import { CosConversationStorage } from "../src/conversations/cos-storage.js";
import { CosClient } from "../src/conversations/cos-client.js";

// 显式命令触发的 local-jsonl → cos-v1 迁移工具（docs/21 §6.1）。
// 不在服务启动时批量扫描；与运行服务不得同时操作同一会话。
const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));

const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const platformRoot = config.platformRoot
  ? resolve(projectRoot, config.platformRoot)
  : resolve(config.workspaceRoot, "../.antler-platform");

if (!config.cos) {
  console.error(
    "缺少 COS 配置：需要 COS_SECRET_ID、COS_SECRET_KEY、COS_REGION 和 COS_BUCKET。",
  );
  process.exit(1);
}
if (!config.databaseUrl) {
  console.error("缺少 DATABASE_URL 环境变量。");
  process.exit(1);
}

const db = createDatabase(config.databaseUrl);
const local = new LocalConversationStorage(
  join(platformRoot, "storage", "conversations"),
);
const cos = new CosConversationStorage(
  new CosClient(config.cos),
  config.cosPrefix ?? "antler/conversations/v1",
);

type Report = { id: string; status: "migrated" | "skipped" | "failed"; detail?: string };

const rows = await db.conversation.findMany({
  where: { messageStorage: "local-jsonl", deletedAt: null },
  orderBy: { id: "asc" },
});
console.log(`待迁移会话：${rows.length}`);

const report: Report[] = [];
for (const row of rows) {
  try {
    const exported = await local.exportAll(row.userId, row.id);
    // checkpoint 选择遵循现有运行时：本地优先，其次数据库安全镜像；
    // 两者均无时按现有逻辑标记 not_restored。
    const checkpoint = exported.checkpoint?.checkpoint ?? row.checkpoint;
    const contextState = exported.checkpoint
      ? exported.checkpoint.contextState
      : row.checkpoint
        ? row.contextState
        : "not_restored";
    await cos.importLegacy(
      row.userId,
      row.id,
      exported.messages,
      exported.events,
      checkpoint,
      contextState,
    );
    const verify = await cos.exportAll(row.userId, row.id);
    const checkpointHash = (value: unknown) => (value == null ? "null" : sha(value));
    if (
      verify.messages.length !== exported.messages.length ||
      sha(verify.messages) !== sha(exported.messages) ||
      verify.events.length !== exported.events.length ||
      sha(verify.events) !== sha(exported.events) ||
      checkpointHash(verify.checkpoint?.checkpoint) !== checkpointHash(checkpoint)
    )
      throw new Error(
        `校验不一致：messages ${verify.messages.length}/${exported.messages.length}，events ${verify.events.length}/${exported.events.length}`,
      );
    await db.conversation.update({
      where: { id: row.id },
      data: { messageStorage: "cos-v1" },
    });
    report.push({ id: row.id, status: "migrated" });
  } catch (error) {
    // 失败项保留 local-jsonl 标记，由路由器继续访问本地，可安全重跑。
    report.push({
      id: row.id,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

const migrated = report.filter((item) => item.status === "migrated").length;
const failed = report.filter((item) => item.status === "failed");
console.log(`迁移完成：成功 ${migrated}，失败 ${failed.length}`);
for (const item of failed)
  console.error(`FAILED ${item.id}: ${item.detail}`);
await db.$disconnect();
process.exit(failed.length ? 1 : 0);
