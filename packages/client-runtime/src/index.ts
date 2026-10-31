import {
  applyRunEvent,
  isTerminalEvent,
  mergeMessageSnapshots,
  type ChatMessage,
  type RunEvent,
} from "@antler/chat-core";

export type SessionConversation = {
  messages: ChatMessage[];
  revision?: number;
  activeRunId?: string | null;
  executionConfig?: Record<string, unknown>;
  contextState?: string;
  contextReason?: string;
  hasMoreMessages?: boolean;
  firstSeq?: number;
};
export type SessionState = {
  messages: ChatMessage[];
  revision: number;
  activeRunId: string | null;
  running: boolean;
  sending: boolean;
  ready: boolean;
  credentialError: boolean;
  hasMore: boolean;
  firstSeq?: number;
  executionConfig?: Record<string, unknown>;
  contextReason: string;
  notice: string;
};
export type SessionProvider = { apiKey: string; [key: string]: unknown };
export type BoundCredential = {
  protocol: string;
  baseUrl: string;
  model: string;
};

export function getBoundCredential(
  config?: Record<string, unknown>,
): BoundCredential | undefined {
  if (config?.credentialSource !== "client") return undefined;
  if (
    typeof config.protocol !== "string" ||
    typeof config.model !== "string" ||
    (config.baseUrl !== undefined && typeof config.baseUrl !== "string")
  )
    return undefined;
  return {
    protocol: config.protocol,
    baseUrl: config.baseUrl ?? "",
    model: config.model,
  };
}

export function credentialProblem(
  config: Record<string, unknown> | undefined,
  provider: SessionProvider,
): string {
  if (config?.credentialSource !== "client") return "";
  const bound = getBoundCredential(config);
  if (!bound) return "无法确认此会话绑定的模型配置，请重新加载会话。";
  if (!provider.apiKey.trim())
    return "此会话需要当前设备提供绑定供应商的 API Key，登录账号不会同步模型凭据。";
  const endpoint = (value: unknown) =>
    typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (
    provider.protocol !== bound.protocol ||
    endpoint(provider.baseUrl) !== endpoint(bound.baseUrl)
  )
    return "当前设备的供应商协议或服务地址与此会话绑定的配置不匹配，请配置匹配的凭据。";
  return "";
}
export type SessionDependencies = {
  initialize(): Promise<void>;
  listChangesCursor(): Promise<number>;
  getConversation(id: string): Promise<SessionConversation | undefined>;
  getEarlier(
    id: string,
    beforeSeq?: number,
  ): Promise<{ messages: ChatMessage[]; firstSeq?: number; hasMore: boolean }>;
  subscribeChanges(
    cursor: number,
    onChange: (change: { conversationId: string; type: string }) => void,
    onConnection: (connected: boolean) => void,
  ): () => void;
  subscribeRun(
    runId: string,
    onEvent: (event: RunEvent) => void,
    onConnection: (connected: boolean) => void,
  ): () => void;
  prepareSend(): Promise<
    (
      body: string,
    ) => Promise<{ ok: boolean; data: { runId?: unknown; error?: string } }>
  >;
  prepareCancel(): Promise<(runId: string) => Promise<void>>;
  getProvider(): SessionProvider;
  createId(): string;
  delay(ms: number): Promise<void>;
  onSaved(): void;
};
export type SessionOptions = {
  conversationId: string;
  workingDirectory: string;
  initialMessages: ChatMessage[];
  agentId?: string;
};

/** A single conversation's business state. Hosts own lifecycle, transport and foreground signals. */
export class ChatSession {
  private state: SessionState;
  private listeners = new Set<() => void>();
  private generation = 0;
  private started = false;
  private initialized = false;
  private stopChanges?: () => void;
  private stopRun?: () => void;
  private watchedRunId: string | null = null;
  private completedRuns = new Set<string>();

