import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { Model } from "@earendil-works/pi-ai";
import { createTavilySearchTool } from "./tavily-search-tool.js";
import { createWorkspaceTools } from "./workspace-tools.js";
import type { SkillSnapshot } from "../skills/types.js";
import { createSkillTools } from "../skills/skill-tools.js";
import { composeSkillPrompt } from "../skills/skill-prompt.js";
import { SecretGuard } from "./secret-guard.js";

/** 模型连接、工作区工具和请求超时配置，由宿主创建适配器时注入。 */
export type PiAgentAdapterConfig = {
  provider: "anthropic" | "openai";
  model: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  anthropicAuthToken?: string;
  anthropicBaseUrl?: string;
  tavilyApiKey?: string;
  getToolEnvironment?: () => NodeJS.ProcessEnv;
  workspaceRoot: string;
  systemPrompt: string;
  requestTimeoutMs: number;
};
/** 可由宿主转换为运行错误码的配置错误。 */
export class PiAdapterError extends Error {
  constructor(
    readonly code: "provider_not_configured" | "model_not_found",
    message: string,
  ) {
    super(message);
  }
}
/** 将宿主的一次运行接入 Pi Agent，负责模型配置、工具装配和取消信号桥接。 */
export class PiAgentAdapter {
  readonly secretGuard: SecretGuard;
  // 同一适配器内按会话复用 Agent 的消息历史，并记录其初始化时的技能目录指纹。
  private readonly agents = new Map<
    string,
    { agent: Agent; fingerprint: string }
  >();
  constructor(private readonly config: PiAgentAdapterConfig) {
    // 工具与模型输入共用脱敏规则，覆盖配置中的凭据及工具环境中的秘密。
    this.secretGuard = new SecretGuard(
      config.workspaceRoot,
      config.getToolEnvironment,
      [config.openAiApiKey, config.anthropicAuthToken, config.tavilyApiKey],
    );
  }
  /** 技能工具使用本次快照；搜索工具仅在配置 Tavily 凭据时启用。 */
  private tools(snapshot: SkillSnapshot) {
    return [
      ...createWorkspaceTools(
        this.config.workspaceRoot,
        this.config.getToolEnvironment,
        this.secretGuard,
      ),
      ...(this.config.tavilyApiKey
        ? [
            this.protectSearchTool(
              createTavilySearchTool(this.config.tavilyApiKey),
            ),
          ]
        : []),
      ...createSkillTools(snapshot, this.secretGuard),
    ];
  }
  /** 搜索结果和异常信息都可能包含敏感内容，返回给 Agent 前统一脱敏。 */
  private protectSearchTool(
    tool: ReturnType<typeof createTavilySearchTool>,
  ): ReturnType<typeof createTavilySearchTool> {
    return {
      ...tool,
      execute: async (...args) => {
        try {
          return this.secretGuard.sanitize(await tool.execute(...args));
        } catch (error) {
          throw new Error(
            this.secretGuard.redact(
              error instanceof Error ? error.message : "Search failed.",
            ),
          );
        }
      },
    };
  }
  /** 执行一轮输入，转发 Pi 原始事件，并返回 Agent 当前累积的消息历史。 */
  async run(
    input: string,
    conversationId: string,
    skillSnapshot: SkillSnapshot,
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void | Promise<void>,
  ) {
    // 每轮重新加载秘密，避免工作区或工具环境更新后仍使用旧的脱敏规则。
    await this.secretGuard.refresh();
    if (this.config.provider === "anthropic") {
      return this.runAnthropic(
        input,
        conversationId,
        skillSnapshot,
        signal,
        onEvent,
      );
    }
    if (!this.config.openAiApiKey)
      throw new PiAdapterError(
        "provider_not_configured",
        "未配置 OPENAI_API_KEY，无法调用模型。",
      );
    const provider = openaiProvider();
    // OpenAI 路径要求模型存在于 Pi 目录中，以取得协议所需的模型元数据。
    const catalogModel = provider
      .getModels()
      .find((candidate) => candidate.id === this.config.model);
    if (!catalogModel)
      throw new PiAdapterError(
        "model_not_found",
        `OpenAI model 不受 Pi catalog 支持：${this.config.model}`,
      );
    const model = {
      ...catalogModel,
      ...(this.config.openAiBaseUrl
        ? { baseUrl: this.config.openAiBaseUrl }
        : {}),
    };
    let cached = this.agents.get(conversationId);
    // Agent 的系统提示词和工具在创建时固定，技能目录变化时不能沿用旧上下文。
    if (cached && cached.fingerprint !== skillSnapshot.catalogFingerprint)
      throw new Error("skill_snapshot_changed");
    if (!cached) {
      const agent = new Agent({
        initialState: {
          model: model as Model<any>,
          systemPrompt: this.secretGuard.redact(
            composeSkillPrompt(this.config.systemPrompt, skillSnapshot),
          ),
          thinkingLevel: "low",
          messages: [],
          tools: this.tools(skillSnapshot),
        },
        // 显式注入凭据和单次请求超时；Pi 提供的 signal 用于中止当前模型请求。
        streamFn: (activeModel, context, options) =>
          provider.streamSimple(
            activeModel as Model<"openai-responses">,
            context,
            {
              ...options,
              apiKey: this.config.openAiApiKey,
              signal: options?.signal,
              timeoutMs: this.config.requestTimeoutMs,
            },
          ),
      });
      cached = { agent, fingerprint: skillSnapshot.catalogFingerprint };
      this.agents.set(conversationId, cached);
    }
    const agent = cached.agent;
    // 订阅和取消监听只服务于本轮调用，避免缓存 Agent 累积旧运行的回调。
    const unsubscribe = agent.subscribe(onEvent);
    const abort = () => agent.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await agent.prompt(this.secretGuard.redact(input));
      // Pi 可能把失败保存在状态中而不抛出异常，需将其转交宿主处理。
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      return agent.state.messages as AgentMessage[];
    } finally {
      signal.removeEventListener("abort", abort);
      unsubscribe();
    }
  }

  /** Anthropic 使用独立的模型解析和认证方式，其余会话生命周期与 OpenAI 一致。 */
  private async runAnthropic(
    input: string,
    conversationId: string,
    skillSnapshot: SkillSnapshot,
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void | Promise<void>,
  ) {
    if (!this.config.anthropicAuthToken)
      throw new PiAdapterError(
        "provider_not_configured",
        "未配置 ANTHROPIC_AUTH_TOKEN，无法调用模型。",
      );
    const provider = anthropicProvider();
    const catalogModel = provider
      .getModels()
      .find((candidate) => candidate.id === this.config.model);
    // 兼容网关可能提供 Pi 目录之外的模型：借用已知模型的能力元数据，
    // 但向网关发送用户配置的模型 ID。
    const fallbackModel =
      provider
        .getModels()
        .find((candidate) => candidate.id === "claude-sonnet-4-20250514") ??
      provider.getModels()[0];
    if (!catalogModel && !fallbackModel)
      throw new PiAdapterError(
        "model_not_found",
        "Pi 的 Anthropic model catalog 为空。",
      );
    const model = {
      ...(catalogModel ?? fallbackModel),
      ...(catalogModel
        ? {}
        : { id: this.config.model, name: this.config.model }),
      ...(this.config.anthropicBaseUrl
        ? { baseUrl: this.config.anthropicBaseUrl }
        : {}),
    };
    let cached = this.agents.get(conversationId);
    // 防止复用包含旧技能提示词和工具的 Agent。
    if (cached && cached.fingerprint !== skillSnapshot.catalogFingerprint)
      throw new Error("skill_snapshot_changed");
    if (!cached) {
      const agent = new Agent({
        initialState: {
          model: model as Model<any>,
          systemPrompt: this.secretGuard.redact(
            composeSkillPrompt(this.config.systemPrompt, skillSnapshot),
          ),
          thinkingLevel: "low",
          messages: [],
          tools: this.tools(skillSnapshot),
        },
        streamFn: (activeModel, context, options) =>
          provider.streamSimple(
            activeModel as Model<"anthropic-messages">,
            context,
            {
              ...options,
              // 兼容网关使用 Bearer token，同时保留 Pi 传入的其他请求头。
              headers: {
                ...options?.headers,
                Authorization: `Bearer ${this.config.anthropicAuthToken}`,
              },
              signal: options?.signal,
              timeoutMs: this.config.requestTimeoutMs,
            },
          ),
      });
      cached = { agent, fingerprint: skillSnapshot.catalogFingerprint };
      this.agents.set(conversationId, cached);
    }
    const agent = cached.agent;
    // 缓存只保留 Agent 状态，事件订阅和取消监听在本轮结束后释放。
    const unsubscribe = agent.subscribe(onEvent);
    const abort = () => agent.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await agent.prompt(this.secretGuard.redact(input));
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      return agent.state.messages as AgentMessage[];
    } finally {
      signal.removeEventListener("abort", abort);
      unsubscribe();
    }
  }
}
