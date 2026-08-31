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

export type PiAgentAdapterConfig = {
  provider: "anthropic" | "openai";
  model: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  anthropicAuthToken?: string;
  anthropicBaseUrl?: string;
  tavilyApiKey?: string;
  workspaceRoot: string;
  systemPrompt: string;
  requestTimeoutMs: number;
};
export class PiAdapterError extends Error {
  constructor(
    readonly code: "provider_not_configured" | "model_not_found",
    message: string,
  ) {
    super(message);
  }
}
export class PiAgentAdapter {
  private readonly agents = new Map<string, { agent: Agent; fingerprint: string }>();
  constructor(private readonly config: PiAgentAdapterConfig) {}
  private tools(snapshot: SkillSnapshot) {
    return [
      ...createWorkspaceTools(this.config.workspaceRoot),
      ...(this.config.tavilyApiKey
        ? [createTavilySearchTool(this.config.tavilyApiKey)]
        : []),
      ...createSkillTools(snapshot),
    ];
  }
  async run(
    input: string,
    conversationId: string,
    skillSnapshot: SkillSnapshot,
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void | Promise<void>,
  ) {
    if (this.config.provider === "anthropic") {
      return this.runAnthropic(input, conversationId, skillSnapshot, signal, onEvent);
    }
    if (!this.config.openAiApiKey)
      throw new PiAdapterError(
        "provider_not_configured",
        "未配置 OPENAI_API_KEY，无法调用模型。",
      );
    const provider = openaiProvider();
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
    if (cached && cached.fingerprint !== skillSnapshot.catalogFingerprint) throw new Error("skill_snapshot_changed");
    if (!cached) {
      const agent = new Agent({
        initialState: {
          model: model as Model<any>,
          systemPrompt: composeSkillPrompt(this.config.systemPrompt, skillSnapshot),
          thinkingLevel: "low",
          messages: [],
          tools: this.tools(skillSnapshot),
        },
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
      cached = { agent, fingerprint: skillSnapshot.catalogFingerprint }; this.agents.set(conversationId, cached);
    }
    const agent = cached.agent;
    const unsubscribe = agent.subscribe(onEvent);
    const abort = () => agent.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await agent.prompt(input);
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      return agent.state.messages as AgentMessage[];
    } finally {
      signal.removeEventListener("abort", abort);
      unsubscribe();
    }
  }

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
    // Anthropic-compatible gateways may expose models outside Pi's first-party
    // catalog. Keep the catalog's capability metadata while sending the
    // configured model id to the gateway.
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
    if (cached && cached.fingerprint !== skillSnapshot.catalogFingerprint) throw new Error("skill_snapshot_changed");
    if (!cached) {
      const agent = new Agent({
        initialState: {
          model: model as Model<any>,
          systemPrompt: composeSkillPrompt(this.config.systemPrompt, skillSnapshot),
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
              headers: {
                ...options?.headers,
                Authorization: `Bearer ${this.config.anthropicAuthToken}`,
              },
              signal: options?.signal,
              timeoutMs: this.config.requestTimeoutMs,
            },
          ),
      });
      cached = { agent, fingerprint: skillSnapshot.catalogFingerprint }; this.agents.set(conversationId, cached);
    }
    const agent = cached.agent;
    const unsubscribe = agent.subscribe(onEvent);
    const abort = () => agent.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await agent.prompt(input);
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      return agent.state.messages as AgentMessage[];
    } finally {
      signal.removeEventListener("abort", abort);
      unsubscribe();
    }
  }
}
