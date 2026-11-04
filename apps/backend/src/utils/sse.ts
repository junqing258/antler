import type { FastifyReply } from "fastify";
import type { OutgoingHttpHeaders } from "node:http";
import { isTerminalRunStatus, type RunEvent } from "../agent/events.js";
import type { AntlerHostRuntime } from "../agent/host-runtime.js";

function write(
  reply: FastifyReply,
  event: string,
  payload: unknown,
  id?: number,
) {
  if (id !== undefined) reply.raw.write(`id: ${id}\n`);
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function streamRun(
  runtime: AntlerHostRuntime,
  runId: string,
  reply: FastifyReply,
  afterEventId = 0,
  legacy = false,
  userId?: string,
) {
  const run = await runtime.getRun(runId, userId);
  if (!run) return false;
  reply.hijack();
  // Fastify's CORS/auth hooks have already placed headers on the reply. Passing
  // only the SSE headers here discards them when the raw response is hijacked.
  const headers = reply.getHeaders() as OutgoingHttpHeaders;
  headers["content-type"] = "text/event-stream; charset=utf-8";
  headers["cache-control"] = "no-cache, no-transform";
  headers.connection = "keep-alive";
  reply.raw.writeHead(200, headers);
  reply.raw.flushHeaders();
  const send = (event: RunEvent) => {
    if (!legacy) return write(reply, event.type, event.payload, event.id);
    const type =
      event.type === "run.started"
        ? "task.started"
        : event.type === "assistant.delta"
          ? "message.delta"
          : event.type === "run.completed"
            ? "task.completed"
            : event.type === "run.failed" || event.type === "run.cancelled"
              ? "task.failed"
              : undefined;
    if (type) write(reply, type, { taskId: runId, ...event.payload }, event.id);
  };
  let cursor = afterEventId;
  let replaying = true;
  let closed = false;
  const pending = new Map<number, RunEvent>();
  let unsubscribe: (() => unknown) | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    reply.raw.end();
  };
  const drain = () => {
    for (const event of [...pending.values()].sort((a, b) => a.id - b.id)) {
      pending.delete(event.id);
      if (event.id <= cursor || closed) continue;
      send(event);
      cursor = event.id;
      if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) close();
    }
  };
  reply.raw.on("close", () => { closed = true; unsubscribe?.(); });
  // Subscribe before awaiting history. Every event passes through one ordered queue.
  unsubscribe = runtime.subscribe(runId, (event) => {
    pending.set(event.id, event);
    if (!replaying) drain();
  });
  if (closed) unsubscribe?.();
  try {
    for (const event of await runtime.getEvents(runId, cursor)) pending.set(event.id, event);
    const current = await runtime.getRun(runId, userId);
    replaying = false;
    drain();
    if (!current || isTerminalRunStatus(current.status)) close();
    return true;
  } catch (error) {
    close();
    throw error;
  }
}
