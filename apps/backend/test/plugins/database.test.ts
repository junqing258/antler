import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createServer, type Socket } from "node:net";
import { schedulerDatabase } from "../scheduler/helpers.js";
import { createDatabase, registerDatabase } from "../../src/plugins/database.js";

describe("database", () => {
  it("reports a stalled Postgres connection before the Fastify hook timeout", async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const app = Fastify();
    registerDatabase(app, `postgresql://test:test@127.0.0.1:${address.port}/test`);
    try {
      await expect(app.ready()).rejects.toMatchObject({
        message: "Connection terminated due to connection timeout",
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      await app.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }, 8_000);

  it("connects to PGlite through Prisma", async () => {
    const database = createDatabase();

    try {
      const rows = await database.$queryRaw<unknown[]>`SELECT 1`;
      expect(rows).toHaveLength(1);
    } finally {
      await database.$disconnect();
    }
  });

  it("migrates without internal knowledge tables or enum types", async () => {
    const database = await schedulerDatabase();
    try {
      const tables = await database.$queryRaw<
        { tablename: string; rowsecurity: boolean }[]
      >`
        SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'
      `;
      expect(tables.map((table) => table.tablename).sort()).toEqual([
        "agent_skills",
        "agents",
        "conversation_changes",
        "conversation_messages",
        "conversation_sync_states",
        "conversations",
        "run_events",
        "runs",
        "scheduled_tasks",
        "skill_files",
        "skills",
        "task_executions",
      ]);
      expect(tables.every((table) => table.rowsecurity)).toBe(true);
      const types = await database.$queryRaw<{ typname: string }[]>`
        SELECT typname FROM pg_type WHERE typname LIKE 'Knowledge%'
      `;
      expect(types).toEqual([]);
    } finally {
      await database.$disconnect();
    }
  });
});
