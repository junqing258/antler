import type { FastifyReply } from 'fastify';
import type { Task } from '../types/task.js';

function event(reply: FastifyReply, type: string, data: unknown) {
  reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function streamTask(task: Task, reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive'
  });
  reply.raw.flushHeaders();
  event(reply, 'task.started', { taskId: task.id, status: 'running' });

  const text = `已收到任务：“${task.message}”。本地 Agent 服务链路正常；接入 LLM provider 后将在这里输出真实执行结果。`;
  let offset = 0;
  const timer = setInterval(() => {
    const delta = text.slice(offset, offset + 4);
    offset += delta.length;
    if (delta) event(reply, 'message.delta', { taskId: task.id, delta });
    if (offset >= text.length) {
      clearInterval(timer);
      task.status = 'completed';
      event(reply, 'task.completed', { taskId: task.id, status: task.status });
      reply.raw.end();
    }
  }, 45);
  reply.raw.on('close', () => clearInterval(timer));
}
