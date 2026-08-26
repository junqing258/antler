export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";
export type RunEventType =
  | "run.started"
  | "assistant.delta"
  | "step.started"
  | "step.completed"
  | "tool.approval_required"
  | "tool.completed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";
export type RunEvent = {
  id: number;
  runId: string;
  type: RunEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};
export const terminalRunStatuses = new Set<RunStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);
export function isTerminalRunStatus(status: RunStatus) {
  return terminalRunStatuses.has(status);
}
