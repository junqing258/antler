import { describe, expect, it, vi } from "vitest";
import { AntlerHostRuntime } from "./host-runtime.js";
import type { PiAgentAdapter } from "./pi-agent-adapter.js";
import type { RunStore } from "../runs/run-store.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillRegistry } from "../skills/skill-registry.js";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { RunEvent } from "./events.js";
import { REDACTED } from "./secret-guard.js";

describe("AntlerHostRuntime knowledge contract", () => {
  it("makes bundled skills available to a Web run by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-web-skills-"));
    const runAdapter = vi.fn(async () => undefined);
    const runtime = new AntlerHostRuntime(
      () => ({ run: runAdapter }) as unknown as PiAgentAdapter,
      { maxRunDurationMs: 1_000, maxEvents: 10 },
      new SkillRegistry(join(root, "user-agents")),
    );
    try {
      const { run } = await runtime.createRunWithSkills("查询知识库", {
        projectId: "project-1",
        workingDirectory: root,
      });
      await vi.waitFor(() =>
        expect(runAdapter).toHaveBeenCalledWith(
          "查询知识库",
          run.conversationId,
          expect.objectContaining({
            policy: { mode: "auto" },
            skills: [
              expect.objectContaining({ id: "antler-rag", scope: "bundled" }),
            ],
          }),
          expect.any(AbortSignal),
          expect.any(Function),
        ),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits an empty knowledge result before model execution and persists its event", async () => {
    const events: { id: number; type: string }[] = [];
    const store: RunStore = {
      create: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      transition: vi.fn(async (_run, event) => {
        events.push(event);
      }),
      appendEvent: vi.fn(async (event) => {
        events.push(event);
      }),
      get: vi.fn(async () => undefined),
      getEvents: vi.fn(async () => []),
      recoverInterrupted: vi.fn(async () => undefined),
      saveKnowledgeHits: vi.fn(async () => undefined),
    };
    const adapter = {
      run: vi.fn(async () => undefined),
    } as unknown as PiAgentAdapter;
    const runtime = new AntlerHostRuntime(
      () => adapter,
      { maxRunDurationMs: 1_000, maxEvents: 10 },
      undefined,
      store,
    );

    const run = await runtime.createRun("hello", {
      projectId: "project-1",
      conversationId: "conversation-1",
    });
    await vi.waitFor(() =>
      expect(events.map((event) => event.type)).toEqual([
        "knowledge.retrieved",
        "run.started",
        "run.completed",
      ]),
    );

    expect(events.map((event) => event.id)).toEqual([1, 2, 3]);
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
    );
    expect(adapter.run).toHaveBeenCalledWith(
      "hello",
      "conversation-1",
      expect.anything(),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect((await runtime.getRun(run.id))?.status).toBe("succeeded");
  });
});

describe("AntlerHostRuntime secret protection", () => {
  it("redacts split assistant/thinking output, tool arguments/results and provider errors before persistence and live delivery", async () => {
    const root = await mkdtemp(join(tmpdir(), "antler-runtime-security-"));
    const secret = "runtime-private-value-123";
    await writeFile(join(root, ".env"), `CUSTOM_VALUE=${secret}\n`);
    const persisted: RunEvent[] = [];
    const live: RunEvent[] = [];
    const store: RunStore = {
      create: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      transition: vi.fn(async (_run, event) => {
        persisted.push(event);
      }),
      appendEvent: vi.fn(async (event) => {
        persisted.push(event);
      }),
      get: vi.fn(async () => undefined),
      getEvents: vi.fn(async () => []),
      recoverInterrupted: vi.fn(async () => undefined),
      saveKnowledgeHits: vi.fn(async () => undefined),
    };
    const adapter = {
      async run(
        _input: string,
        _id: string,
        _snapshot: unknown,
        _signal: AbortSignal,
        onEvent: (event: AgentEvent) => Promise<void>,
      ) {
        for (const type of ["text_delta", "thinking_delta"]) {
          for (const delta of [
            "value: ",
            secret.slice(0, 9),
            secret.slice(9),
            "!",
          ]) {
            await onEvent({
              type: "message_update",
              assistantMessageEvent: { type, contentIndex: 0, delta },
            } as AgentEvent);
          }
        }
        await onEvent({
          type: "tool_execution_start",
          toolName: "bash",
          toolCallId: "call-1",
          args: { command: `echo ${secret}` },
        } as AgentEvent);
        await onEvent({
          type: "tool_execution_end",
          toolName: "bash",
          toolCallId: "call-1",
          isError: true,
          result: {
            content: [{ type: "text", text: secret }],
            details: { nested: [secret] },
          },
        } as AgentEvent);
        throw new Error(`Provider echoed ${secret}`);
      },
    } as unknown as PiAgentAdapter;
    const runtime = new AntlerHostRuntime(
      () => adapter,
      { maxRunDurationMs: 2_000, maxEvents: 100 },
      undefined,
      store,
    );
    try {
      const run = await runtime.createRun("hello", {
        projectId: "project-1",
        workingDirectory: root,
      });
      runtime.subscribe(run.id, (event) => {
        live.push(event);
      });
      await vi.waitFor(() => expect(persisted.at(-1)?.type).toBe("run.failed"));
      const replay = await runtime.getEvents(run.id);
      expect(live).toEqual(persisted);
      expect(replay).toEqual(persisted);
      expect(JSON.stringify(persisted)).not.toContain(secret);
      for (const type of ["assistant.delta", "assistant.thinking.delta"]) {
        expect(
          persisted
            .filter((event) => event.type === type)
            .map((event) => event.payload.delta)
            .join(""),
        ).toBe(`value: ${REDACTED}!`);
      }
      expect(
        persisted.find((event) => event.type === "step.started")?.payload.args,
      ).toEqual({ command: `echo ${REDACTED}` });
      expect(persisted.at(-1)?.payload.error).toEqual({
        code: "provider_error",
        message: `Provider echoed ${REDACTED}`,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("redacts an unfinished secret prefix when a run fails", async () => {
    const secret = "provider-private-key-6789";
    const adapter = {
      async run(
        _input: string,
        _id: string,
        _snapshot: unknown,
        _signal: AbortSignal,
        onEvent: (event: AgentEvent) => Promise<void>,
      ) {
        await onEvent({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: `value: ${secret.slice(0, 12)}`,
          },
        } as AgentEvent);
        throw new Error("Interrupted");
      },
    } as unknown as PiAgentAdapter;
    const runtime = new AntlerHostRuntime(() => adapter, {
      maxRunDurationMs: 1_000,
      maxEvents: 100,
    });
    const run = await runtime.createRun("hello", {
      projectId: "project-1",
      provider: { protocol: "openai-responses", model: "test", apiKey: secret },
    });
    await vi.waitFor(async () =>
      expect((await runtime.getRun(run.id))?.status).toBe("failed"),
    );
    const events = await runtime.getEvents(run.id);
    expect(
      events
        .filter((event) => event.type === "assistant.delta")
        .map((event) => event.payload.delta)
        .join(""),
    ).toBe(`value: ${REDACTED}`);
  });
});
