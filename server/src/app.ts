import Fastify from 'fastify';
import type { AppConfig } from './config/env.js';
import { registerHttpHooks } from './plugins/http.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { TaskService } from './services/task-service.js';

export function createApp(config: AppConfig) {
  const app = Fastify({ logger: false });
  const taskService = new TaskService();

  registerHttpHooks(app, config);
  registerHealthRoutes(app);
  registerTaskRoutes(app, taskService);

  app.setNotFoundHandler(async (request, reply) => {
    if (!request.antlerAuthorized) return reply.code(401).send({ error: '未授权的本地服务请求。' });
    return reply.code(404).send({ error: '路由不存在。' });
  });

  return app;
}
