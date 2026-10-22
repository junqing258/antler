import { PrismaPg } from "@prisma/adapter-pg";
import type { FastifyInstance } from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "../generated/prisma/client.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * 按连接串选择驱动适配器：
 * - postgresql://... → 生产 Postgres（Supabase）
 * - file:<目录> → 文件落盘的 PGlite（测试）
 * - 无参数或 :memory: → 进程内 PGlite（无 schema 的测试应用）
 */
export function createDatabase(url?: string): PrismaClient {
  if (url?.startsWith("postgresql://") || url?.startsWith("postgres://")) {
    // Bound pool acquisition/connection before the startup hook timeout,
    // so an unreachable Postgres reports its actual connection error.
    return new PrismaClient({
      adapter: new PrismaPg({
        connectionString: url,
        connectionTimeoutMillis: 5_000,
        // Supavisor may ignore startup parameters. Set limits explicitly on
        // every session before handing it to Prisma, so SQL is cancelled on
        // the server rather than leaving a timed-out JS transaction locked.
        onConnect: async (client) => {
          await client.query(
            "SET lock_timeout = '2s'; SET statement_timeout = '10s'; SET idle_in_transaction_session_timeout = '10s'",
          );
        },
      }),
    });
  }
  const dataDir = url && url !== ":memory:" ? url.replace(/^file:/, "") : undefined;
  return new PrismaClient({ adapter: new PrismaPGlite(new PGlite(dataDir)) });
}

export function registerDatabase(
  app: FastifyInstance,
  url?: string,
  beforeDisconnect?: () => Promise<void>,
) {
  const prisma = createDatabase(url);
  app.decorate("prisma", prisma);
  app.addHook("onReady", async function connectDatabase() {
    await prisma.$connect();
    // Prisma's pg adapter creates its pool lazily; $connect alone does not
    // verify that Postgres is reachable before platform initialization.
    await prisma.$queryRaw`SELECT 1`;
  });
  app.addHook("onClose", async () => {
    try {
      await beforeDisconnect?.();
    } finally {
      await prisma.$disconnect();
    }
  });
}
