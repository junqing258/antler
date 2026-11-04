import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/plugins/database.js";

/** Open a PGlite database and apply every migration from prisma/migrations in order. */
export async function schedulerDatabase(url?: string) {
  const prisma = createDatabase(url);
  await prisma.$connect();
  const migrationsDir = fileURLToPath(
    new URL("../../prisma/migrations", import.meta.url),
  );
  for (const dir of readdirSync(migrationsDir).sort()) {
    const file = join(migrationsDir, dir, "migration.sql");
    if (!existsSync(file)) continue;
    const sql = await readFile(file, "utf8");
    for (const statement of sql.split(";").filter((part) => part.trim())) {
      await prisma.$executeRawUnsafe(statement);
    }
  }
  return prisma;
}

/** A temp directory backed by a migrated file-based PGlite database. */
export async function migratedWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "antler-scheduler-"));
  const file = join(root, "antler.db");
  try {
    await (await schedulerDatabase(`file:${file}`)).$disconnect();
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return { root, file };
}

export function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
