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

export type ProviderRunConfig = {
  protocol: "openai-responses" | "anthropic-messages";
  baseUrl?: string;
  apiKey: string;
  model: string;
};

export type Run = {
  id: string;
  conversationId: string;
  input: string;
  status: RunStatus;
  errorCode?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};
type ActiveRun = {
  run: Run;
  controller: AbortController;
  events: RunEvent[];
  listeners: Set<(event: RunEvent) => void>;
  timeout?: NodeJS.Timeout;
  adapter: PiAgentAdapter;
  skillSnapshot: SkillSnapshot;
};
export class ConversationBusyError extends Error {}
export class ConversationSkillContextMismatchError extends Error {
  constructor() {
    super("conversation_skill_context_mismatch");
  }
}
export type CreateRunOptions = {
  conversationId?: string;
  provider?: ProviderRunConfig;
  workingDirectory?: string;
  skillPolicy?: SkillPolicy;
  skillSnapshot?: SkillSnapshot;
};
export type HostRuntimeConfig = { maxRunDurationMs: number; maxEvents: number };
export class AntlerHostRuntime {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly activeConversations = new Map<string, string>();
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
  ) {}
  createRun(input: string, options: CreateRunOptions = {}): Run {
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
    // Registry discovery is async, so routes construct snapshots before enqueueing through createRunWithSnapshot.
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
      conversationId,
      input,
      status: "queued",
      createdAt: now,
    };
    const active: ActiveRun = {
      run,
      controller: new AbortController(),
      events: [],
      listeners: new Set(),
      adapter: this.createAdapter(options.provider, options.workingDirectory),
      skillSnapshot: snapshot,
    };
    this.runs.set(run.id, active);
    this.activeConversations.set(conversationId, run.id);
    queueMicrotask(() => void this.execute(active));
    return run;
  }
  async createRunWithSkills(
    input: string,
    options: CreateRunOptions,
  ): Promise<{ run: Run; skillDiagnostics: SkillSnapshot["diagnostics"] }> {
    const policy = options.skillPolicy ?? { mode: "disabled" as const };
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
    const run = this.createRun(input, {
      ...options,
      conversationId: id,
      skillPolicy: policy,
      skillSnapshot: snapshot,
    });
    return { run, skillDiagnostics: snapshot.diagnostics };
  }
  getRun(runId: string) {
    return this.runs.get(runId)?.run;
  }
  getEvents(runId: string, afterEventId = 0) {
    return (
      this.runs.get(runId)?.events.filter((event) => event.id > afterEventId) ??
      []
    );
  }
  subscribe(runId: string, listener: (event: RunEvent) => void) {
    const active = this.runs.get(runId);
    if (!active) return undefined;
    active.listeners.add(listener);
    return () => active.listeners.delete(listener);
  }
  cancel(runId: string) {
    const active = this.runs.get(runId);
    if (!active) return undefined;
    if (!isTerminalRunStatus(active.run.status)) active.controller.abort();
    return active.run;
  }
  private async execute(active: ActiveRun) {
    const { run } = active;
    if (active.controller.signal.aborted)
      return this.finish(active, "cancelled");
    run.status = "running";
    run.startedAt = new Date().toISOString();
    this.emit(active, "run.started", { runId: run.id, status: run.status });
    active.timeout = setTimeout(
      () => active.controller.abort(),
      this.config.maxRunDurationMs,
    );
    try {
      await active.adapter.run(
        run.input,
        run.conversationId,
        active.skillSnapshot,
        active.controller.signal,
        (event) => this.mapPiEvent(active, event),
      );
      this.finish(
        active,
        active.controller.signal.aborted ? "cancelled" : "succeeded",
      );
    } catch (error) {
      if (active.controller.signal.aborted) this.finish(active, "cancelled");
      else {
        const code =
          error instanceof PiAdapterError ? error.code : "provider_error";
        this.finish(
          active,
          "failed",
          code,
          error instanceof Error ? error.message : "模型调用失败。",
        );
      }
    }
  }
  private mapPiEvent(active: ActiveRun, event: AgentEvent) {
    const runId = active.run.id;
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    )
      this.emit(active, "assistant.delta", {
        runId,
        delta: event.assistantMessageEvent.delta,
      });
    else if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "thinking_delta"
    )
      this.emit(active, "assistant.thinking.delta", {
        runId,
        delta: event.assistantMessageEvent.delta,
      });
    else if (event.type === "turn_start")
      this.emit(active, "step.started", {
        runId,
        stepId: `turn-${active.events.length + 1}`,
        kind: "model",
      });
    else if (event.type === "turn_end")
      this.emit(active, "step.completed", {
        runId,
        stepId: `turn-${active.events.length}`,
        kind: "model",
      });
    else if (event.type === "tool_execution_start")
      this.emit(active, "step.started", {
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
      this.emit(active, "tool.completed", {
        runId,
        stepId: event.toolCallId,
        tool: event.toolName,
        summary: event.isError ? "工具执行失败。" : "工具执行完成。",
        // Skill instruction/resource bodies remain model-visible tool results but
        // must never be copied into the client SSE transcript.
        result: isSkillTool
          ? (details ?? { tool: event.toolName })
          : event.result,
        isError: event.isError,
      });
    }
  }
  private finish(
    active: ActiveRun,
    status: Extract<RunStatus, "succeeded" | "failed" | "cancelled">,
    errorCode?: string,
    error?: string,
  ) {
    if (isTerminalRunStatus(active.run.status)) return;
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
    this.emit(active, type, {
      runId: active.run.id,
      status,
      ...(error ? { error: { code: errorCode, message: error } } : {}),
    });
  }
  private emit(
    active: ActiveRun,
    type: RunEventType,
    payload: Record<string, unknown>,
  ) {
    if (
      active.events.length >= this.config.maxEvents &&
      !isTerminalRunStatus(active.run.status)
    )
      active.controller.abort();
    const event: RunEvent = {
      id: active.events.length + 1,
      runId: active.run.id,
      type,
      payload,
      createdAt: new Date().toISOString(),
    };
    active.events.push(event);
    for (const listener of active.listeners) listener(event);
  }
}
