import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import {
  isTerminalRunStatus,
  type RunEvent,
  type RunEventType,
  type RunStatus,
} from "./events.js";
import { PiAgentAdapter, PiAdapterError } from "./pi-agent-adapter.js";

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
};
export class ConversationBusyError extends Error {}
export type HostRuntimeConfig = { maxRunDurationMs: number; maxEvents: number };
export class AntlerHostRuntime {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly activeConversations = new Map<string, string>();
  constructor(
    private readonly adapter: PiAgentAdapter,
    private readonly config: HostRuntimeConfig,
  ) {}
  createRun(input: string, conversationId: string = randomUUID()): Run {
    if (this.activeConversations.has(conversationId))
      throw new ConversationBusyError("conversation_busy");
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
    };
    this.runs.set(run.id, active);
    this.activeConversations.set(conversationId, run.id);
    queueMicrotask(() => void this.execute(active));
    return run;
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
      await this.adapter.run(
        run.input,
        run.conversationId,
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
      });
    else if (event.type === "tool_execution_end")
      this.emit(active, "tool.completed", {
        runId,
        stepId: event.toolCallId,
        tool: event.toolName,
        summary: event.isError ? "工具执行失败。" : "工具执行完成。",
      });
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
