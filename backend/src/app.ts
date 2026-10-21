import { agentWorkspace } from "./platform/agent-workspace.js";
import { createHash } from "node:crypto";
import { PlatformService, type RunAgentContext } from "./platform/service.js";
import { PlatformError } from "./platform/errors.js";
import { migrateFileSkills } from "./platform/skill-files.js";
import { registerAgentRoutes } from "./routes/agents.js";
import {
  hasFrozenAgentFields,
  type ServiceTaskPayload,
} from "./scheduler/types.js";
import Fastify from "fastify";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./config/env.js";
import { registerHttpHooks } from "./plugins/http.js";
import {
  createRequestId,
  registerRequestLogging,
} from "./plugins/request-logging.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { TaskService } from "./services/task-service.js";
import { AntlerHostRuntime } from "./agent/host-runtime.js";
import { PiAgentAdapter } from "./agent/pi-agent-adapter.js";
import { DEFAULT_SYSTEM_PROMPT } from "./agent/system-prompt.js";
import { registerRunRoutes } from "./routes/runs.js";
import type { ProviderRunConfig } from "./agent/host-runtime.js";
import { basename, resolve, sep } from "node:path";
import { SkillRegistry } from "./skills/skill-registry.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerDirectoryRoutes } from "./routes/directories.js";
import { mkdirSync, mkdtempSync } from "node:fs";
import { chmod, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDatabase } from "./plugins/database.js";
import { PrismaRunStore } from "./runs/run-store.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerAuthConfigRoutes } from "./routes/auth-config.js";
import { RagConfigStore } from "./config/rag-config.js";
import { TaskExecutor } from "./scheduler/executor.js";
import { CronScheduler } from "./scheduler/scheduler.js";
import { SchedulerService } from "./scheduler/service.js";
import { registerSchedulerRoutes } from "./routes/scheduler.js";
import type { ServiceRegistry } from "./scheduler/types.js";
import { registerRequestTracing } from "./plugins/request-tracing.js";
import { currentRunUserId } from "./run-context.js";

