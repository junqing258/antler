import type { FastifyInstance } from 'fastify';
import type { TaskService } from '../services/task-service.js';
import { ConversationBusyError } from '../agent/host-runtime.js';
import { streamRun } from '../utils/sse.js';

export function registerTaskRoutes(app: FastifyInstance, taskService: TaskService) {
  app.post('/api/tasks', async (request, reply) => {
    const { message, conversationId } = (request.body ?? {}) as { message?: unknown; conversationId?: unknown };
    if (typeof message !== 'string' || !message.trim()) {
      return reply.code(400).send({ error: 'message 不能为空。' });
    }

    if (conversationId !== undefined && (typeof conversationId !== 'string' || !conversationId)) return reply.code(400).send({ error: 'conversationId 必须是非空字符串。' });
    try {
      const task = taskService.create(message, conversationId);
      return reply.code(202).send({ taskId: task.id, runId: task.id, conversationId: task.conversationId, eventsUrl: `/api/tasks/${task.id}/events` });
    } catch (error) {
      if (error instanceof ConversationBusyError) return reply.code(409).send({ error: 'conversation_busy' });
      throw error;
    }
  });

  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/events', async (request, reply) => {
    const task = taskService.get(request.params.taskId);
    if (!task) return reply.code(404).send({ error: '任务不存在。' });
    streamRun(taskService.runtime, task.id, reply, 0, true);
  });
}
