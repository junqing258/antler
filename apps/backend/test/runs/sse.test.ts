import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { FastifyReply } from "fastify";
import { streamRun } from "../../src/utils/sse.js";
import type { AntlerHostRuntime } from "../../src/agent/host-runtime.js";
import type { RunEvent } from "../../src/agent/events.js";
const event = (
  id: number,
  type: RunEvent["type"] = "assistant.delta",
): RunEvent => ({
  id,
  type,
  runId: "run",
  payload: { delta: String(id) },
  createdAt: new Date().toISOString(),
});
function reply() {
  const raw = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    end: vi.fn(),
  });
  return {
    raw,
    hijack: vi.fn(),
    getHeaders: () => ({}),
  } as unknown as FastifyReply;
}
describe("run SSE replay handoff", () => {
  it("buffers events before history resolves, deduplicates and closes on a concurrent terminal event", async () => {
    const response = reply();
    let listener!: (event: RunEvent) => void;
    const unsubscribe = vi.fn();
    const runtime = {
      getRun: vi
        .fn()
        .mockResolvedValueOnce({ status: "running" })
        .mockResolvedValue({ status: "succeeded" }),
      subscribe: (_id: string, callback: typeof listener) => {
        listener = callback;
        return unsubscribe;
      },
      getEvents: async () => {
        listener(event(2));
        listener(event(3, "run.completed"));
        return [event(1), event(2)];
      },
    } as unknown as AntlerHostRuntime;
    await streamRun(runtime, "run", response);
    const ids = vi
      .mocked(response.raw.write)
      .mock.calls.map(([value]) => String(value))
      .filter((value) => value.startsWith("id:"));
    expect(ids).toEqual(["id: 1\n", "id: 2\n", "id: 3\n"]);
    expect(response.raw.end).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("ends and releases the listener when the cursor already covers terminal history", async () => {
    const response = reply();
    const unsubscribe = vi.fn();
    await streamRun(
      {
        getRun: async () => ({ status: "succeeded" }),
        subscribe: () => unsubscribe,
        getEvents: async () => [],
      } as unknown as AntlerHostRuntime,
      "run",
      response,
      3,
    );
    expect(response.raw.write).not.toHaveBeenCalled();
    expect(response.raw.end).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("releases the listener on disconnect while replay is pending", async () => {
    const response = reply();
    const unsubscribe = vi.fn();
    await streamRun(
      {
        getRun: async () => ({ status: "running" }),
        subscribe: () => unsubscribe,
        getEvents: async () => {
          response.raw.emit("close");
          return [event(1)];
        },
      } as unknown as AntlerHostRuntime,
      "run",
      response,
    );
    expect(response.raw.write).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
