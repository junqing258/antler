import type { AntlerHostRuntime, Run } from '../agent/host-runtime.js';

export class TaskService {
  constructor(readonly runtime: AntlerHostRuntime) {}

  create(message: string, conversationId?: string): Run {
    return this.runtime.createRun(message.trim(), conversationId);
  }

  get(taskId: string) {
    return this.runtime.getRun(taskId);
  }
}
