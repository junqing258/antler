import { defineConfig } from "prisma/config";
import { config } from "./src/config/env.js";

function cliDatabaseUrl(url?: string) {
  if (!url) return url;
  // Prisma 迁移引擎在 pgbouncer 事务池化连接上无法工作（prepared statement 冲突）。
  // Supabase 的会话池化端口是 5432，事务池化是 6543：CLI 一律改走会话池化。
  return url
    .replace(":6543/", ":5432/")
    .replace(/[?&]pgbouncer=true/, "");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // CLI（migrate/generate/studio）使用会话池化连接；运行时适配器用原始 URL。
    url: cliDatabaseUrl(config.databaseUrl),
  },
});
