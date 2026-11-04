import { config } from "../src/config/env.js";
import { CosClient } from "../src/conversations/cos-client.js";

// 只读连通性检查（docs/21 §6.2.3）：用 GET 一个不存在的探测键验证
// 凭据、地域与桶配置；不写入任何对象。
if (!config.cos) {
  console.error("缺少 COS 配置：需要 COS_SECRET_ID、COS_SECRET_KEY、COS_REGION 和 COS_BUCKET。");
  process.exit(1);
}

const client = new CosClient(config.cos);
const probeKey = `${config.cosPrefix ?? "antler/conversations/v1"}/.connectivity-probe-${Date.now()}`;
const started = Date.now();
try {
  const missing = await client.get(probeKey);
  if (missing !== undefined) {
    console.error(`探测键意外存在：${probeKey.slice(0, 24)}；请更换 ANTLER_COS_PREFIX。`);
    process.exit(1);
  }
  console.log(`COS 连通性正常（${Date.now() - started}ms）：凭据与桶可访问，探测键 404 符合预期。`);
} catch (error) {
  console.error(
    `COS 连通性失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
