import { describe, expect, it } from "vitest";
import { createDatabase } from "./database.js";

describe("database", () => {
  it("connects to SQLite through Prisma", async () => {
    const database = createDatabase();

    try {
      const rows = await database.$queryRaw<unknown[]>`SELECT 1`;
      expect(rows).toHaveLength(1);
    } finally {
      await database.$disconnect();
    }
  });
});
