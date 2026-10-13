import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDatabase } from "../../src/plugins/database.js";

export async function migratedWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "antler-scheduler-"));
  const file = join(root, "antler.db");
  try {
    // Prisma's engine cannot create a new SQLite file through a ../ URL on this host.
    await writeFile(file, "");
    const require = createRequire(import.meta.url);
    await promisify(execFile)(
      process.execPath,
      [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
      {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        env: {
          ...process.env,
          DATABASE_URL: `file:${file}`,
          ANTLER_WORKSPACE_ROOT: root,
        },
      },
    );
    return { root, file };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function schedulerDatabase() {
  const prisma = createDatabase();
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20261013000000_add_scheduler_tables/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const statement of sql.split(";").filter((part) => part.trim())) {
    await prisma.$executeRawUnsafe(statement);
  }
  return prisma;
}

export function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
