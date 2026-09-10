import { describe, expect, it, vi } from "vitest";
import { AntlerHostRuntime } from "./host-runtime.js";
import type { PiAgentAdapter } from "./pi-agent-adapter.js";
import type { RunStore } from "../runs/run-store.js";

describe("AntlerHostRuntime knowledge contract", () => {
  it("emits an empty knowledge result before model execution and persists its event", async () => {
    const events: { id: number; type: string }[] = [];
    const store: RunStore = {
      create: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      transition: vi.fn(async (_run, event) => { events.push(event); }),
      appendEvent: vi.fn(async (event) => { events.push(event); }),
      get: vi.fn(async () => undefined),
      getEvents: vi.fn(async () => []),
      recoverInterrupted: vi.fn(async () => undefined),
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
    await vi.waitFor(() => expect(events.map((event) => event.type)).toEqual([
      "knowledge.retrieved", "run.started", "run.completed",
    ]));

    expect(events.map((event) => event.id)).toEqual([1, 2, 3]);
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1" }));
    expect(adapter.run).toHaveBeenCalledWith(
      "hello", "conversation-1", expect.anything(), expect.any(AbortSignal), expect.any(Function),
    );
    expect((await runtime.getRun(run.id))?.status).toBe("succeeded");
  });
});
