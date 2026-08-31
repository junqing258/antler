import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from './config/env.js';
import { registerHttpHooks } from './plugins/http.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { TaskService } from './services/task-service.js';
import { AntlerHostRuntime } from './agent/host-runtime.js';
import { PiAgentAdapter } from './agent/pi-agent-adapter.js';
import { DEFAULT_SYSTEM_PROMPT } from './agent/system-prompt.js';
import { registerRunRoutes } from './routes/runs.js';
import type { ProviderRunConfig } from './agent/host-runtime.js';
import { resolve } from 'node:path';

export function createApp(config: AppConfig) {
  const app = Fastify({ logger: false });
  const adapters = new Map<string, PiAgentAdapter>();
  const createAdapter = (provider?: ProviderRunConfig, workingDirectory?: string) => {
    const runtimeConfig = provider
      ? {
          provider: provider.protocol === 'anthropic-messages' ? 'anthropic' as const : 'openai' as const,
          model: provider.model,
          openAiApiKey: provider.protocol === 'openai-responses' ? provider.apiKey : undefined,
          openAiBaseUrl: provider.protocol === 'openai-responses' ? provider.baseUrl : undefined,
          anthropicAuthToken: provider.protocol === 'anthropic-messages' ? provider.apiKey : undefined,
          anthropicBaseUrl: provider.protocol === 'anthropic-messages' ? provider.baseUrl : undefined,
        }
      : {
          provider: config.provider,
          model: config.model,
          openAiApiKey: config.openAiApiKey,
          openAiBaseUrl: config.openAiBaseUrl,
          anthropicAuthToken: config.anthropicAuthToken,
          anthropicBaseUrl: config.anthropicBaseUrl,
        };
    const workspaceRoot = resolve(workingDirectory ?? config.workspaceRoot);
    const key = JSON.stringify({ ...runtimeConfig, workspaceRoot });
    let adapter = adapters.get(key);
    if (!adapter) {
      adapter = new PiAgentAdapter({ ...runtimeConfig, tavilyApiKey: config.tavilyApiKey, workspaceRoot, requestTimeoutMs: config.maxRunDurationMs, systemPrompt: DEFAULT_SYSTEM_PROMPT });
      adapters.set(key, adapter);
    }
    return adapter;
  };
  const runtime = new AntlerHostRuntime(createAdapter, { maxRunDurationMs: config.maxRunDurationMs, maxEvents: 10_000 });
  const taskService = new TaskService(runtime);

  registerHttpHooks(app, config);
  registerHealthRoutes(app);
  registerTaskRoutes(app, taskService);
  registerRunRoutes(app, runtime);

  if (config.staticDir) {
    app.register(fastifyStatic, {
      root: config.staticDir,
      prefix: '/',
      maxAge: '30d',
      immutable: true,
    });
    app.get('/', async (_request, reply) =>
      reply.sendFile('index.html', { maxAge: 0, immutable: false }),
    );
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (!request.antlerAuthorized) return reply.code(401).send({ error: '未授权的本地服务请求。' });
    const path = request.url.split('?', 1)[0];
    if (
      config.staticDir &&
      request.method === 'GET' &&
      request.headers.accept?.includes('text/html') &&
      path !== '/api' &&
      !path.startsWith('/api/')
    ) {
      return reply.sendFile('index.html', { maxAge: 0, immutable: false });
    }
    return reply.code(404).send({ error: '路由不存在。' });
  });

  return app;
}
