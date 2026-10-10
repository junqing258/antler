import { randomUUID } from "node:crypto";
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
import {
  EmptyKnowledgeContext,
  type KnowledgeContextPort,
  type KnowledgePolicy,
} from "../knowledge/types.js";
import type { RunStore } from "../runs/run-store.js";
import { SecretGuard } from "./secret-guard.js";

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
  projectId: string;
  conversationId: string;
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
  listeners: Set<(event: RunEvent) => void>;
  timeout?: NodeJS.Timeout;
  adapter: PiAgentAdapter;
  skillSnapshot: SkillSnapshot;
  knowledgePolicy: KnowledgePolicy;
  secretGuard: SecretGuard;
  // 按输出类型与内容块索引隔离缓冲，避免正文和思考内容互相拼接。
  streams: Map<
    string,
    {
      type: "assistant.delta" | "assistant.thinking.delta";
      stream: ReturnType<SecretGuard["stream"]>;
    }
  >;
};
export class ConversationBusyError extends Error {}
export class ConversationSkillContextMismatchError extends Error {
  constructor() {
    super("conversation_skill_context_mismatch");
  }
}
/** 调用方可传入已发现的技能快照，或通过 createRunWithSkills 异步发现技能。 */
export type CreateRunOptions = {
  projectId: string;
  conversationId?: string;
  provider?: ProviderRunConfig;
  workingDirectory?: string;
  skillPolicy?: SkillPolicy;
  skillSnapshot?: SkillSnapshot;
  knowledgePolicy?: KnowledgePolicy;
};
export type HostRuntimeConfig = { maxRunDurationMs: number; maxEvents: number };
/** 管理运行状态、知识检索和事件发布，将 Pi 事件转换为客户端使用的运行事件。 */
export class AntlerHostRuntime {
  private readonly runs = new Map<string, ActiveRun>();
  // 会话到当前运行的映射，用于拒绝同一会话的并发运行。
  private readonly activeConversations = new Map<string, string>();
  // 运行结束后仍保留技能约束，保证后续轮次使用相同的策略和目录指纹。
  private readonly skillContexts = new Map<
    string,
    { policy: SkillPolicy; catalogFingerprint: string }
  >();
  constructor(
    private readonly createAdapter: (
      config?: ProviderRunConfig,
      workingDirectory?: string,
    ) => PiAgentAdapter,
    private readonly config: HostRuntimeConfig,
    private readonly skills?: SkillRegistry,
    private readonly runStore?: RunStore,
    private readonly knowledge: KnowledgeContextPort = new EmptyKnowledgeContext(),
  ) {}
  /** 创建并持久化 queued 记录，再调度后台执行；返回值不等待模型调用完成。 */
  async createRun(input: string, options: CreateRunOptions): Promise<Run> {
    const conversationId = options.conversationId ?? randomUUID();
    if (this.activeConversations.has(conversationId))
      throw new ConversationBusyError("conversation_busy");
    const policy = options.skillPolicy ?? { mode: "disabled" as const };
    const workspaceRoot = options.workingDirectory ?? "";
    const snapshot =
      options.skillSnapshot ??
      (policy.mode === "disabled"
        ? { ...DISABLED_SKILL_SNAPSHOT, workspaceRoot }
        : (() => {
            throw new Error("Skill registry unavailable");
          })());
    // 技能发现需要异步读取目录；启用技能时应预先传入快照，
    // 或通过 createRunWithSkills 完成发现后再进入此创建流程。
    const context = this.skillContexts.get(conversationId);
    if (
      context &&
      (JSON.stringify(context.policy) !== JSON.stringify(policy) ||
        context.catalogFingerprint !== snapshot.catalogFingerprint)
    )
      throw new ConversationSkillContextMismatchError();
    if (!context)
      this.skillContexts.set(conversationId, {
        policy,
        catalogFingerprint: snapshot.catalogFingerprint,
      });
    const now = new Date().toISOString();
    const run: Run = {
      id: randomUUID(),
      projectId: options.projectId,
      conversationId,
      input,
      status: "queued",
      createdAt: now,
    };
    // 先保存运行记录，再构造执行上下文，供后续事件关联到该运行。
    await this.runStore?.create(run);
    const adapter = this.createAdapter(
      options.provider,
      options.workingDirectory,
    );
    const active: ActiveRun = {
      run,
      controller: new AbortController(),
      events: [],
      listeners: new Set(),
      adapter,
      secretGuard:
        adapter.secretGuard ??
        new SecretGuard(options.workingDirectory, undefined, [
          options.provider?.apiKey,
        ]),
      streams: new Map(),
      skillSnapshot: snapshot,
      knowledgePolicy: options.knowledgePolicy ?? { mode: "disabled" },
    };
    this.runs.set(run.id, active);
    this.activeConversations.set(conversationId, run.id);
    // 入队后异步启动，使调用方无需等待知识检索或模型响应。
    queueMicrotask(() => void this.execute(active));
    return run;
  }
  /** 按策略发现技能并生成快照，同时向调用方返回技能加载诊断。 */
  async createRunWithSkills(
    input: string,
    options: CreateRunOptions,
  ): Promise<{ run: Run; skillDiagnostics: SkillSnapshot["diagnostics"] }> {
    const policy = options.skillPolicy ?? { mode: "auto" as const };
    const workspaceRoot = options.workingDirectory ?? "";
    const catalog =
      policy.mode === "disabled"
        ? undefined
        : await this.skills?.list(options.workingDirectory);
    const snapshot = catalog
      ? createSkillSnapshot(workspaceRoot, policy, catalog)
      : { ...DISABLED_SKILL_SNAPSHOT, workspaceRoot };
    const id = options.conversationId ?? randomUUID();
    const context = this.skillContexts.get(id);
    if (
      context &&
      (JSON.stringify(context.policy) !== JSON.stringify(policy) ||
        context.catalogFingerprint !== snapshot.catalogFingerprint)
    )
      throw new ConversationSkillContextMismatchError();
    if (this.activeConversations.has(id))
      throw new ConversationBusyError("conversation_busy");
    const run = await this.createRun(input, {
      ...options,
      conversationId: id,
      skillPolicy: policy,
      skillSnapshot: snapshot,
    });
    return { run, skillDiagnostics: snapshot.diagnostics };
  }
  /** 优先读取内存中的最新状态；重启前的运行则从持久化存储读取。 */
  async getRun(runId: string) {
    return this.runs.get(runId)?.run ?? (await this.runStore?.get(runId));
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
  async cancel(runId: string) {
    const active = this.runs.get(runId);
    if (!active) return undefined;
    if (!isTerminalRunStatus(active.run.status)) active.controller.abort();
    return active.run;
  }
  /** 委托存储层处理服务重启后遗留的未完成运行。 */
  async recoverInterrupted() {
    await this.runStore?.recoverInterrupted();
  }
  /** 依次检索知识、调用模型并收尾；取消信号优先于模型成功或异常结果。 */
  private async execute(active: ActiveRun) {
    const { run } = active;
    if (active.controller.signal.aborted)
      return await this.finish(active, "cancelled");
    run.status = "running";
    run.startedAt = new Date().toISOString();
    try {
      await active.secretGuard.refresh();
      // 知识命中既用于模型提示词，也保存用于引用展示；保存前先脱敏。
      const knowledgeContext = await this.knowledge.retrieve({
        projectId: run.projectId,
        input: run.input,
        policy: active.knowledgePolicy,
      });
      await this.runStore?.saveKnowledgeHits(
        run.id,
        active.secretGuard.sanitize(knowledgeContext.hits),
      );
      await this.emit(active, "knowledge.retrieved", {
        mode: knowledgeContext.mode,
        hits: knowledgeContext.hits.map(
          ({ citationKey, title, locator, snippet, score }) => ({
            citationKey,
            title,
            locator,
            snippet,
            score,
          }),
        ),
      });
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
        knowledgeContext.prompt
          ? `${knowledgeContext.prompt}\n\nUser question: ${run.input}`
          : run.input,
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
          error instanceof PiAdapterError ? error.code : "provider_error";
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
    if (active.timeout) clearTimeout(active.timeout);
    active.run.status = status;
    active.run.errorCode = errorCode;
    active.run.finishedAt = new Date().toISOString();
    this.activeConversations.delete(active.run.conversationId);
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
  }
  /** 统一分配事件 ID、脱敏和持久化，保存完成后再通知实时订阅者。 */
  private async emit(
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
    active.events.push(event);
    // 状态迁移交由存储层同时保存运行记录与事件，普通事件只追加日志。
    if (isStateTransition) await this.runStore?.transition(active.run, event);
    else await this.runStore?.appendEvent(event);
    for (const listener of active.listeners) listener(event);
  }
}
