import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { AntlerHostRuntime, Run } from "../agent/host-runtime.js";
import { registerRunRoutes } from "./runs.js";

function testRuntime() {
  const run: Run = {
    id: "run-1",
    conversationId: "conversation-1",
    input: "hello",
    status: "queued",
    createdAt: new Date(0).toISOString(),
  };
  return {
    createRunWithSkills: vi.fn(async () => ({ run, skillDiagnostics: [] })),
  };
}

describe("POST /api/runs workingDirectory", () => {
  it("passes an existing absolute directory to the runtime", async () => {
    const app = Fastify();
    const runtime = testRuntime();
    registerRunRoutes(app, runtime as unknown as AntlerHostRuntime);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        message: "hello",
        conversationId: "conversation-1",
        workingDirectory: process.cwd(),
      },
    });

    expect(response.statusCode).toBe(202);
    expect(runtime.createRunWithSkills).toHaveBeenCalledWith("hello", {
      conversationId: "conversation-1", provider: undefined,
      workingDirectory: process.cwd(), skillPolicy: { mode: "disabled" },
    });
    await app.close();
  });

  it.each([
    ["relative path", "relative/project", "工作目录必须使用绝对路径。"],
    [
      "missing path",
      `${process.cwd()}/directory-that-does-not-exist-antler`,
      "工作目录不存在或不是文件夹。",
    ],
  ])("rejects a %s", async (_label, workingDirectory, error) => {
    const app = Fastify();
    const runtime = testRuntime();
    registerRunRoutes(app, runtime as unknown as AntlerHostRuntime);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { message: "hello", conversationId: "conversation-1", workingDirectory },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
    expect(runtime.createRunWithSkills).not.toHaveBeenCalled();
    await app.close();
  });
});
