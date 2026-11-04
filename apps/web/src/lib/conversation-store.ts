import {
  messageFromDto,
  type ChatMessage,
  type MessageDto,
} from "@antler/chat-core";
import { subscribeChangeStream } from "@antler/client-runtime";
import { createWebPlatform } from "./platform/web-platform";
import { authHeaders, serverInfo } from "./server-info";

export type Conversation = {
  id: string;
  agentId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
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
export type MessagePage = {
  messages: MessageDto[];
  revision: number;
  activeRunId: string | null;
  hasMore: boolean;
};
let generation = 0;
const subscriptions = new Set<() => void>();
const sessionResetListeners = new Set<() => void>();
type Change = { conversationId: string; type: string; revision: number };
type ChangeListener = {
  onChange: (change: Change) => void;
  onConnection?: (connected: boolean) => void;
};
let changeHub: { listeners: Set<ChangeListener>; stop: () => void } | undefined;
const revisions = new Map<string, number>();
export function resetConversationSession() {
  for (const listener of sessionResetListeners) listener();
  changeHub?.stop();
  changeHub = undefined;
  generation++;
  revisions.clear();
  for (const stop of subscriptions) stop();
  subscriptions.clear();
}
export function subscribeConversationSessionReset(listener: () => void) {
  sessionResetListeners.add(listener);
  return () => sessionResetListeners.delete(listener);
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
export function displayMessages(page: MessagePage): ChatMessage[] {
  return page.messages.map(messageFromDto);
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
    Summary | undefined;
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
  const stop = subscribeChangeStream(
    createWebPlatform(serverInfo),
    afterChangeId,
    async () => (await listConversationPage()).lastChangeId,
    onChange,
    onConnection,
  );
  subscriptions.add(stop);
  return () => {
    stop();
    subscriptions.delete(stop);
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
