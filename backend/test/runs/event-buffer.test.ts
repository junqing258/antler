import { afterEach, expect, it, vi } from "vitest";
import { RunEventBuffer } from "../../src/runs/event-buffer.js";
import type { RunEvent } from "../../src/agent/events.js";

const event = (id: number): RunEvent => ({
  id,
  runId: "run",
  type: "assistant.delta",
  payload: { delta: String(id) },
  createdAt: new Date().toISOString(),
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("batches streaming events every two seconds and flushes the final tail", async () => {
  vi.useFakeTimers();
  const write = vi.fn(async (_events: RunEvent[]) => {});
  const buffer = new RunEventBuffer(write);
  for (let id = 1; id <= 200; id++) buffer.append(event(id));
  await vi.advanceTimersByTimeAsync(1_999);
  expect(write).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][0].map((item) => item.id)).toEqual(
    Array.from({ length: 200 }, (_, index) => index + 1),
  );
  buffer.append(event(201));
  await buffer.flush();
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][0]).toEqual([event(201)]);
  expect(vi.getTimerCount()).toBe(0);
});

it("drops failed batches and continues persisting later output", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const write = vi.fn(async (_events: RunEvent[]) => {}).mockRejectedValueOnce(new Error("offline"));
  const buffer = new RunEventBuffer(write);
  buffer.append(event(1));
  await vi.advanceTimersByTimeAsync(2_000);
  buffer.append(event(2));
  await buffer.flush();
  expect(write.mock.calls.map(([events]) => events.map((item) => item.id))).toEqual([[1], [2]]);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds the backlog and never overlaps writes when the database stalls", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const write = vi.fn(async (_events: RunEvent[]) => {});
  write.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const buffer = new RunEventBuffer(write);
  buffer.append(event(1));
  await vi.advanceTimersByTimeAsync(2_000);
  for (let id = 2; id <= 1_502; id++) buffer.append(event(id));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(write).toHaveBeenCalledTimes(1);
  release();
  await buffer.flush();
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][0]).toHaveLength(1_000);
  expect(write.mock.calls[1][0][0].id).toBe(503);
  expect(vi.getTimerCount()).toBe(0);
});
