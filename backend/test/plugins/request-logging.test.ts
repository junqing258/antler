import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";

describe("request completion logging", () => {
  let app: FastifyInstance;
  let workspaceRoot: string;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FORCE_COLOR", "0");
    vi.stubEnv("NO_COLOR", undefined);
    log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 10, 20, 24, 47, 227));
    workspaceRoot = await mkdtemp(join(tmpdir(), "antler-request-logging-"));
    app = createApp({
      host: "127.0.0.1",
      port: 3210,
      provider: "openai",
      accessToken: "test-token",
      workspaceRoot,
      model: "test-model",
      maxRunDurationMs: 1_000,
    });
  });

  afterEach(async () => {
    await app?.close();
    if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("logs one formatted line with the server request ID and no credentials", async () => {
    app.post("/api/log-test", async (request) => ({ requestId: request.id }));

    const response = await app.inject({
      method: "POST",
      url: "/api/log-test?token=test-token&apiKey=query-secret",
      headers: {
        "x-antler-token": "test-token",
        "x-request-id": "client-supplied-id",
      },
      payload: { apiKey: "body-secret" },
    });

    expect(response.statusCode).toBe(200);
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0] as string;
    expect(line).toMatch(
      /^2026-10-10 20:24:47\.227 INFO     app api_request_completed request_id=20261010202447_[a-f0-9]{16} method=POST path=\/api\/log-test status=200 duration_ms=\d+$/,
    );
    expect(line).toContain(`request_id=${response.json().requestId} `);
    for (const secret of ["test-token", "query-secret", "body-secret", "client-supplied-id"])
      expect(line).not.toContain(secret);
  });

  it.each([
    { method: "GET" as const, url: "/health", status: 401 },
    { method: "GET" as const, url: "/api/missing?token=test-token", status: 404 },
    { method: "OPTIONS" as const, url: "/api/missing", status: 204 },
    { method: "GET" as const, url: "/api/failure?token=test-token", status: 500 },
  ])("logs $method $url with status $status", async ({ method, url, status }) => {
    app.get("/api/failure", async () => {
      throw new Error("test failure");
    });
    const response = await app.inject({ method, url });

    expect(response.statusCode).toBe(status);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain(
      `method=${method} path=${url.split("?", 1)[0]} status=${status} duration_ms=`,
    );
  });

  it("includes handler time and assigns unique IDs to concurrent requests", async () => {
    app.get("/api/slow", async (request) => {
      await setTimeout(25);
      return { requestId: request.id };
    });

    const responses = await Promise.all([
      app.inject("/api/slow?token=test-token"),
      app.inject("/api/slow?token=test-token"),
    ]);

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(responses[0].json().requestId).not.toBe(responses[1].json().requestId);
    expect(log).toHaveBeenCalledTimes(2);
    for (const [line] of log.mock.calls) {
      const duration = Number((line as string).match(/duration_ms=(\d+)$/)?.[1]);
      expect(duration).toBeGreaterThanOrEqual(20);
    }
  });

  it.each([
    { status: 200, color: 32 },
    { status: 302, color: 36 },
    { status: 404, color: 33 },
    { status: 500, color: 31 },
  ])("colors status $status in development when forced", async ({ status, color }) => {
    vi.stubEnv("FORCE_COLOR", "1");
    app.get("/api/status", async (_request, reply) => reply.code(status).send());

    await app.inject("/api/status?token=test-token");

    const line = log.mock.calls[0][0] as string;
    expect(line).toContain("\u001b[90m2026-10-10 20:24:47.227\u001b[0m");
    expect(line).toContain("\u001b[32mINFO\u001b[0m");
    expect(line).toContain("method=\u001b[36mGET\u001b[0m");
    expect(line).toContain(`status=\u001b[${color}m${status}\u001b[0m`);
    expect(line.replace(/\u001b\[\d+m/g, "")).toMatch(
      /^2026-10-10 20:24:47\.227 INFO     app api_request_completed request_id=\S+ method=GET path=\/api\/status status=\d+ duration_ms=\d+$/,
    );
  });

  it.each([
    { name: "NO_COLOR", value: "" },
    { name: "NODE_ENV", value: "production" },
    { name: "FORCE_COLOR", value: "0" },
  ])("keeps plain text with $name=$value", async ({ name, value }) => {
    vi.stubEnv("FORCE_COLOR", "1");
    vi.stubEnv(name, value);

    await app.inject("/health?token=test-token");

    expect(log.mock.calls[0][0]).not.toContain("\u001b[");
  });

  it.each([true, false])("detects terminal color support when isTTY=$0", async (isTTY) => {
    vi.stubEnv("FORCE_COLOR", undefined);
    vi.stubEnv("TERM", "xterm-256color");
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: isTTY });
    try {
      await app.inject("/health?token=test-token");
      expect((log.mock.calls[0][0] as string).includes("\u001b[")).toBe(isTTY);
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
      else Reflect.deleteProperty(process.stdout, "isTTY");
    }
  });
});
