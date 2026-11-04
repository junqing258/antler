import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { config } from "../src/config/env.js";
import { createDatabase } from "../src/plugins/database.js";
import { LocalConversationStorage } from "../src/conversations/local-storage.js";
import { CosConversationStorage } from "../src/conversations/cos-storage.js";
import { CosClient } from "../src/conversations/cos-client.js";

// 反向导出/回滚工具（docs/21 §6.3）：把每个 cos-v1 会话写入独立的本地
// 目标目录，校验消息、事件与 checkpoint 后更新标记；可重跑，失败项保留
// cos-v1 标记并阻止回退旧版本。
const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const targetRoot = process.env.ANTLER_ROLLBACK_TARGET_ROOT;
if (!targetRoot) {
  console.error("缺少 ANTLER_ROLLBACK_TARGET_ROOT：请指定独立的本地导出目录。");
  process.exit(1);
}
if (!config.cos) {
  console.error("缺少 COS 配置：需要 COS_SECRET_ID、COS_SECRET_KEY、COS_REGION 和 COS_BUCKET。");
  process.exit(1);
}
if (!config.databaseUrl) {
  console.error("缺少 DATABASE_URL 环境变量。");
  process.exit(1);
}

const db = createDatabase(config.databaseUrl);
const cos = new CosConversationStorage(
  new CosClient(config.cos),
  config.cosPrefix ?? "antler/conversations/v1",
);
const local = new LocalConversationStorage(resolve(targetRoot));

const rows = await db.conversation.findMany({
  where: { messageStorage: "cos-v1", deletedAt: null },
  orderBy: { id: "asc" },
});
console.log(`待回滚导出会话：${rows.length}`);

let success = 0;
const failures: string[] = [];
for (const row of rows) {
  try {
    const exported = await cos.exportAll(row.userId, row.id);
    await local.importLegacy(
      row.userId,
      row.id,
      exported.messages,
      exported.events,
      exported.checkpoint?.checkpoint ?? null,
      exported.checkpoint?.contextState ?? "not_restored",
    );
    const verify = await local.exportAll(row.userId, row.id);
    if (
      verify.messages.length !== exported.messages.length ||
      sha(verify.messages) !== sha(exported.messages) ||
      verify.events.length !== exported.events.length ||
      sha(verify.events) !== sha(exported.events)
    )
      throw new Error(
        `校验不一致：messages ${verify.messages.length}/${exported.messages.length}，events ${verify.events.length}/${exported.events.length}`,
      );
    await db.conversation.update({
      where: { id: row.id },
      data: { messageStorage: "local-jsonl" },
    });
    success++;
  } catch (error) {
    // 失败项保留 cos-v1 标记并阻止回退旧版本；保留 COS 数据直至回滚验证完成。
    failures.push(
      `${row.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

console.log(`回滚导出完成：成功 ${success}，失败 ${failures.length}`);
for (const failure of failures) console.error(`FAILED ${failure}`);
await db.$disconnect();
process.exit(failures.length ? 1 : 0);
