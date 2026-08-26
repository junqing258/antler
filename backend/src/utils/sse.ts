import type { FastifyReply } from 'fastify';
import type { OutgoingHttpHeaders } from 'node:http';
import { isTerminalRunStatus, type RunEvent } from '../agent/events.js';
import type { AntlerHostRuntime } from '../agent/host-runtime.js';

function write(reply: FastifyReply, event: string, payload: unknown, id?: number) {
  if (id !== undefined) reply.raw.write(`id: ${id}\n`);
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function streamRun(runtime: AntlerHostRuntime, runId: string, reply: FastifyReply, afterEventId = 0, legacy = false) {
  const run = runtime.getRun(runId);
  if (!run) return false;
  reply.hijack();
  // Fastify's CORS/auth hooks have already placed headers on the reply. Passing
  // only the SSE headers here discards them when the raw response is hijacked.
  const headers = reply.getHeaders() as OutgoingHttpHeaders;
  headers['content-type'] = 'text/event-stream; charset=utf-8';
  headers['cache-control'] = 'no-cache, no-transform';
  headers.connection = 'keep-alive';
  reply.raw.writeHead(200, headers);
  reply.raw.flushHeaders();
  const send = (event: RunEvent) => {
    if (!legacy) return write(reply, event.type, event.payload, event.id);
    const type = event.type === 'run.started' ? 'task.started' : event.type === 'assistant.delta' ? 'message.delta' : event.type === 'run.completed' ? 'task.completed' : event.type === 'run.failed' || event.type === 'run.cancelled' ? 'task.failed' : undefined;
    if (type) write(reply, type, { taskId: runId, ...event.payload }, event.id);
  };
  for (const event of runtime.getEvents(runId, afterEventId)) send(event);
  if (isTerminalRunStatus(run.status)) { reply.raw.end(); return true; }
  const unsubscribe = runtime.subscribe(runId, (event) => {
    send(event);
    if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') { unsubscribe?.(); reply.raw.end(); }
  });
  reply.raw.on('close', () => unsubscribe?.());
  return true;
}
