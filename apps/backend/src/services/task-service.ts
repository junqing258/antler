import type {
  AntlerHostRuntime,
  Run,
  RunAgentConstraints,
} from "../agent/host-runtime.js";

export class TaskService {
  constructor(readonly runtime: AntlerHostRuntime) {}

  create(
    message: string,
    conversationId?: string,
    userId?: string,
    agentId?: string,
    agentConstraints?: RunAgentConstraints,
  ): Promise<Run> {
    return this.runtime.createRun(message.trim(), {
      userId: userId || undefined,
      agentId,
      agentConstraints,
      conversationId,
    });
  }

  get(taskId: string, userId?: string) {
    return this.runtime.getRun(taskId, userId || undefined);
  }
}