export function createApp(config: AppConfig) {
  mkdirSync(config.workspaceRoot, { recursive: true });
  // Schema-free embedded apps have ephemeral storage just like their in-memory database.
  const ephemeralPlatform =
    !config.databaseUrl && !config.platformRoot
      ? mkdtempSync(join(tmpdir(), "antler-platform-memory-"))
      : undefined;
  const platformRoot = resolve(
    config.platformRoot ??
      ephemeralPlatform ??
      resolve(config.workspaceRoot, "../.antler-platform"),
  );
  const authMode = config.authMode ?? "local";
  const ragConfig = new RagConfigStore(config, config.workspaceRoot);
  const app = Fastify({ logger: false, genReqId: createRequestId });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof PlatformError)
      return reply
        .code(error.statusCode)
        .send({ error: error.code, ...error.details });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({
      error: status >= 500 ? "internal_error" : (error as Error).message,
    });
  });
  registerRequestTracing(app);
  registerRequestLogging(app);
  let scheduler: CronScheduler | undefined;
  registerDatabase(app, config.databaseUrl, async () => {
    await scheduler?.stop();
    await runtime.stop();
    if (ephemeralPlatform)
      await rm(ephemeralPlatform, { recursive: true, force: true });
  });
  const adapters = new Map<string, PiAgentAdapter>();
  const createAdapter = (
    provider?: ProviderRunConfig,
    workingDirectory?: string,
    agent?: RunAgentContext,
  ) => {
    const runtimeConfig = provider
      ? {
          provider:
            provider.protocol === "anthropic-messages"
              ? ("anthropic" as const)
              : ("openai" as const),
          model: provider.model,
          openAiApiKey:
            provider.protocol === "openai-responses"
              ? provider.apiKey
              : undefined,
          openAiBaseUrl:
            provider.protocol === "openai-responses"
              ? provider.baseUrl
              : undefined,
          anthropicAuthToken:
            provider.protocol === "anthropic-messages"
              ? provider.apiKey
              : undefined,
          anthropicBaseUrl:
            provider.protocol === "anthropic-messages"
              ? provider.baseUrl
              : undefined,
        }
      : {
          provider: config.provider,
          model: config.model,
          openAiApiKey: config.openAiApiKey,
          openAiBaseUrl: config.openAiBaseUrl,
          anthropicAuthToken: config.anthropicAuthToken,
          anthropicBaseUrl: config.anthropicBaseUrl,
        };
    const workspaceRoot = resolve(
      workingDirectory ??
        (agent
          ? agentWorkspace(config.workspaceRoot, agent.agentId)
          : config.workspaceRoot),
    );
    const systemPrompt = agent?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const key = JSON.stringify({
      ...runtimeConfig,
      workspaceRoot,
      agentId: agent?.agentId,
      promptHash: createHash("sha256").update(systemPrompt).digest("hex"),
    });
    let adapter = adapters.get(key);
    if (!adapter) {
      adapter = new PiAgentAdapter({
        ...runtimeConfig,
        tavilyApiKey: config.tavilyApiKey,
        smtp: config.smtp,
        getToolEnvironment: () => ragConfig.environment(),
        workspaceRoot,
        platformRoot,
        requestTimeoutMs: config.maxRunDurationMs,
        systemPrompt,
        schedulerService,
      });
      adapters.set(key, adapter);
    }
    return adapter;
  };
  const skillRegistry = new SkillRegistry(config.agentsDir);
  const platform = new PlatformService(app.prisma, platformRoot, skillRegistry);
  const runtime = new AntlerHostRuntime(
    createAdapter,
    { maxRunDurationMs: config.maxRunDurationMs, maxEvents: 10_000, authMode },
    skillRegistry,
    new PrismaRunStore(app.prisma),
    platform,
  );
  // Test-only in-memory apps do not run migrations. Normal server startup has
  // a configured SQLite file and marks any process-interrupted run terminal
  // before serving replay requests.
  app.addHook("onReady", async () => {
    await mkdir(platformRoot, { recursive: true, mode: 0o700 });
    const actualRoot = await realpath(platformRoot);
    const actualWorkspace = await realpath(config.workspaceRoot);
    if (actualRoot === actualWorkspace || actualRoot.startsWith(`${actualWorkspace}${sep}`))
      throw new Error("ANTLER_PLATFORM_ROOT must be outside ANTLER_WORKSPACE_ROOT");
    await chmod(platformRoot, 0o700);
    if (config.databaseUrl) {
      // One-time backfill of legacy on-disk skill directories into skill_files.
      await migrateFileSkills(app.prisma, platformRoot);
      await platform.ensureBuiltinAgents();
      await runtime.recoverInterrupted();
    }
  });
  const taskService = new TaskService(runtime);
  const serviceRegistry: ServiceRegistry = new Map([
    [
      "taskService",
      {
        create: (payload: ServiceTaskPayload, signal: AbortSignal) => {
          signal.throwIfAborted();
          const [message, conversationId] = payload.args ?? [];
          if (
            typeof message !== "string" ||
            !message.trim() ||
            (conversationId !== undefined && typeof conversationId !== "string")
          )
            throw new Error("taskService.create 参数无效");
          return taskService.create(
            message,
            conversationId,
            currentRunUserId(),
            payload.agentId,
            {
              expectedAgentFingerprint: payload.agentFingerprint,
              requirePublished: true,
              requireFrozenAgentFields: true,
              frozenAgentFieldsPresent: hasFrozenAgentFields(payload),
            },
          );
        },
        get: (...args: unknown[]) => {
          const [id] = args.slice(0, -1);
          if (typeof id !== "string" || !id)
            throw new Error("taskService.get 参数无效");
          return taskService.get(id, currentRunUserId());
        },
      },
    ],
  ]);
  scheduler = new CronScheduler(
    new TaskExecutor(
      app.prisma,
      serviceRegistry,
      config.schedulerEnableScript ?? false,
    ),
    app.prisma,
  );
  // Schema-free in-memory test apps omit databaseUrl, just like run recovery above.
  if (config.databaseUrl) app.addHook("onReady", () => scheduler!.start());
  const schedulerService = new SchedulerService(
    app.prisma,
    scheduler,
    (conversationId, agentId, userId) =>
      runtime.freezeAgent(conversationId, agentId, userId),
  );

  registerHttpHooks(app, config);
  registerHealthRoutes(app);
  registerTaskRoutes(app, taskService);
  registerRunRoutes(app, runtime);
  registerSkillRoutes(app, platform, authMode);
  registerAgentRoutes(app, platform, authMode, config.workspaceRoot);
  registerDirectoryRoutes(app, config.workspaceRoot);
  registerConfigRoutes(app, ragConfig, config);
  registerAuthConfigRoutes(app, config);
  registerSchedulerRoutes(app, schedulerService);

  if (config.staticDir) {
    app.register(fastifyCompress);
    app.register(fastifyStatic, {
      root: config.staticDir,
      prefix: "/",
      maxAge: "30d",
      immutable: true,
      setHeaders(reply, path) {
        // These stable URLs must be revalidated to discover new app versions.
        if (
          ["sw.js", "manifest.webmanifest", "index.html"].includes(
            basename(path),
          )
        )
          reply.header("cache-control", "public, max-age=0, must-revalidate");
      },
    });
    app.get("/", async (_request, reply) =>
      reply.sendFile("index.html", { maxAge: 0, immutable: false }),
    );
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (!request.antlerAuthorized)
      return reply.code(401).send({
        error:
          config.authMode === "supabase"
            ? "未登录或登录已过期。"
            : "未授权的本地服务请求。",
      });
    const path = request.url.split("?", 1)[0];
    if (
      config.staticDir &&
      request.method === "GET" &&
      request.headers.accept?.includes("text/html") &&
      path !== "/api" &&
      !path.startsWith("/api/")
    ) {
      return reply.sendFile("index.html", { maxAge: 0, immutable: false });
    }
    return reply.code(404).send({ error: "路由不存在。" });
  });

  return app;
}
