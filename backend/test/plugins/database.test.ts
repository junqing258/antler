import { describe, expect, it } from "vitest";
import { schedulerDatabase } from "../scheduler/helpers.js";
import { createDatabase } from "../../src/plugins/database.js";

describe("database", () => {
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
