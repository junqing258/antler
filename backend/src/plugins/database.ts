import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "../generated/prisma/client.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export function createDatabase(url = ":memory:"): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

export function registerDatabase(app: FastifyInstance, url?: string) {
  const prisma = createDatabase(url);
  app.decorate("prisma", prisma);
  app.addHook("onReady", () => prisma.$connect());
  app.addHook("onClose", () => prisma.$disconnect());
}
