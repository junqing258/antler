import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import type { Model } from '@earendil-works/pi-ai';

export type PiAgentAdapterConfig = { model: string; apiKey?: string; systemPrompt: string; requestTimeoutMs: number };
export class PiAdapterError extends Error { constructor(readonly code: 'provider_not_configured' | 'model_not_found', message: string) { super(message); } }
export class PiAgentAdapter {
  constructor(private readonly config: PiAgentAdapterConfig) {}
  async run(input: string, signal: AbortSignal, onEvent: (event: AgentEvent) => void | Promise<void>) {
    if (!this.config.apiKey) throw new PiAdapterError('provider_not_configured', '未配置 OPENAI_API_KEY，无法调用模型。');
    const provider = openaiProvider();
    const model = provider.getModels().find((candidate) => candidate.id === this.config.model);
    if (!model) throw new PiAdapterError('model_not_found', `OpenAI model 不受 Pi catalog 支持：${this.config.model}`);
    const agent = new Agent({ initialState: { model: model as Model<any>, systemPrompt: this.config.systemPrompt, thinkingLevel: 'low', messages: [], tools: [] }, streamFn: (activeModel, context, options) => provider.streamSimple(activeModel as Model<'openai-responses'>, context, { ...options, apiKey: this.config.apiKey, signal: options?.signal, timeoutMs: this.config.requestTimeoutMs }) });
    const unsubscribe = agent.subscribe(onEvent);
    const abort = () => agent.abort();
    signal.addEventListener('abort', abort, { once: true });
    try { await agent.prompt(input); if (agent.state.errorMessage) throw new Error(agent.state.errorMessage); return agent.state.messages as AgentMessage[]; }
    finally { signal.removeEventListener('abort', abort); unsubscribe(); }
  }
}
