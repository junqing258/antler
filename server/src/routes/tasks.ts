import type { FastifyInstance } from 'fastify';
import type { TaskService } from '../services/task-service.js';
import { streamTask } from '../utils/sse.js';

export function registerTaskRoutes(app: FastifyInstance, taskService: TaskService) {
  app.post('/api/tasks', async (request, reply) => {
    const { message } = (request.body ?? {}) as { message?: unknown };
    if (typeof message !== 'string' || !message.trim()) {
      return reply.code(400).send({ error: 'message 不能为空。' });
    }

    const task = taskService.create(message);
    return reply.code(202).send({ taskId: task.id, eventsUrl: `/api/tasks/${task.id}/events` });
  });

  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/events', async (request, reply) => {
    const task = taskService.get(request.params.taskId);
    if (!task) return reply.code(404).send({ error: '任务不存在。' });
    streamTask(task, reply);
  });
}
