import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AntlerHostRuntime, type Run } from "../../src/agent/host-runtime.js";
import {
  PiAdapterError,
  type PiAgentAdapter,
} from "../../src/agent/pi-agent-adapter.js";
import { registerRunRoutes } from "../../src/routes/runs.js";

function testRuntime() {
  const run: Run = {
    id: "run-1",
    projectId: "project-1",
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
        projectId: "project-1",
        conversationId: "conversation-1",
        workingDirectory: process.cwd(),
      },
    });

    expect(response.statusCode).toBe(202);
    expect(runtime.createRunWithSkills).toHaveBeenCalledWith("hello", {
      projectId: "project-1",
      conversationId: "conversation-1",
      provider: undefined,
      workingDirectory: process.cwd(),
      skillPolicy: { mode: "auto" },
      knowledgePolicy: { mode: "disabled" },
    });
    await app.close();
  });

  it("preserves an explicit disabled skill policy", async () => {
    const app = Fastify();
    const runtime = testRuntime();
    registerRunRoutes(app, runtime as unknown as AntlerHostRuntime);
    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        message: "hello",
        projectId: "project-1",
        conversationId: "conversation-1",
        skillPolicy: { mode: "disabled" },
      },
    });
    expect(response.statusCode).toBe(202);
    expect(runtime.createRunWithSkills).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({ skillPolicy: { mode: "disabled" } }),
    );
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
      payload: {
        message: "hello",
        projectId: "project-1",
        conversationId: "conversation-1",
        workingDirectory,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
    expect(runtime.createRunWithSkills).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires a project ID and rejects unreleased knowledge policies", async () => {
    const app = Fastify();
    const runtime = testRuntime();
    registerRunRoutes(app, runtime as unknown as AntlerHostRuntime);

    const missingProject = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { message: "hello", conversationId: "conversation-1" },
    });
    expect(missingProject.statusCode).toBe(400);

    const invalidKnowledge = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        message: "hello",
        projectId: "project-1",
        conversationId: "conversation-1",
        knowledgePolicy: { mode: "selected", knowledgeBaseIds: ["kb-1"] },
      },
    });
    expect(invalidKnowledge.statusCode).toBe(400);
    expect(invalidKnowledge.json()).toEqual({
      error: "Knowledge policy 无效。",
    });
    await app.close();
  });
});

describe("POST /api/runs /compact", () => {
  it.each(["success", "empty"])(
    "returns compaction %s through the existing SSE endpoint",
    async (outcome) => {
      const app = Fastify();
      const compact = vi.fn(async () => {
        if (outcome === "empty")
          throw new PiAdapterError(
            "conversation_context_empty",
            "没有可压缩的上下文",
          );
        return {
          summary: "保留目标和待办事项",
          beforeMessages: 12,
          beforeBytes: 2000,
          afterBytes: 100,
        };
      });
      const runAdapter = vi.fn();
      const runtime = new AntlerHostRuntime(
        () => ({ compact, run: runAdapter }) as unknown as PiAgentAdapter,
        { maxRunDurationMs: 1000, maxEvents: 10 },
      );
      registerRunRoutes(app, runtime);
      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/runs",
          payload: {
            message: "/compact",
            projectId: "project-1",
            conversationId: "conversation-1",
          },
        });
        expect(response.statusCode).toBe(202);
        const { runId, eventsUrl } = response.json();
        await vi.waitFor(async () =>
          expect((await runtime.getRun(runId))?.status).toBe(
            outcome === "success" ? "succeeded" : "failed",
          ),
        );
        const events = await app.inject({ method: "GET", url: eventsUrl });
        expect(events.statusCode).toBe(200);
        expect(events.headers["content-type"]).toContain("text/event-stream");
        if (outcome === "success") {
          expect(events.body).toContain("event: run.completed");
          expect(events.body).toContain("会话上下文已压缩");
          expect(events.body).toContain("保留目标和待办事项");
        } else {
          expect(events.body).toContain("event: run.failed");
          expect(events.body).toContain("conversation_context_empty");
        }
        expect(runAdapter).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );
});
