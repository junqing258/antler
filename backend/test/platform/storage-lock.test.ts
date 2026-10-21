import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { acquireStorageLock } from "../../src/platform/storage-lock.js";
import { createDatabase } from "../../src/plugins/database.js";
let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
describe("lifetime storage lock", () => {
  it("preserves a live process's staging and lets the OS release locks after a crash", async () => {
    root = await mkdtemp(join(tmpdir(), "antler-lock-process-"));
    const workspace = join(root, "workspace"),
      platform = join(root, "platform");
    await mkdir(workspace);
    const module = new URL(
      "../../src/platform/storage-lock.ts",
      import.meta.url,
    ).href;
    const script = `import { acquireStorageLock } from ${JSON.stringify(module)}; await acquireStorageLock(${JSON.stringify(platform)}, ${JSON.stringify(workspace)}, undefined, () => process.exit(1)); console.log('locked'); setInterval(() => {}, 1000);`;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const closed = once(child, "close");
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) =>
          reject(new Error(`Lock child exited: ${code}`)),
        );
        child.stdout.on("data", (data: Buffer) => {
          if (data.toString().includes("locked")) resolve();
        });
      });
      await mkdir(join(platform, ".staging"));
      await writeFile(join(platform, ".staging", "sentinel"), "live upload");
      await expect(
        acquireStorageLock(platform, workspace, undefined, vi.fn()),
      ).rejects.toBeDefined();
      expect(
        await readFile(join(platform, ".staging", "sentinel"), "utf8"),
      ).toBe("live upload");
      child.kill("SIGKILL");
      await closed;
      const release = await acquireStorageLock(
        platform,
        workspace,
        undefined,
        vi.fn(),
      );
      await release();
    } finally {
      child.kill("SIGKILL");
      await closed;
    }
  });
  it.skipIf(!process.env.ANTLER_TEST_POSTGRES_URL)(
    "keeps the dedicated pg lock across Prisma pool rebuilds",
    async () => {
      root = await mkdtemp(join(tmpdir(), "antler-pg-lock-"));
      const workspace = join(root, "workspace");
      await mkdir(workspace);
      const url = process.env.ANTLER_TEST_POSTGRES_URL!;
      const lost = vi.fn();
      const release = await acquireStorageLock(
        join(root, "one"),
        workspace,
        url,
        lost,
      );
      try {
        const first = createDatabase(url);
        await first.$connect();
        await first.$queryRaw`SELECT 1`;
        await first.$disconnect();
        const rebuilt = createDatabase(url);
        await rebuilt.$connect();
        await rebuilt.$queryRaw`SELECT 1`;
        await rebuilt.$disconnect();
        await expect(
          acquireStorageLock(join(root, "two"), workspace, url, vi.fn()),
        ).rejects.toThrow("already running");
        expect(lost).not.toHaveBeenCalled();
      } finally {
        await release();
      }
      const next = await acquireStorageLock(
        join(root, "two"),
        workspace,
        url,
        vi.fn(),
      );
      await next();
    },
  );
});
