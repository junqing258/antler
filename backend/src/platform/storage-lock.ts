import { mkdir, open, realpath, chmod, statfs } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import pg from "pg";

const LOCK_KEY = "47057888938292311";
export async function acquireStorageLock(
  root: string,
  workspace: string,
  databaseUrl: string | undefined,
  onLost: () => void,
) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const actual = await realpath(root),
    work = await realpath(workspace);
  if (actual === work || actual.startsWith(`${work}${sep}`))
    throw new Error(
      "ANTLER_PLATFORM_ROOT must be outside ANTLER_WORKSPACE_ROOT",
    );
  // Fail closed on network/unknown filesystems; v1 supports local POSIX storage only.
  const fs = await statfs(actual);
  const localTypes = [
    0x1a, 0x11, 0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x858458f6,
    0x794c7630, 0x2fc12fc1,
  ];
  if (!localTypes.includes(fs.type >>> 0))
    throw new Error(
      "Platform storage requires a local filesystem with reliable flock semantics",
    );
  const { flock } = await import("fs-ext");

  const file = await open(join(actual, ".lock"), "a+", 0o600);
  let client: pg.Client | undefined,
    heartbeat: NodeJS.Timeout | undefined,
    closing = false,
    lost = false;
  const fail = () => {
    if (!closing && !lost) {
      lost = true;
      onLost();
    }
  };
  try {
    await new Promise<void>((accept, reject) =>
      flock(file.fd, "exnb", (error) => (error ? reject(error) : accept())),
    );
    await chmod(actual, 0o700);
    if (/^postgres(ql)?:/.test(databaseUrl ?? "")) {
      client = new pg.Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
      });
      client.on("error", fail);
      client.on("end", fail);
      await client.connect();
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1::bigint) AS locked",
        [LOCK_KEY],
      );
      if (!result.rows[0]?.locked)
        throw new Error(
          "Agent platform is already running against this database",
        );
      heartbeat = setInterval(() => {
        void client!.query("SELECT 1").catch(fail);
      }, 5000);
      heartbeat.unref();
    }
    return async () => {
      if (closing) return;
      closing = true;
      clearInterval(heartbeat);
      await client?.end().catch(() => {});
      await file.close(); // flock is released by the OS, including after crashes.
    };
  } catch (error) {
    closing = true;
    clearInterval(heartbeat);
    await client?.end().catch(() => {});
    await file.close();
    throw error;
  }
}
