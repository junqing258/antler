import Fastify from 'fastify';
import type { AppConfig } from './config/env.js';
import { registerHttpHooks } from './plugins/http.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { TaskService } from './services/task-service.js';
import { AntlerHostRuntime } from './agent/host-runtime.js';
import { PiAgentAdapter } from './agent/pi-agent-adapter.js';
import { registerRunRoutes } from './routes/runs.js';

export function createApp(config: AppConfig) {
  const app = Fastify({ logger: false });
  const runtime = new AntlerHostRuntime(new PiAgentAdapter({
    provider: config.provider,
    model: config.model,
    openAiApiKey: config.openAiApiKey,
    anthropicAuthToken: config.anthropicAuthToken,
    anthropicBaseUrl: config.anthropicBaseUrl,
    requestTimeoutMs: config.maxRunDurationMs,
    systemPrompt: 'You are Antler, a helpful desktop agent. Answer accurately and concisely.'
  }), { maxRunDurationMs: config.maxRunDurationMs, maxEvents: 10_000 });
  const taskService = new TaskService(runtime);

  registerHttpHooks(app, config);
  registerHealthRoutes(app);
  registerTaskRoutes(app, taskService);
  registerRunRoutes(app, runtime);

  app.setNotFoundHandler(async (request, reply) => {
    if (!request.antlerAuthorized) return reply.code(401).send({ error: '未授权的本地服务请求。' });
    return reply.code(404).send({ error: '路由不存在。' });
  });

  return app;
}
