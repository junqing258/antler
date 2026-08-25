import { randomUUID } from 'node:crypto';
import type { Task } from '../types/task.js';

export class TaskService {
  private readonly tasks = new Map<string, Task>();

  create(message: string): Task {
    const task: Task = { id: randomUUID(), message: message.trim(), status: 'queued' };
    this.tasks.set(task.id, task);
    return task;
  }

  get(taskId: string) {
    return this.tasks.get(taskId);
  }
}
