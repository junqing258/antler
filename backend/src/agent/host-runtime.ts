import { PlatformError, type AuthContext } from "../platform/errors.js";
import type { PlatformService, RunAgentContext } from "../platform/service.js";
import { normalizeSkillPolicy } from "../skills/skill-policy.js";
import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import {
  isTerminalRunStatus,
  type RunEvent,
  type RunEventType,
  type RunStatus,
} from "./events.js";
import { PiAgentAdapter, PiAdapterError } from "./pi-agent-adapter.js";
import type { SkillPolicy, SkillSnapshot } from "../skills/types.js";
import { DISABLED_SKILL_SNAPSHOT } from "../skills/types.js";
import { SkillRegistry } from "../skills/skill-registry.js";
import { createSkillSnapshot } from "../skills/skill-policy.js";
import type { RunStore } from "../runs/run-store.js";
import { SecretGuard } from "./secret-guard.js";
import { RunTracing } from "../telemetry/tracing.js";
import { withRunContext } from "../run-context.js";

/** 单次运行使用的模型连接配置，由适配器工厂转换为具体 provider 配置。 */
export type ProviderRunConfig = {
  protocol: "openai-responses" | "anthropic-messages";
  baseUrl?: string;
  apiKey: string;
  model: string;
};

/** 可持久化、可返回给客户端的运行记录，不包含控制器和事件监听器。 */
export type Run = {
  id: string;
  userId: string;
  projectId: string;
  conversationId: string;
  agentId?: string | null;
  agentFingerprint?: string | null;
  skillPolicy?: unknown;
  catalogFingerprint?: string | null;
  clientRequestId?: string;
  requestHash?: string;
  expectedRevision?: number;
  executionConfig?: Record<string, unknown>;
  input: string;
  status: RunStatus;
  errorCode?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};
