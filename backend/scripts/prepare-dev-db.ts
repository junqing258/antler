import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { config } from "../src/config/env.js";

// Migrate before onReady recovery touches the database, including on first boot.
if (!config.databaseUrl) {
  console.error("缺少 DATABASE_URL 环境变量：后端需要指向 Postgres 的连接串。");
  process.exit(1);
}
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
  { stdio: "inherit" },
);
if (result.error) console.error("Unable to apply development migrations:", result.error);
process.exitCode = result.status ?? 1;
