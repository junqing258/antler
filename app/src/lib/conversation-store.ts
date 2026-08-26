import type { ThreadMessageLike } from "@assistant-ui/react";

const DATABASE_NAME = "antler";
const DATABASE_VERSION = 1;
const CONVERSATIONS_STORE = "conversations";

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ThreadMessageLike[];
  isTitleManuallySet?: boolean;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        request.result.createObjectStore(CONVERSATIONS_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地会话数据库"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(CONVERSATIONS_STORE, mode);
      const request = operation(transaction.objectStore(CONVERSATIONS_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("本地会话操作失败"));
      transaction.onerror = () => reject(transaction.error ?? new Error("本地会话操作失败"));
    });
  } finally {
    database.close();
  }
}

function getMessageText(message: ThreadMessageLike) {
  if (message.role !== "user") return "";
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function getTitle(messages: ThreadMessageLike[], currentTitle: string, isTitleManuallySet = false) {
  if (isTitleManuallySet) return currentTitle;
  const firstMessage = messages.map(getMessageText).find(Boolean);
  if (!firstMessage) return currentTitle;
  return firstMessage.slice(0, 48);
}

export async function ensureConversation(id: string): Promise<Conversation> {
  const existing = await getConversation(id);
  if (existing) return existing;
  const now = Date.now();
  const conversation: Conversation = {
    id,
    title: "New Chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await withStore("readwrite", (store) => store.put(conversation));
  return conversation;
}

export function getConversation(id: string): Promise<Conversation | undefined> {
  return withStore("readonly", (store) => store.get(id));
}

export async function saveConversationMessages(
  id: string,
  messages: ThreadMessageLike[],
): Promise<Conversation> {
  const current = await getConversation(id);
  const now = Date.now();
  const conversation: Conversation = {
    id,
    title: getTitle(messages, current?.title ?? "New Chat", current?.isTitleManuallySet),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    messages,
    isTitleManuallySet: current?.isTitleManuallySet,
  };
  await withStore("readwrite", (store) => store.put(conversation));
  return conversation;
}

export async function listConversations(): Promise<Conversation[]> {
  const conversations = await withStore("readonly", (store) => store.getAll());
  return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function renameConversation(id: string, title: string): Promise<Conversation> {
  const current = await getConversation(id);
  if (!current) throw new Error("会话不存在");
  const conversation = { ...current, title, updatedAt: Date.now(), isTitleManuallySet: true };
  await withStore("readwrite", (store) => store.put(conversation));
  return conversation;
}

export function deleteConversation(id: string): Promise<undefined> {
  return withStore("readwrite", (store) => store.delete(id));
}