/** 运行期间的内存上下文，包含取消控制、固定技能快照和流式脱敏缓冲。 */
type ActiveRun = {
  run: Run;
  controller: AbortController;
  events: RunEvent[];
  eventTail: Promise<void>;
  listeners: Set<(event: RunEvent) => void>;
  timeout?: NodeJS.Timeout;
  adapter: PiAgentAdapter;
  title?: Promise<string>;
  releaseSkills?: () => void;
  skillSnapshot: SkillSnapshot;
  secretGuard: SecretGuard;
  tracing?: RunTracing;
  // 按输出类型与内容块索引隔离缓冲，避免正文和思考内容互相拼接。
  streams: Map<
    string,
    {
      type: "assistant.delta" | "assistant.thinking.delta";
      stream: ReturnType<SecretGuard["stream"]>;
    }
  >;
};
export type RunAgentConstraints = {
  expectedAgentFingerprint?: string;
  requirePublished?: boolean;
  requireFrozenAgentFields?: boolean;
  frozenAgentFieldsPresent?: boolean;
};
export class ConversationAgentChangedError extends PlatformError {
  constructor() {
    super("agent_changed");
  }
}
export class ConversationBusyError extends Error {}
export class ConversationSkillContextMismatchError extends PlatformError {
  constructor() {
    super("conversation_skill_context_mismatch");
  }
}
/** 调用方可传入已发现的技能快照，或通过 createRunWithSkills 异步发现技能。 */
export type CreateRunOptions = {
  clientRequestId?: string;
  expectedRevision?: number;
  agentId?: string;
  agentConstraints?: RunAgentConstraints;
  /** Legacy persistence field; new callers use Agent ownership instead. */
  projectId?: string;
  userId?: string;
  conversationId?: string;
  provider?: ProviderRunConfig;
  workingDirectory?: string;
  skillPolicy?: SkillPolicy;
  skillSnapshot?: SkillSnapshot;
};
export type HostRuntimeConfig = {
  maxRunDurationMs: number;
  maxEvents: number;
  authMode?: "local" | "supabase";
  defaultExecutionConfig?: Record<string, unknown>;
  resolveWorkingDirectory?: (agentId?: string) => string;
};
/** 管理运行状态和事件发布，将 Pi 事件转换为客户端使用的运行事件。 */
export class AntlerHostRuntime {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly executions = new Set<Promise<void>>();
  private stopping = false;
  private readonly requests = new Map<string, { hash: string; promise: Promise<{ run: Run; skillDiagnostics: SkillSnapshot["diagnostics"] }> }>();
  private readonly conversationSecretGuards = new Map<string, SecretGuard>();
  private readonly modelContexts = new Map<string, unknown>();
  // 会话到当前运行的映射，用于拒绝同一会话的并发运行。
  private readonly activeConversations = new Map<string, string>();
  // 运行结束后仍保留技能约束，保证后续轮次使用相同的策略和目录指纹。
  private readonly skillContexts = new Map<
    string,
    {
      userId: string;
      policy?: SkillPolicy;
      catalogFingerprint?: string;
      agentId: string | null;
      agentFingerprint: string;
    }
  >();
  constructor(
    private readonly createAdapter: (
      config?: ProviderRunConfig,
      workingDirectory?: string,
      agent?: RunAgentContext,
    ) => PiAgentAdapter,
    private readonly config: HostRuntimeConfig,
    private readonly skills?: SkillRegistry,
    private readonly runStore?: RunStore,
    private readonly platform?: PlatformService,
  ) {}
  private auth(userId?: string): AuthContext {
    const auth = {
      userId: userId ?? "",
      authMode: this.config.authMode ?? "local",
    };
    if (auth.authMode === "supabase" && !auth.userId)
      throw new PlatformError("unauthorized", 401);
    return auth;
  }
  private async conversationContext(id: string, auth: AuthContext) {
    let context = this.skillContexts.get(id);
    if (!context) {
      const owners = await this.runStore?.getConversationOwners?.(id);
      if (
        owners &&
        (owners.length > 1 ||
          (auth.authMode === "supabase" &&
            owners.length &&
            owners[0] !== auth.userId))
      )
        throw new PlatformError("conversation_not_found", 404);
      const row = await this.runStore?.getLatestByConversation?.(id);
      if (row) {
        if (
          auth.authMode === "supabase" &&
          (!row.userId || row.userId !== auth.userId)
        )
          throw new PlatformError("conversation_not_found", 404);
        const agentId = row.agentId ?? null;
        const agentFingerprint =
          row.agentFingerprint ?? (agentId === null ? "none" : null);
        if (
          !agentFingerprint ||
          (agentId === null && agentFingerprint !== "none")
        )
          throw new PlatformError("conversation_context_invalid");
        const hasPolicy =
          row.skillPolicy !== null && row.skillPolicy !== undefined;
        const hasFingerprint =
          row.catalogFingerprint !== null &&
          row.catalogFingerprint !== undefined;
        if (hasPolicy !== hasFingerprint || (agentId !== null && !hasPolicy))
          throw new PlatformError("conversation_context_invalid");
        let policy: SkillPolicy | undefined;
        try {
          if (hasPolicy) policy = normalizeSkillPolicy(row.skillPolicy);
        } catch {
          throw new PlatformError("conversation_context_invalid");
        }
        if (
          hasFingerprint &&
          (typeof row.catalogFingerprint !== "string" ||
            !row.catalogFingerprint)
        )
          throw new PlatformError("conversation_context_invalid");
        context = {
          userId: row.userId,
          agentId,
          agentFingerprint,
          policy,
          catalogFingerprint: row.catalogFingerprint ?? undefined,
        };
      }
    }
    if (
      context &&
      auth.authMode === "supabase" &&
      (!context.userId || context.userId !== auth.userId)
    )
      throw new PlatformError("conversation_not_found", 404);
    return context;
  }
  private async preflight(
    conversationId: string,
    requestedAgentId: string | undefined,
    auth: AuthContext,
    constraints?: RunAgentConstraints,
  ) {
    const previous = await this.conversationContext(conversationId, auth);
    const agentId = requestedAgentId ?? previous?.agentId ?? null;
    if (agentId) {
      if (!this.platform) throw new PlatformError("agent_not_found", 404);
      const agent = await this.platform.getAgent(agentId, auth);
      if (constraints?.requirePublished && agent.status !== "published")
        throw new PlatformError("agent_not_published");
    }
    if (previous && agentId !== previous.agentId)
      throw new ConversationAgentChangedError();
    if (
      agentId &&
      constraints?.requireFrozenAgentFields &&
      (!constraints.frozenAgentFieldsPresent ||
        !constraints.expectedAgentFingerprint)
    )
      throw new PlatformError("agent_frozen_fields_missing");
    const resolved = agentId
      ? await this.platform!.resolveAgent(
          agentId,
          auth,
          constraints?.requirePublished,
        )
      : undefined;
    const agentFingerprint = resolved?.context.agentFingerprint ?? "none";
    if (
      (previous && previous.agentFingerprint !== agentFingerprint) ||
      (constraints?.expectedAgentFingerprint &&
        constraints.expectedAgentFingerprint !== agentFingerprint)
    ) {
      resolved?.release();
      throw new PlatformError("agent_context_changed");
    }
    return { agentId, agentFingerprint, previous, resolved };
  }
  /** Resolve/freeze a scheduled task without committing a conversation binding or creating a run. */
  async freezeAgent(
    conversationId: string | undefined,
    agentId: string | undefined,
    userId?: string,
  ) {
    const id = conversationId ?? randomUUID();
    if (this.activeConversations.has(id))
      throw new ConversationBusyError("conversation_busy");
    this.activeConversations.set(id, "preflight");
    try {
      const result = await this.preflight(id, agentId, this.auth(userId), {
        requirePublished: true,
      });
      result.resolved?.release();
      return {
        agentId: result.agentId,
        agentFingerprint: result.agentFingerprint,
      };
    } finally {
      this.activeConversations.delete(id);
    }
  }
  async createRun(input: string, options: CreateRunOptions): Promise<Run> {
    return (await this.createInternal(input, options, "disabled")).run;
  }
  async createRunWithSkills(
    input: string,
    options: CreateRunOptions,
  ): Promise<{ run: Run; skillDiagnostics: SkillSnapshot["diagnostics"] }> {
    return this.createInternal(input, options, "auto");
  }
  private createInternal(input: string, options: CreateRunOptions, defaultMode: "auto" | "disabled") {
    if (!options.clientRequestId) return this.createInternalUnlocked(input, options, defaultMode);
    const { apiKey: _key, ...provider } = options.provider ?? {};
    const hash = createHash("sha256").update(JSON.stringify({ input, ...options, provider })).digest("hex");
    const key = JSON.stringify([this.auth(options.userId).userId, options.clientRequestId]);
    const existing = this.requests.get(key);
    if (existing) {
      if (existing.hash !== hash) return Promise.reject(new PlatformError("client_request_conflict"));
      return existing.promise;
    }
    const promise = this.createInternalUnlocked(input, options, defaultMode).finally(() => this.requests.delete(key));
    this.requests.set(key, { hash, promise });
    return promise;
  }
  private async createInternalUnlocked(
    input: string,
    options: CreateRunOptions,
    defaultMode: "auto" | "disabled",
  ) {
    if (this.stopping) throw new PlatformError("service_unavailable", 503);
    const conversationId = options.conversationId ?? randomUUID();
    const { apiKey: _credential, ...providerConfig } = options.provider ?? {};
    const requestHash = createHash("sha256").update(JSON.stringify({ input, conversationId, providerConfig, workingDirectory: options.workingDirectory, agentId: options.agentId, skillPolicy: options.skillPolicy, expectedRevision: options.expectedRevision })).digest("hex");
    if (options.clientRequestId) {
      const prior = await this.runStore?.findRequest?.(this.auth(options.userId).userId, options.clientRequestId, requestHash);
      if (prior) return { run: prior, skillDiagnostics: [] };
    }
    if (this.activeConversations.has(conversationId))
      throw new ConversationBusyError("conversation_busy");
    this.activeConversations.set(conversationId, "creating");
    let release: (() => void) | undefined;
    let persisted: Run | undefined;
    try {
      const auth = this.auth(options.userId);
      const bound = await this.runStore?.getExecution?.(auth.userId, conversationId);
      if (bound) {
        const config = bound.config;
        if (options.provider) {
          const endpoint = (value: unknown) => typeof value === "string" ? value.replace(/\/+$/, "") : "";
          if (options.provider.protocol !== config.protocol || options.provider.model !== config.model || endpoint(options.provider.baseUrl) !== endpoint(config.baseUrl)) throw new PlatformError("conversation_execution_config_mismatch");
        } else if (config.credentialSource === "client") throw new PlatformError("credential_required");
        if (options.workingDirectory && options.workingDirectory !== config.workingDirectory) throw new PlatformError("conversation_execution_config_mismatch");
        options = { ...options, workingDirectory: String(config.workingDirectory || "") || undefined };
      }
      const preflight = await this.preflight(
        conversationId,
        options.agentId,
        auth,
        options.agentConstraints,
      );
      release = preflight.resolved?.release;
      if (bound && !this.modelContexts.has(conversationId)) {
        const checkpoint = bound.checkpoint as { schemaVersion?: unknown; messages?: unknown } | null;
        if (bound.contextState !== "available" || checkpoint?.schemaVersion !== 1 || !Array.isArray(checkpoint.messages)) throw new PlatformError("conversation_context_not_restored");
      }
      if (bound?.checkpoint && !this.modelContexts.has(conversationId)) this.modelContexts.set(conversationId, bound.checkpoint);
      const policy = normalizeSkillPolicy(
        preflight.resolved
          ? { mode: "selected", skillIds: preflight.resolved.context.skillIds }
          : (options.skillPolicy ?? { mode: defaultMode }),
      );
      options = { ...options, workingDirectory: options.workingDirectory ?? this.config.resolveWorkingDirectory?.(preflight.agentId ?? undefined) };
      const workspaceRoot = options.workingDirectory ?? "";
      const catalog =
        preflight.resolved ??
        (policy.mode !== "disabled"
          ? await this.skills?.list(options.workingDirectory)
          : undefined);
      let snapshot: SkillSnapshot = preflight.resolved
        ? createSkillSnapshot(workspaceRoot, policy, preflight.resolved)
        : (options.skillSnapshot ??
          (catalog
            ? createSkillSnapshot(workspaceRoot, policy, catalog)
            : { ...DISABLED_SKILL_SNAPSHOT, workspaceRoot }));
      snapshot = {
        ...snapshot,
        contextFingerprint: preflight.agentId
          ? preflight.agentFingerprint
          : snapshot.catalogFingerprint,
      };
      const previous = preflight.previous;
      if (
        !preflight.agentId &&
        previous?.policy &&
        (JSON.stringify(previous.policy) !== JSON.stringify(policy) ||
          previous.catalogFingerprint !== snapshot.catalogFingerprint)
      )
        throw new ConversationSkillContextMismatchError();
      const executionConfig = { schemaVersion: 1, ...(options.provider ? { ...providerConfig, baseUrl: (options.provider.baseUrl ?? "").replace(/\/+$/, ""), credentialSource: "client" } : this.config.defaultExecutionConfig), workingDirectory: options.workingDirectory ?? this.config.defaultExecutionConfig?.workingDirectory ?? "", agentFingerprint: preflight.agentFingerprint, catalogFingerprint: snapshot.catalogFingerprint };
      if (bound && !isDeepStrictEqual(bound.config, executionConfig)) throw new PlatformError("conversation_execution_config_mismatch");
      const run: Run = {
        id: randomUUID(),
        clientRequestId: options.clientRequestId,
        requestHash,
        expectedRevision: options.expectedRevision,
        executionConfig,
        userId: previous?.userId ?? auth.userId,
        projectId: options.projectId ?? "default",
        conversationId,
        input,
        status: "queued",
        createdAt: new Date().toISOString(),
        agentId: preflight.agentId,
        agentFingerprint: preflight.agentFingerprint,
        skillPolicy: policy,
        catalogFingerprint: snapshot.catalogFingerprint,
      };
      if (this.stopping) throw new PlatformError("service_unavailable", 503);
      await this.runStore?.create(run);
      persisted = run;
      this.skillContexts.set(conversationId, {
        userId: run.userId,
        policy,
        catalogFingerprint: snapshot.catalogFingerprint,
        agentId: preflight.agentId,
        agentFingerprint: preflight.agentFingerprint,
      });
      const adapter = this.createAdapter(
        options.provider,
        options.workingDirectory,
        preflight.resolved?.context,
      );
      const checkpoint = this.modelContexts.get(conversationId) as { schemaVersion?: number; messages?: import("@earendil-works/pi-agent-core").AgentMessage[] } | undefined;
      if (checkpoint?.schemaVersion === 1 && checkpoint.messages) {
        adapter.importContext?.(conversationId, checkpoint.messages);
        if (input.trim() === "/compact") await adapter.run("", conversationId, snapshot, new AbortController().signal, () => {}, true);
      }
      const active: ActiveRun = {
        run,
        controller: new AbortController(),
        events: [],
        eventTail: Promise.resolve(),
        listeners: new Set(),
        adapter,
        secretGuard:
          adapter.secretGuard ??
          new SecretGuard(options.workingDirectory, undefined, [
            options.provider?.apiKey,
          ]),
        streams: new Map(),
        skillSnapshot: snapshot,
        releaseSkills: release,
      };
      const previousGuard = this.conversationSecretGuards.get(conversationId);
      if (previousGuard) active.secretGuard.inheritSecrets?.(previousGuard);
      this.conversationSecretGuards.set(conversationId, active.secretGuard);
      this.runs.set(run.id, active);
      this.activeConversations.set(conversationId, run.id);
      const tracing = new RunTracing(run, (value) =>
        active.secretGuard.redact(value),
      );
      active.tracing = tracing;
      const execution = new Promise<void>((resolve) =>
        queueMicrotask(resolve),
      ).then(() =>
        tracing.withContext(async () => {
          try {
            await withRunContext({ userId: run.userId }, () =>
              this.execute(active),
            );
          } finally {
            active.releaseSkills?.();
            this.activeConversations.delete(conversationId);
            tracing.finish(active.run.status, active.run.errorCode);
          }
        }),
      );
      this.executions.add(execution);
      void execution
        .catch((error: unknown) =>
          console.error("Run persistence failed", error),
        )
        .finally(() => this.executions.delete(execution));
      return { run, skillDiagnostics: snapshot.diagnostics };
    } catch (error) {
      release?.();
      this.activeConversations.delete(conversationId);
      if (persisted) {
        persisted.status = "failed";
        persisted.errorCode = "run_initialization_failed";
        persisted.finishedAt = new Date().toISOString();
        await this.runStore?.update(persisted);
      }
      throw error;
    }
  }
  /** 优先读取已提交状态，避免 SSE 在终态事件落库之前提前关闭。 */
  async getRun(runId: string, userId?: string) {
    const run = (await this.runStore?.get(runId)) ?? this.runs.get(runId)?.run;
    if (!run || (userId !== undefined && run.userId !== userId))
      return undefined;
    return run;
  }
  /** 标题独立于运行终态；同一运行的重复请求复用结果，失败可重试。 */
  async generateTitle(
    runId: string,
    userId?: string,
  ): Promise<string | undefined> {
    const active = this.runs.get(runId);
    if (!active || (userId !== undefined && active.run.userId !== userId))
      return undefined;
    if (
      active.run.status !== "succeeded" ||
      active.run.input.trim() === "/compact"
    )
      throw new PiAdapterError(
        "conversation_context_empty",
        "当前运行无法生成标题。",
      );
    if (!active.title) {
      const response = active.events
        .filter((event) => event.type === "assistant.delta")
        .map((event) => event.payload.delta as string)
        .join("");
      active.title = active.adapter
        .generateTitle(
          active.run.conversationId,
          active.run.input,
          response,
          AbortSignal.timeout(Math.min(this.config.maxRunDurationMs, 30_000)),
        )
        .catch((error) => {
          active.title = undefined;
          throw error;
        });
    }
    return active.title;
  }
  /** 只返回指定事件 ID 之后的事件，支持客户端断线后的增量回放。 */
  async getEvents(runId: string, afterEventId = 0) {
    return (
      this.runs.get(runId)?.events.filter((event) => event.id > afterEventId) ??
      (await this.runStore?.getEvents(runId, afterEventId)) ??
      []
    );
  }
  /** 订阅后续事件并返回解除订阅函数；历史事件需通过 getEvents 获取。 */
  subscribe(runId: string, listener: (event: RunEvent) => void) {
    const active = this.runs.get(runId);
    if (!active) return undefined;
    active.listeners.add(listener);
    return () => active.listeners.delete(listener);
  }
  /** 发出取消信号，最终状态由执行流程统一收尾后写入。 */
  async cancel(runId: string, userId?: string) {
    const active = this.runs.get(runId);
    if (!active || (userId !== undefined && active.run.userId !== userId))
      return undefined;
    if (!isTerminalRunStatus(active.run.status)) active.controller.abort();
    return active.run;
  }
  async getConversationRevision(id: string, userId?: string) {
    return (await this.runStore?.getExecution?.(this.auth(userId).userId, id))?.revision;
  }
  hasConversationContext(id: string) { return this.modelContexts.has(id) || this.activeConversations.has(id); }
  async stop() {
    this.stopping = true;
    for (const active of this.runs.values())
      if (!isTerminalRunStatus(active.run.status)) active.controller.abort();
    await Promise.allSettled([...this.executions]);
  }
  /** 委托存储层处理服务重启后遗留的未完成运行。 */
  async recoverInterrupted() {
    await this.runStore?.recoverInterrupted();
  }
  /** 调用模型并收尾；取消信号优先于模型成功或异常结果。 */
  private async execute(active: ActiveRun) {
    const { run } = active;
    if (active.controller.signal.aborted)
      return await this.finish(active, "cancelled");
    run.status = "running";
    run.startedAt = new Date().toISOString();
    try {
      try { await this.runStore?.getExecution?.(run.userId, run.conversationId); }
      catch (error) {
        if (error instanceof PlatformError && error.statusCode === 404) return await this.finish(active, "cancelled");
        throw error;
      }
      await active.secretGuard.refresh();
      if (run.input.trim() === "/compact") {
        await this.emit(
          active,
          "run.started",
          { runId: run.id, status: run.status },
          true,
        );
        active.timeout = setTimeout(
          () => active.controller.abort(),
          this.config.maxRunDurationMs,
        );
        const result = await active.adapter.compact(
          run.conversationId,
          active.skillSnapshot,
          active.controller.signal,
        );
        // compact 返回时上下文已提交；之后到达的取消不会撤销已完成的压缩。
        clearTimeout(active.timeout);
        await this.emit(active, "assistant.delta", {
          runId: run.id,
          delta: `会话上下文已压缩（${result.beforeMessages} 条历史消息 → 1 条摘要），聊天记录已保留。\n\n${result.summary}`,
        });
        await this.finish(active, "succeeded");
        return;
      }
      await this.emit(
        active,
        "run.started",
        { runId: run.id, status: run.status },
        true,
      );
      // 计时从模型调用前开始；超时和主动取消共用 AbortController。
      active.timeout = setTimeout(
        () => active.controller.abort(),
        this.config.maxRunDurationMs,
      );
      await active.adapter.run(
        run.input,
        run.conversationId,
        active.skillSnapshot,
        active.controller.signal,
        (event) => this.mapPiEvent(active, event),
      );
      await this.finish(
        active,
        active.controller.signal.aborted ? "cancelled" : "succeeded",
      );
    } catch (error) {
      if (active.controller.signal.aborted)
        await this.finish(active, "cancelled");
      else {
        const code =
          error instanceof PiAdapterError || error instanceof PlatformError
            ? error.code
            : "provider_error";
        await this.finish(
          active,
          "failed",
          code,
          error instanceof Error ? error.message : "模型调用失败。",
        );
      }
    }
  }
  /** 将 Pi 的消息、轮次和工具事件映射为宿主事件，只发布客户端需要的内容。 */
  private async mapPiEvent(active: ActiveRun, event: AgentEvent) {
    // 工具可能更新环境变量，在处理输出前补充最新的秘密集合。
    active.secretGuard.captureEnvironment();
    active.tracing?.observe(event);
    const runId = active.run.id;
    if (
      event.type === "message_update" &&
      (event.assistantMessageEvent.type === "text_delta" ||
        event.assistantMessageEvent.type === "thinking_delta")
    ) {
      const update = event.assistantMessageEvent;
      const type =
        update.type === "text_delta"
          ? "assistant.delta"
          : "assistant.thinking.delta";
      const key = `${type}:${update.contentIndex}`;
      // 脱敏器保留可能跨 delta 分片的秘密前缀，避免逐片脱敏造成泄露。
      let buffered = active.streams.get(key);
      if (!buffered) {
        buffered = { type, stream: active.secretGuard.stream() };
        active.streams.set(key, buffered);
      }
      const delta = buffered.stream.push(update.delta);
      if (delta) await this.emit(active, type, { runId, delta });
    } else if (event.type === "message_end" || event.type === "turn_end") {
      // 消息或轮次结束时输出缓冲尾部，随后再发布步骤完成事件。
      await this.flushStreams(active);
      if (event.type === "turn_end")
        await this.emit(active, "step.completed", {
          runId,
          stepId: `turn-${active.events.length}`,
          kind: "model",
        });
    } else if (event.type === "turn_start")
      await this.emit(active, "step.started", {
        runId,
        stepId: `turn-${active.events.length + 1}`,
        kind: "model",
      });
    else if (event.type === "tool_execution_start")
      await this.emit(active, "step.started", {
        runId,
        stepId: event.toolCallId,
        kind: "tool",
        tool: event.toolName,
        args: event.args,
      });
    else if (event.type === "tool_execution_end") {
      const isSkillTool =
        event.toolName === "load_skill" ||
        event.toolName === "read_skill_resource";
      const details = (
        event.result as { details?: Record<string, unknown> } | undefined
      )?.details;
      await this.emit(active, "tool.completed", {
        runId,
        stepId: event.toolCallId,
        tool: event.toolName,
        summary: event.isError ? "工具执行失败。" : "工具执行完成。",
        // 技能正文仍作为工具结果供模型使用；客户端 SSE 只接收详情元数据，
        // 不复制技能指令或资源正文。
        result: isSkillTool
          ? (details ?? { tool: event.toolName })
          : event.result,
        isError: event.isError,
      });
    }
  }
  /** 结束所有内容块的脱敏流，并发布尚未输出的安全文本。 */
  private async flushStreams(active: ActiveRun) {
    const streams = [...active.streams.values()];
    active.streams.clear();
    for (const { type, stream } of streams) {
      const delta = stream.finish();
      if (delta) await this.emit(active, type, { runId: active.run.id, delta });
    }
  }
  /** 统一释放计时器和会话占用，并发布、持久化运行的终态事件。 */
  private async finish(
    active: ActiveRun,
    status: Extract<RunStatus, "succeeded" | "failed" | "cancelled">,
    errorCode?: string,
    error?: string,
  ) {
    // 已进入终态的运行不重复收尾；尾部文本应先于终态事件发布。
    if (isTerminalRunStatus(active.run.status)) return;
    await this.flushStreams(active);
    const messages = active.adapter.exportContext?.(active.run.conversationId);
    if (messages) {
      const checkpoint = { schemaVersion: 1, messages };
      this.modelContexts.set(active.run.conversationId, structuredClone(checkpoint));
      const safe = active.secretGuard.sanitize(checkpoint);
      const restorable = isDeepStrictEqual(safe, checkpoint);
      await this.runStore?.saveCheckpoint?.(active.run.userId, active.run.conversationId, restorable ? checkpoint : { schemaVersion: 1, unavailable: true }, restorable ? "available" : "unavailable");
    }
    if (active.timeout) clearTimeout(active.timeout);
    active.run.status = status;
    active.run.errorCode = errorCode;
    active.run.finishedAt = new Date().toISOString();

    const type: RunEventType =
      status === "succeeded"
        ? "run.completed"
        : status === "cancelled"
          ? "run.cancelled"
          : "run.failed";
    await this.emit(
      active,
      type,
      {
        runId: active.run.id,
        status,
        ...(error ? { error: { code: errorCode, message: error } } : {}),
      },
      true,
    );
    if (status === "succeeded" && active.run.input.trim() !== "/compact" && this.runStore?.generatedTitle) {
      // Title work is independent of the conversation run lock and browser lifetime.
      const titleJob = Promise.resolve().then(async () => {
        try {
          const conversation = await this.runStore?.getExecution?.(active.run.userId, active.run.conversationId);
          if (conversation?.titleSource && conversation.titleSource !== "fallback") return;
          const title = await this.generateTitle(active.run.id, active.run.userId);
          if (title) await this.runStore!.generatedTitle!(active.run.userId, active.run.conversationId, title);
        } catch { /* Keep the first-message fallback. */ }
      });
      this.executions.add(titleJob);
      void titleJob.finally(() => this.executions.delete(titleJob));
    }
  }
  /** 统一分配事件 ID、脱敏和持久化，保存完成后再通知实时订阅者。 */
  private emit(active: ActiveRun, type: RunEventType, payload: Record<string, unknown>, isStateTransition = false) {
    const next = active.eventTail.then(() => this.emitInternal(active, type, payload, isStateTransition));
    active.eventTail = next;
    return next;
  }
  private async emitInternal(
    active: ActiveRun,
    type: RunEventType,
    payload: Record<string, unknown>,
    isStateTransition = false,
  ) {
    active.secretGuard.captureEnvironment();
    // 内容字段脱敏，路由标识和状态字段保留原值，保证客户端能关联运行与步骤。
    const { runId, stepId, kind, tool, status, ...content } = payload;
    const safePayload = {
      ...active.secretGuard.sanitize(content),
      ...(runId !== undefined ? { runId } : {}),
      ...(stepId !== undefined ? { stepId } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(tool !== undefined ? { tool } : {}),
      ...(status !== undefined ? { status } : {}),
    };
    // 达到事件上限时请求取消；当前事件及之后的收尾事件仍可记录。
    if (
      active.events.length >= this.config.maxEvents &&
      !isTerminalRunStatus(active.run.status)
    )
      active.controller.abort();
    const event: RunEvent = {
      id: active.events.length + 1,
      runId: active.run.id,
      type,
      payload: safePayload,
      createdAt: new Date().toISOString(),
    };
    // 状态迁移交由存储层同时保存运行记录与事件，普通事件只追加日志。
    if (isStateTransition) await this.runStore?.transition(active.run, event);
    else await this.runStore?.appendEvent(event);
    active.events.push(event);
    for (const listener of active.listeners) {
      try { listener(event); } catch { /* A disconnected consumer cannot break persistence. */ }
    }
  }
}