  constructor(
    private readonly options: SessionOptions,
    private readonly deps: SessionDependencies,
  ) {
    this.state = {
      messages: options.initialMessages,
      revision: 0,
      activeRunId: null,
      running: false,
      sending: false,
      ready: false,
      credentialError: false,
      hasMore: false,
      contextReason: "",
      notice: "",
    };
  }
  getSnapshot = () => this.state;
  credentialProblem = () =>
    credentialProblem(this.state.executionConfig, this.deps.getProvider()) ||
    (this.state.credentialError
      ? "此会话需要当前设备提供匹配的模型凭据，请检查供应商配置。"
      : "");
  providerChanged() {
    if (this.state.credentialError)
      this.update({ credentialError: false, notice: "" });
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private alive(generation: number) {
    return this.started && this.generation === generation;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.initialized = false;
    const generation = ++this.generation;
    if (this.state.ready) this.update({ ready: false });
    void (async () => {
      for (let attempt = 0; this.alive(generation); attempt++) {
        try {
          await this.deps.initialize();
          if (!this.alive(generation)) return;
          this.initialized = true;
          if (this.state.activeRunId)
            this.watchRun(this.state.activeRunId, generation);
          const cursor = await this.deps.listChangesCursor();
          if (!this.alive(generation)) return;
          await this.refresh();
          if (!this.alive(generation)) return;
          this.stopChanges = this.deps.subscribeChanges(
            cursor,
            (change) => {
              if (
                this.alive(generation) &&
                (change.conversationId === this.options.conversationId ||
                  change.type === "reset_required")
              )
                void this.refresh().catch(() => {});
            },
            (connected) => {
              if (!this.alive(generation)) return;
              this.update({ notice: connected ? "" : "连接中断，正在重连" });
              if (connected) void this.refresh().catch(() => {});
            },
          );
          return;
        } catch {
          if (!this.alive(generation)) return;
          this.initialized = false;
          this.update({ ready: false, notice: "无法加载会话，正在重试…" });
          await this.deps.delay(Math.min(500 * 2 ** attempt, 15000));
        }
      }
    })();
  }
  stop() {
    if (!this.started) return;
    this.started = false;
    this.initialized = false;
    this.generation++;
    this.stopChanges?.();
    this.stopChanges = undefined;
    this.stopRun?.();
    this.stopRun = undefined;
    this.watchedRunId = null;
    if (this.state.sending) this.update({ sending: false });
  }
  async refresh() {
    if (!this.started || !this.initialized) return;
    const generation = this.generation;
    const conversation = await this.deps.getConversation(
      this.options.conversationId,
    );
    if (!this.alive(generation)) return;
    if (!conversation) {
      this.update({ ready: true });
      return;
    }
    if ((conversation.revision ?? 0) < this.state.revision) return;
    const last = conversation.messages.at(-1);
    const replayRun = last?.status?.type === "running" ? last.runId : undefined;
    const candidate =
      conversation.activeRunId ??
      (typeof replayRun === "string" ? replayRun : null);
    const activeRunId =
      candidate && !this.completedRuns.has(candidate) ? candidate : null;
    const firstSeq =
      this.state.firstSeq === undefined
        ? conversation.firstSeq
        : Math.min(
            this.state.firstSeq,
            conversation.firstSeq ?? this.state.firstSeq,
          );
    this.update({
      revision: conversation.revision ?? 0,
      ready: true,
      activeRunId,
      running: Boolean(activeRunId),
      executionConfig: conversation.executionConfig,
      contextReason:
        conversation.contextState && conversation.contextState !== "available"
          ? (conversation.contextReason ?? "模型上下文未恢复，请新建会话。")
          : "",
      hasMore: conversation.hasMoreMessages ?? false,
      firstSeq,
      messages: mergeMessageSnapshots(
        this.state.messages,
        conversation.messages,
      ),
    });
    if (activeRunId) this.watchRun(activeRunId, generation);
  }
  private watchRun(runId: string, generation: number) {
    if (this.watchedRunId === runId) return;
    this.stopRun?.();
    this.stopRun = undefined;
    this.watchedRunId = runId;
    const stop = this.deps.subscribeRun(
      runId,
      (event) => {
        if (!this.alive(generation) || this.watchedRunId !== runId) return;
        const messages = applyRunEvent(this.state.messages, runId, event);
        if (!isTerminalEvent(event)) {
          this.update({ messages });
          return;
        }
        this.completedRuns.add(runId);
        this.watchedRunId = null;
        this.stopRun?.();
        this.stopRun = undefined;
        this.update({
          messages,
          activeRunId:
            this.state.activeRunId === runId ? null : this.state.activeRunId,
          running: false,
          notice: "",
        });
        void this.refresh().catch(() => {});
        this.deps.onSaved();
      },
      (connected) => {
        if (this.alive(generation) && this.watchedRunId === runId)
          this.update({ notice: connected ? "" : "连接中断，正在重连" });
      },
    );
    if (this.alive(generation) && this.watchedRunId === runId)
      this.stopRun = stop;
    else stop();
  }
  async send(text: string) {
    if (!this.started) return;
    if (!this.state.ready) {
      this.update({ notice: "正在加载会话配置，请稍候。" });
      return;
    }
    if (this.state.sending || this.state.activeRunId) {
      this.update({ notice: "该会话正在回复中" });
      return;
    }
    if (this.state.contextReason) {
      this.update({ notice: this.state.contextReason });
      return;
    }
    const problem = this.credentialProblem();
    if (problem) return;
    const generation = this.generation;
    this.update({ sending: true, notice: "发送中…" });
    try {
      const post = await this.deps.prepareSend();
      if (!this.alive(generation)) return;
      const provider = this.deps.getProvider();
      const bound = this.state.executionConfig;
      const problemAfterInit = credentialProblem(bound, provider);
      if (problemAfterInit) return;
      const expectedRevision = this.state.revision;
      const body = JSON.stringify({
        message: text,
        conversationId: this.options.conversationId,
        clientRequestId: this.deps.createId(),
        expectedRevision,
        ...(this.options.agentId ? { agentId: this.options.agentId } : {}),
        ...(bound
          ? {}
          : this.options.workingDirectory.trim()
            ? { workingDirectory: this.options.workingDirectory }
            : {}),
        ...(bound?.credentialSource === "server"
          ? {}
          : provider.apiKey.trim()
            ? {
                provider: bound
                  ? {
                      ...provider,
                      protocol: bound.protocol,
                      baseUrl: bound.baseUrl,
                      model: bound.model,
                    }
                  : provider,
              }
            : {}),
      });
      let response: Awaited<ReturnType<typeof post>> | undefined;
      for (let attempt = 0; this.alive(generation); attempt++) {
        try {
          response = await post(body);
          break;
        } catch {
          if (!this.alive(generation)) return;
          this.update({ notice: "发送待确认，正在重试…" });
          await this.deps.delay(Math.min(500 * 2 ** attempt, 15000));
        }
      }
      if (!this.alive(generation)) return;
      if (response?.data.error === "credential_required") {
        this.update({ credentialError: true, notice: "" });
        await this.refresh().catch(() => {});
        return;
      }
      if (!response?.ok)
        throw new Error(
          response?.data.error === "conversation_busy"
            ? "该会话正在回复中"
            : (response?.data.error ?? "发送失败"),
        );
      const runId = response.data.runId;
      if (typeof runId === "string") {
        const id = `${runId}:user`;
        const messages = this.state.messages.some((item) => item.id === id)
          ? this.state.messages
          : [
              ...this.state.messages,
              {
                id,
                role: "user" as const,
                content: [{ type: "text" as const, text }],
                createdAt: new Date(),
                runId,
                appliedEventId: 0,
                live: true,
              },
            ];
        this.update({
          notice: "",
          revision: Math.max(this.state.revision, expectedRevision + 1),
          activeRunId: runId,
          running: true,
          messages,
        });
        this.watchRun(runId, generation);
      } else this.update({ notice: "" });
      await this.refresh();
      if (this.alive(generation)) this.deps.onSaved();
    } catch (error) {
      if (this.alive(generation))
        this.update({
          notice:
            error instanceof Error
              ? error.message
              : "发送待确认，请重新连接服务端。",
        });
    } finally {
      if (this.alive(generation)) this.update({ sending: false });
    }
  }
  async cancel() {
    const generation = this.generation;
    const runId = this.state.activeRunId;
    if (!this.started || !runId) return;
    const cancel = await this.deps.prepareCancel();
    if (this.alive(generation) && this.state.activeRunId === runId)
      await cancel(runId);
  }
  async loadEarlier() {
    if (!this.started) return;
    const generation = this.generation;
    const page = await this.deps.getEarlier(
      this.options.conversationId,
      this.state.firstSeq,
    );
    if (!this.alive(generation)) return;
    const existing = new Set(this.state.messages.map((item) => item.id));
    this.update({
      messages: [
        ...page.messages.filter((item) => !existing.has(item.id)),
        ...this.state.messages,
      ],
      firstSeq: page.firstSeq,
      hasMore: page.hasMore,
    });
  }
}

export { subscribeRunStream } from "./run-stream";
export { subscribeChangeStream } from "./change-stream";
export type { ConversationChange } from "./change-stream";
export { createHttpSessionDependencies } from "./http-session";
