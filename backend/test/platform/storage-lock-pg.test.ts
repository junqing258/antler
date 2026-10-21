import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
const state = vi.hoisted(() => ({
  clients: [] as (EventEmitter & {
    query: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  })[],
}));
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    default: {
      Client: class extends EventEmitter {
        query = vi.fn(async () => ({ rows: [{ locked: true }] }));
        connect = vi.fn(async () => {});
        end = vi.fn(async () => {
          this.emit("end");
        });
        constructor() {
          super();
          state.clients.push(this);
        }
      },
    },
  };
});
import { acquireStorageLock } from "../../src/platform/storage-lock.js";
let root: string, release: (() => Promise<void>) | undefined;
beforeEach(async () => {
  state.clients.length = 0;
  root = await mkdtemp(join(tmpdir(), "antler-client-lock-"));
  await mkdir(join(root, "workspace"));
});
afterEach(async () => {
  await release?.();
  release = undefined;
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});
describe("dedicated advisory lock connection failure", () => {
  it.each(["error", "end", "heartbeat"])(
    "fails closed exactly once on %s",
    async (failure) => {
      const lost = vi.fn();
      if (failure === "heartbeat") vi.useFakeTimers();
      release = await acquireStorageLock(
        join(root, "platform"),
        join(root, "workspace"),
        "postgresql://test.invalid/test",
        lost,
      );
      expect(state.clients).toHaveLength(1);
      const client = state.clients[0]!;
      expect(client.query).toHaveBeenCalledWith(
        "SELECT pg_try_advisory_lock($1::bigint) AS locked",
        [expect.any(String)],
      );
      if (failure === "heartbeat") {
        client.query.mockRejectedValueOnce(new Error("heartbeat failure"));
        await vi.advanceTimersByTimeAsync(5000);
      } else
        client.emit(
          failure,
          failure === "error" ? new Error("connection lost") : undefined,
        );
      expect(lost).toHaveBeenCalledTimes(1);
      client.emit("error", new Error("duplicate connection error"));
      expect(lost).toHaveBeenCalledTimes(1);
      await release();
      expect(lost).toHaveBeenCalledTimes(1);
      expect(client.end).toHaveBeenCalledOnce();
    },
  );
  it("does not treat a normal shutdown as lock loss", async () => {
    const lost = vi.fn();
    release = await acquireStorageLock(
      join(root, "platform"),
      join(root, "workspace"),
      "postgresql://test.invalid/test",
      lost,
    );
    await release();
    expect(lost).not.toHaveBeenCalled();
  });
});
