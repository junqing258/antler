import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createDatabase } from "../../src/plugins/database.js";
import { migratedWorkspace } from "./helpers.js";

it.skipIf(process.platform === "win32").each(["SIGINT", "SIGTERM"] as const)(
  "%s persists an accepted execution before the backend process exits",
  async (signal) => {
    const { root, file } = await migratedWorkspace();
    let child: ChildProcess | undefined;
    let timer: NodeJS.Timeout | undefined;
    const prisma = createDatabase(`file:${file}`);
    try {
      const task = await prisma.scheduledTask.create({
        data: {
          name: "signal shutdown",
          type: "script",
          schedule: "delay:0",
          runAt: new Date(),
          timeout: 2000,
          payload: {
            command: process.execPath,
            args: [
              "-e",
              "setTimeout(()=>process.stdout.write('signal complete'),150)",
            ],
          },
        },
      });
      await prisma.$disconnect();
      child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        env: {
          ...process.env,
          DATABASE_URL: `file:${file}`,
          // Keep both directories isolated from development and outside each other.
          ANTLER_WORKSPACE_ROOT: join(root, "workspace"),
          ANTLER_PLATFORM_ROOT: join(root, "platform"),
          ANTLER_HOST: "127.0.0.1",
          ANTLER_PORT: "0",
          ANTLER_SCHEDULER_ENABLE_SCRIPT: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exited = new Promise<number | null>((resolve) =>
        child!.once("exit", resolve),
      );
      let output = "";
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Backend did not start execution: ${output}`)),
          15_000,
        );
        child!.once("error", reject);
        child!.once("exit", () =>
          reject(new Error(`Backend exited before execution: ${output}`)),
        );
        const consume = (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes(`[Scheduler] Running task ${task.id}`)) resolve();
        };
        child!.stdout!.on("data", consume);
        child!.stderr!.on("data", consume);
      });
      clearTimeout(timer);
      child.kill(signal);
      expect(await exited, output).toBe(0);
      // PGlite 是进程内快照库：子进程的落盘数据必须用新实例读取。
      const reopened = createDatabase(`file:${file}`);
      try {
        const executions = await reopened.taskExecution.findMany({
          where: { taskId: task.id },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0]).toMatchObject({
          status: "succeeded",
          result: { stdout: "signal complete" },
        });
        expect(
          await reopened.scheduledTask.findUnique({ where: { id: task.id } }),
        ).toMatchObject({ enabled: false, runAt: null });
      } finally {
        await reopened.$disconnect();
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) =>
          child!.once("exit", () => resolve()),
        );
        child.kill("SIGKILL");
        await exited;
      }
      await prisma.$disconnect();
      await rm(root, { recursive: true, force: true });
    }
  },
);
