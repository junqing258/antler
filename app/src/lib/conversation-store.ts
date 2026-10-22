import type { ThreadMessageLike } from "@assistant-ui/react";
import { authHeaders, serverInfo } from "./server-info";

export type Conversation = {
  id: string;
  agentId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ThreadMessageLike[];
  revision?: number;
  activeRunId?: string | null;
  executionConfig?: Record<string, unknown>;
  contextState?: string;
  contextReason?: string;
  hasMoreMessages?: boolean;
  firstSeq?: number;
  isTitleManuallySet?: boolean;
  isTitleGenerated?: boolean;
};
type Summary = Omit<Conversation, "createdAt" | "updatedAt" | "messages"> & {
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  titleSource: string;
};
type MessageDto = {
  id: string;
  role: "user" | "assistant";
  seq: number;
  runId: string;
  appliedEventId: number;
  content: { schemaVersion: number; parts: unknown[] };
  status: string;
  createdAt: string;
};
export type MessagePage = {
  messages: MessageDto[];
  revision: number;
  activeRunId: string | null;
  hasMore: boolean;
};
let generation = 0;
const subscriptions = new Set<AbortController>();
type Change = { conversationId: string; type: string; revision: number };
type ChangeListener = {
  onChange: (change: Change) => void;
  onConnection?: (connected: boolean) => void;
};
let changeHub: { listeners: Set<ChangeListener>; stop: () => void } | undefined;
const revisions = new Map<string, number>();
export function resetConversationSession() {
  changeHub?.stop();
  changeHub = undefined;
  generation++;
  revisions.clear();
  for (const controller of subscriptions) controller.abort();
  subscriptions.clear();
}
export async function conversationRequest(path: string, init?: RequestInit) {
  const epoch = generation;
  const server = await serverInfo();
  const response = await fetch(`${server.baseUrl}/api/conversations${path}`, {
    ...init,
    headers: {
      ...authHeaders(server),
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (epoch !== generation) throw new Error("账号已切换");
  if (!response.ok) {
    if (response.status === 404) return undefined;
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "无法加载服务端会话");
  }
  const data = await response.json();
  if (epoch !== generation) throw new Error("账号已切换");
  return data;
}
function summary(row: Summary): Conversation {
  revisions.set(
    row.id,
    Math.max(revisions.get(row.id) ?? 0, row.revision ?? 0),
  );
  return {
    ...row,
    createdAt: Date.parse(row.createdAt),
    updatedAt: Date.parse(row.lastMessageAt),
    messages: [],
    isTitleGenerated: row.titleSource === "generated",
    isTitleManuallySet: row.titleSource === "manual",
  };
}
export function displayMessages(page: MessagePage): ThreadMessageLike[] {
  return page.messages.map((message) => {
    if (message.content.schemaVersion !== 1)
      throw new Error("消息格式版本不受支持");
    return {
      id: message.id,
      role: message.role,
      content: message.content.parts,
      createdAt: new Date(message.createdAt),
      ...(message.role === "assistant"
        ? {
            status:
              message.status === "running" || message.status === "queued"
                ? { type: "running" }
                : message.status === "failed"
                  ? {
                      type: "incomplete",
                      reason: "error",
                      error: "运行已中断或失败",
                    }
                  : message.status === "cancelled"
                    ? { type: "incomplete", reason: "cancelled" }
                    : { type: "complete", reason: "stop" },
          }
        : {}),
    } as ThreadMessageLike;
  });
}
export async function listConversationPage(cursor?: string, agentId?: string) {
  const query = new URLSearchParams({
    limit: "50",
    ...(cursor ? { cursor } : {}),
    ...(agentId ? { agentId } : {}),
  });
  const data = (await conversationRequest(`?${query}`)) as {
    conversations: Summary[];
    nextCursor: string | null;
    lastChangeId: number;
  };
  return { ...data, conversations: data.conversations.map(summary) };
}
export async function listConversations(): Promise<Conversation[]> {
  return (await listConversationPage()).conversations;
}
export async function getMessagePage(
  id: string,
  beforeSeq?: number,
): Promise<MessagePage> {
  const page = await conversationRequest(
    `/${encodeURIComponent(id)}/messages?limit=50${beforeSeq ? `&beforeSeq=${beforeSeq}` : ""}`,
  );
  if (!page) throw new Error("会话已删除");
  return page;
}
export async function getConversation(
  id: string,
): Promise<Conversation | undefined> {
  const data = (await conversationRequest(`/${encodeURIComponent(id)}`)) as
    | Summary
    | undefined;
  if (!data) return undefined;
  const page = await getMessagePage(id);
  return {
    ...summary(data),
    messages: displayMessages(page),
    revision: page.revision,
    activeRunId: page.activeRunId,
    hasMoreMessages: page.hasMore,
    firstSeq: page.messages[0]?.seq,
  };
}
export async function renameConversation(
  id: string,
  title: string,
): Promise<Conversation> {
  const data = await conversationRequest(`/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ title, expectedRevision: revisions.get(id) }),
  });
  if (!data) throw new Error("会话不存在");
  return summary(data);
}
export async function deleteConversation(id: string): Promise<undefined> {
  await conversationRequest(`/${encodeURIComponent(id)}`, { method: "DELETE" });
  return undefined;
}

/** Reconnect from the last consumed committed cursor; snapshots remain authoritative. */
function openChangeStream(
  afterChangeId: number,
  onChange: (change: Change) => void,
  onConnection?: (connected: boolean) => void,
) {
  const controller = new AbortController();
  subscriptions.add(controller);
  const epoch = generation;
  let cursor = afterChangeId;
  let timer: ReturnType<typeof setTimeout>;
  let attempt = 0;
  const connect = async () => {
    try {
      const server = await serverInfo();
      const response = await fetch(
        `${server.baseUrl}/api/conversations/changes?afterChangeId=${cursor}`,
        { headers: authHeaders(server), signal: controller.signal },
      );
      if (response.status === 409) {
        const snapshot = await listConversationPage();
        if (epoch !== generation || controller.signal.aborted) return;
        cursor = snapshot.lastChangeId;
        onChange({ conversationId: "", type: "reset_required", revision: 0 });
        timer = setTimeout(() => void connect(), 0);
        return;
      }
      if (!response.ok || !response.body) throw new Error("连接中断");
      onConnection?.(true);
      attempt = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted && epoch === generation) {
        const { done, value } = await reader.read();
        if (done) throw new Error("连接中断");
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (!data || epoch !== generation) continue;
          const change = JSON.parse(data);
          if (change.changeId <= cursor) continue;
          onChange(change);
          cursor = change.changeId;
        }
      }
      await reader.cancel();
    } catch {
      if (!controller.signal.aborted && epoch === generation) {
        onConnection?.(false);
        timer = setTimeout(
          () => void connect(),
          Math.min(1000 * 2 ** attempt++, 15000),
        );
      }
    }
  };
  void connect();
  return () => {
    controller.abort();
    subscriptions.delete(controller);
    clearTimeout(timer);
  };
}

/** One long-lived HTTP connection per page, shared by navigation and the active thread. */
export function subscribeConversationChanges(
  afterChangeId: number,
  onChange: (change: Change) => void,
  onConnection?: (connected: boolean) => void,
) {
  const listener = { onChange, onConnection };
  if (!changeHub) {
    const listeners = new Set<ChangeListener>([listener]);
    const stop = openChangeStream(
      afterChangeId,
      (change) => {
        for (const item of listeners) item.onChange(change);
      },
      (connected) => {
        for (const item of listeners) item.onConnection?.(connected);
      },
    );
    changeHub = { listeners, stop };
  } else {
    changeHub.listeners.add(listener);
    // A fresh authoritative read covers any events consumed before this subscriber joined.
    queueMicrotask(() => {
      if (changeHub?.listeners.has(listener))
        onChange({ conversationId: "", type: "reset_required", revision: 0 });
    });
  }
  const hub = changeHub;
  return () => {
    hub.listeners.delete(listener);
    if (!hub.listeners.size) {
      hub.stop();
      if (changeHub === hub) changeHub = undefined;
    }
  };
}
