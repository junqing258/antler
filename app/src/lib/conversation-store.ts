import type { ThreadMessageLike } from "@assistant-ui/react";

const DATABASE_NAME = "antler";
const DATABASE_VERSION = 3;
const CONVERSATIONS_STORE = "conversations";

// A runtime can finish its debounced save while the user is deleting that
// conversation. Keep a short-lived tombstone so that stale saves cannot put
// the just-deleted record back into IndexedDB.
const deletedConversationIds = new Set<string>();

export type Conversation = {
  agentId?: string;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ThreadMessageLike[];
  isTitleManuallySet?: boolean;
  isTitleGenerated?: boolean;
};

type StoredConversation = Conversation & {
  projectId?: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        request.result.createObjectStore(CONVERSATIONS_STORE, {
          keyPath: "id",
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开本地会话数据库"));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("本地数据操作失败"));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("本地数据操作失败"));
    });
  } finally {
    database.close();
  }
}

function normalizeConversation(conversation: StoredConversation): Conversation {
  // Ignore legacy grouping metadata while preserving existing records on disk.
  const { projectId: _legacyProjectId, ...current } = conversation;
  return current;
}

function getMessageText(message: ThreadMessageLike) {
  if (message.role !== "user") return "";
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .filter(
      (
        part,
      ): part is Extract<(typeof message.content)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function getTitle(
  messages: ThreadMessageLike[],
  currentTitle: string,
  isTitleManuallySet = false,
) {
  if (isTitleManuallySet) return currentTitle;
  const firstMessage = messages.map(getMessageText).find(Boolean);
  if (!firstMessage) return currentTitle;
  return firstMessage.slice(0, 48);
}

// Read and update in one transaction so streaming saves, generated titles and
// manual renames cannot overwrite each other's latest fields.
async function updateConversation(
  id: string,
  update: (current: Conversation | undefined) => Conversation | undefined,
): Promise<Conversation | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        CONVERSATIONS_STORE,
        "readwrite",
      );
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const request = store.get(id);
      let result: Conversation | undefined;
      request.onsuccess = () => {
        if (deletedConversationIds.has(id)) return;
        try {
          result = update(
            request.result ? normalizeConversation(request.result) : undefined,
          );
          if (result) store.put(result);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("本地数据操作失败"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("本地数据操作已取消"));
    });
  } finally {
    database.close();
  }
}

export async function ensureConversation(
  id: string,
): Promise<Conversation> {
  const existing = await getConversation(id);
  if (existing) return existing;
  const now = Date.now();
  const conversation: Conversation = {
    id,
    title: "新会话",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await withStore(CONVERSATIONS_STORE, "readwrite", (store) =>
    store.put(conversation),
  );
  return conversation;
}

export async function getConversation(
  id: string,
): Promise<Conversation | undefined> {
  const conversation = await withStore<StoredConversation | undefined>(
    CONVERSATIONS_STORE,
    "readonly",
    (store) => store.get(id),
  );
  return conversation ? normalizeConversation(conversation) : undefined;
}

export async function saveConversationMessages(
  id: string,
  messages: ThreadMessageLike[],
  agentId?: string,
): Promise<Conversation | undefined> {
  if (deletedConversationIds.has(id)) return undefined;
  return updateConversation(id, (current) => {
    // Empty drafts enter history only after a message has been sent.
    if (!current && messages.length === 0) return undefined;
    const now = Date.now();
    return {
      ...current,
      id,
      agentId: current ? current.agentId : agentId,
      title: getTitle(
        messages,
        current?.title ?? "新会话",
        current?.isTitleManuallySet || current?.isTitleGenerated,
      ),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      messages,
    };
  });
}

export function saveGeneratedConversationTitle(
  id: string,
  title: string,
): Promise<Conversation | undefined> {
  return updateConversation(id, (current) => {
    if (
      !current ||
      current.isTitleManuallySet ||
      current.isTitleGenerated ||
      !title.trim()
    )
      return undefined;
    // Updating metadata should not move an older conversation to the top.
    return { ...current, title: title.trim(), isTitleGenerated: true };
  });
}

export async function listConversations(): Promise<Conversation[]> {
  const stored = await withStore<StoredConversation[]>(
    CONVERSATIONS_STORE,
    "readonly",
    (store) => store.getAll(),
  );
  const conversations = stored.map(normalizeConversation);
  return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function renameConversation(
  id: string,
  title: string,
): Promise<Conversation> {
  const conversation = await updateConversation(id, (current) => {
    if (!current) throw new Error("会话不存在");
    return {
      ...current,
      title,
      updatedAt: Date.now(),
      isTitleManuallySet: true,
    };
  });
  if (!conversation) throw new Error("会话不存在");
  return conversation;
}

export function deleteConversation(id: string): Promise<undefined> {
  deletedConversationIds.add(id);
  return withStore(CONVERSATIONS_STORE, "readwrite", (store) =>
    store.delete(id),
  );
}
