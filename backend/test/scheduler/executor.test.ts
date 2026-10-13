import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import {
  MAX_OUTPUT_CHARS,
  TaskExecutor,
} from "../../src/scheduler/executor.js";
import { schedulerDatabase } from "./helpers.js";

let prisma: PrismaClient;
let server: Server | undefined;
beforeEach(async () => {
  prisma = await schedulerDatabase();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  await prisma.$disconnect();
});
async function http(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const task = (
  type: "http" | "service" | "script",
  payload: object,
  timeout = 1000,
) =>
  prisma.scheduledTask.create({
    data: {
      name: "executor test",
      type,
      schedule: "0 * * * *",
      payload,
      timeout,
    },
  });

describe("TaskExecutor", () => {
  it.skipIf(process.platform === "win32")(
    "kills script descendants that keep output streams open",
    async () => {
      const execution = await new TaskExecutor(prisma, undefined, true).execute(
        await task(
          "script",
          {
            command: process.execPath,
            args: [
              "-e",
              "require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});setInterval(()=>{},1000)",
            ],
          },
          100,
        ),
      );
      expect(execution.status).toBe("timeout");
      expect(execution.duration).toBeLessThan(1500);
    },
  );
  it("sends JSON with a content type, reads JSON once and reuses a precreated execution", async () => {
    let requestBody = "";
    const url = await http((request, response) => {
      expect(request.headers["content-type"]).toBe("application/json");
      request.on("data", (data) => {
        requestBody += data.toString();
      });
      request.on("end", () => {
        response.end('{"ok":true}');
      });
    });
    const scheduled = await task("http", {
      url,
      method: "POST",
      body: { value: 1 },
    });
    const initial = await prisma.taskExecution.create({
      data: { taskId: scheduled.id },
    });
    const execution = await new TaskExecutor(prisma).execute(scheduled, {
      executionId: initial.id,
    });
    expect(execution).toMatchObject({
      id: initial.id,
      status: "succeeded",
      result: { status: 200, body: { ok: true } },
    });
    expect(requestBody).toBe('{"value":1}');
    expect(execution.finishedAt).toBeInstanceOf(Date);
    expect(await prisma.taskExecution.count()).toBe(1);
  });
  it.each([
    [200, "plain text", "succeeded"],
    [204, "", "succeeded"],
    [503, "unavailable", "failed"],
  ])("handles HTTP %s and non-JSON bodies", async (status, body, expected) => {
    const url = await http((_request, response) => {
      response.writeHead(status);
      response.end(body);
    });
    const execution = await new TaskExecutor(prisma).execute(
      await task("http", { url, method: "GET" }),
    );
    expect(execution.status).toBe(expected);
    expect(execution.result).toMatchObject({ status, body: body || null });
  });
  it("honors expectedStatus and preserves explicit content type", async () => {
    const url = await http((request, response) => {
      expect(request.headers["content-type"]).toBe("application/custom");
      response.writeHead(202);
      response.end("accepted");
    });
    const execution = await new TaskExecutor(prisma).execute(
      await task("http", {
        url,
        method: "POST",
        headers: { "Content-Type": "application/custom" },
        body: {},
        expectedStatus: [202],
      }),
    );
    expect(execution.status).toBe("succeeded");
  });
  it("aborts HTTP requests and persists timeout", async () => {
    const url = await http(() => {});
    const execution = await new TaskExecutor(prisma).execute(
      await task("http", { url, method: "GET" }, 30),
    );
    expect(execution.status).toBe("timeout");
  });
  it("binds service methods, appends signal and serializes null", async () => {
    const service = {
      value: "bound",
      run(this: { value: string }, argument: string, signal: AbortSignal) {
        expect(this.value).toBe("bound");
        expect(argument).toBe("arg");
        expect(signal).toBeInstanceOf(AbortSignal);
        return null;
      },
    };
    const executor = new TaskExecutor(prisma, new Map([["test", service]]));
    const execution = await executor.execute(
      await task("service", { service: "test", method: "run", args: ["arg"] }),
    );
    expect(execution).toMatchObject({ status: "succeeded", result: null });
  });
  it("times out service calls and lets them observe cancellation", async () => {
    let aborted = false;
    const executor = new TaskExecutor(
      prisma,
      new Map([
        [
          "test",
          {
            run: (signal: AbortSignal) =>
              new Promise(() => {
                signal.addEventListener("abort", () => {
                  aborted = true;
                });
              }),
          },
        ],
      ]),
    );
    expect(
      (
        await executor.execute(
          await task("service", { service: "test", method: "run" }, 20),
        )
      ).status,
    ).toBe("timeout");
    expect(aborted).toBe(true);
  });
  it.each(["missing", "toString", "constructor"])(
    "rejects unexposed service method %s",
    async (method) => {
      const executor = new TaskExecutor(prisma, new Map([["test", {}]]));
      const execution = await executor.execute(
        await task("service", { service: "test", method }),
      );
      expect(execution).toMatchObject({
        status: "failed",
        error: `Method not found: ${method}`,
      });
    },
  );
  it("records thrown service and serialization errors instead of leaving running rows", async () => {
    const executor = new TaskExecutor(
      prisma,
      new Map([
        [
          "test",
          {
            run: () => {
              throw new Error("service failed");
            },
            circular: () => {
              const value: { self?: unknown } = {};
              value.self = value;
              return value;
            },
          },
        ],
      ]),
    );
    for (const method of ["run", "circular"]) {
      expect(
        (
          await executor.execute(
            await task("service", { service: "test", method }),
          )
        ).status,
      ).toBe("failed");
    }
    expect(
      await prisma.taskExecution.count({ where: { status: "running" } }),
    ).toBe(0);
  });
  it("disables scripts by default", async () => {
    const execution = await new TaskExecutor(prisma).execute(
      await task("script", {
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      }),
    );
    expect(execution.status).toBe("failed");
    expect(execution.error).toContain("Script tasks disabled");
  });
  it("runs scripts without inherited secrets and bounds both output streams", async () => {
    vi.stubEnv("ANTLER_TEST_SECRET", "must-not-leak");
    const execution = await new TaskExecutor(prisma, undefined, true).execute(
      await task("script", {
        command: process.execPath,
        args: [
          "-e",
          "if(process.env.ANTLER_TEST_SECRET || process.env.EXPLICIT !== 'yes') process.exit(2); process.stdout.write('x'.repeat(200000)); process.stderr.write('y'.repeat(200000));",
        ],
        env: { EXPLICIT: "yes" },
      }),
    );
    expect(execution.status).toBe("succeeded");
    const result = execution.result as {
      stdout: string;
      stderr: string;
      exitCode: number;
    };
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toHaveLength(
      MAX_OUTPUT_CHARS + "\n...[truncated]".length,
    );
    expect(result.stderr).toHaveLength(
      MAX_OUTPUT_CHARS + "\n...[truncated]".length,
    );
  });
  it("persists script failures and spawn errors", async () => {
    const executor = new TaskExecutor(prisma, undefined, true);
    const failure = await executor.execute(
      await task("script", {
        command: process.execPath,
        args: ["-e", "process.exit(3)"],
      }),
    );
    expect(failure.error).toContain("Exit code: 3");
    const missing = await executor.execute(
      await task("script", { command: "/antler-missing-command" }),
    );
    expect(missing.status).toBe("failed");
    expect(missing.error).toContain("ENOENT");
  });
  it("kills a script that ignores SIGTERM on timeout", async () => {
    const execution = await new TaskExecutor(prisma, undefined, true).execute(
      await task(
        "script",
        {
          command: process.execPath,
          args: ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
        },
        50,
      ),
    );
    expect(execution.status).toBe("timeout");
  });
});
