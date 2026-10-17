import type { AntlerHostRuntime, Run } from "../agent/host-runtime.js";

export class TaskService {
  constructor(readonly runtime: AntlerHostRuntime) {}

  create(
    message: string,
    conversationId?: string,
    userId?: string,
  ): Promise<Run> {
    return this.runtime.createRun(message.trim(), {
      userId: userId || undefined,
      projectId: "default",
      conversationId,
    });
  }

  get(taskId: string, userId?: string) {
    return this.runtime.getRun(taskId, userId || undefined);
  }
}
