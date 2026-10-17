import { AsyncLocalStorage } from "node:async_hooks";

/** 当前执行的运行上下文，供无请求上下文的 Agent 工具继承归属用户。 */
const storage = new AsyncLocalStorage<{ userId?: string }>();

export function withRunContext<T>(
  context: { userId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

export function currentRunUserId(): string | undefined {
  return storage.getStore()?.userId;
}
