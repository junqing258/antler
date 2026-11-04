import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";

describe("logger", () => {
  let info: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let debug: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 10, 20, 24, 47, 227));
    vi.stubEnv("FORCE_COLOR", "0");
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("renders one structured line with padded level, tag, message and fields", () => {
    createLogger("Runs").info("run started", { runId: "r-1", status: 200 });

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toBe(
      "2026-10-10 20:24:47.227 INFO Runs run started runId=r-1 status=200",
    );
  });

  it("renders level names of different widths with a single separator", () => {
    createLogger("Runs").warn("failed");

    expect(warn.mock.calls[0][0]).toBe(
      "2026-10-10 20:24:47.227 WARN Runs failed",
    );
  });

  it("quotes string fields containing whitespace and serializes objects as JSON", () => {
    createLogger("app").warn("odd input", {
      text: "two words",
      nested: { a: 1 },
      flag: false,
      empty: undefined,
    });

    expect(warn.mock.calls[0][0]).toBe(
      '2026-10-10 20:24:47.227 WARN app odd input text="two words" nested={"a":1} flag=false',
    );
  });

  it("summarizes Error fields inline and appends the stack on its own line", () => {
    const error = new Error("database unavailable");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createLogger("Runs").error("Run persistence failed", { runId: "r-2", error });

    const line = errorSpy.mock.calls[0][0] as string;
    expect(line).toBe(
      `2026-10-10 20:24:47.227 ERROR Runs Run persistence failed runId=r-2 error=Error: database unavailable\n${error.stack}`,
    );
  });

  it("merges child fields ahead of per-call fields under the same tag", () => {
    createLogger("Conversations", { conversationId: "c-1" })
      .child({ userId: "u-1" })
      .warn("downgraded", { reason: "missing" });

    expect(warn.mock.calls[0][0]).toBe(
      "2026-10-10 20:24:47.227 WARN Conversations downgraded conversationId=c-1 userId=u-1 reason=missing",
    );
  });

  it("suppresses debug entries at the default info threshold and honors LOG_LEVEL", async () => {
    createLogger("Runs").debug("noisy detail");
    expect(debug).not.toHaveBeenCalled();

    vi.resetModules();
    vi.stubEnv("LOG_LEVEL", "debug");
    const { createLogger: freshCreateLogger } = await import("../src/logger.js");
    freshCreateLogger("Runs").debug("noisy detail");
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls[0][0]).toBe(
      "2026-10-10 20:24:47.227 DEBUG Runs noisy detail",
    );
  });

  it("keeps output plain without ANSI codes when color is disabled", () => {
    createLogger("app").info("plain");

    expect(info.mock.calls[0][0]).not.toContain("\u001b[");
  });
});
