import type { ThreadMessageLike } from "@assistant-ui/react";
import { createUuid } from "@/lib/utils";

const DATABASE_NAME = "antler";
const DATABASE_VERSION = 2;
const CONVERSATIONS_STORE = "conversations";
const PROJECTS_STORE = "projects";

export const DEFAULT_PROJECT_ID = "default";

export type Project = {
  id: string;
  name: string;
  workingDirectory: string;
  createdAt: number;
  updatedAt: number;
};

export type Conversation = {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ThreadMessageLike[];
  isTitleManuallySet?: boolean;
};

type StoredConversation = Omit<Conversation, "projectId"> & {
  projectId?: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        request.result.createObjectStore(CONVERSATIONS_STORE, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(PROJECTS_STORE)) {
        request.result.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地会话数据库"));
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
      request.onerror = () => reject(request.error ?? new Error("本地数据操作失败"));
      transaction.onerror = () => reject(transaction.error ?? new Error("本地数据操作失败"));
    });
  } finally {
    database.close();
  }
}

function normalizeConversation(conversation: StoredConversation): Conversation {
  return { ...conversation, projectId: conversation.projectId ?? DEFAULT_PROJECT_ID };
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

export async function ensureDefaultProject(): Promise<Project> {
  const existing = await getProject(DEFAULT_PROJECT_ID);
  if (existing) return existing;
  const now = Date.now();
  const project: Project = {
    id: DEFAULT_PROJECT_ID,
    name: "General",
    workingDirectory: "",
    createdAt: now,
    updatedAt: now,
  };
  await withStore(PROJECTS_STORE, "readwrite", (store) => store.put(project));
  return project;
}

export function getProject(id: string): Promise<Project | undefined> {
  return withStore(PROJECTS_STORE, "readonly", (store) => store.get(id));
}

export async function listProjects(): Promise<Project[]> {
  await ensureDefaultProject();
  const projects = await withStore<Project[]>(PROJECTS_STORE, "readonly", (store) => store.getAll());
  return projects.sort((a, b) => {
    if (a.id === DEFAULT_PROJECT_ID) return -1;
    if (b.id === DEFAULT_PROJECT_ID) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

export async function createProject(name: string, workingDirectory: string): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: createUuid(),
    name: name.trim(),
    workingDirectory: workingDirectory.trim(),
    createdAt: now,
    updatedAt: now,
  };
  await withStore(PROJECTS_STORE, "readwrite", (store) => store.put(project));
  return project;
}

export async function updateProject(
  id: string,
  changes: Pick<Project, "name" | "workingDirectory">,
): Promise<Project> {
  const current = await getProject(id);
  if (!current) throw new Error("项目不存在");
  const project: Project = {
    ...current,
    name: changes.name.trim(),
    workingDirectory: changes.workingDirectory.trim(),
    updatedAt: Date.now(),
  };
  await withStore(PROJECTS_STORE, "readwrite", (store) => store.put(project));
  return project;
}

export async function ensureConversation(
  id: string,
  projectId = DEFAULT_PROJECT_ID,
): Promise<Conversation> {
  const existing = await getConversation(id);
  if (existing) return existing;
  const now = Date.now();
  const conversation: Conversation = {
    id,
    projectId,
    title: "New Chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await withStore(CONVERSATIONS_STORE, "readwrite", (store) => store.put(conversation));
  return conversation;
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
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
): Promise<Conversation> {
  const current = await getConversation(id);
  const now = Date.now();
  const conversation: Conversation = {
    id,
    projectId: current?.projectId ?? DEFAULT_PROJECT_ID,
    title: getTitle(messages, current?.title ?? "New Chat", current?.isTitleManuallySet),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    messages,
    isTitleManuallySet: current?.isTitleManuallySet,
  };
  await withStore(CONVERSATIONS_STORE, "readwrite", (store) => store.put(conversation));
  return conversation;
}

export async function listConversations(): Promise<Conversation[]> {
  const stored = await withStore<StoredConversation[]>(CONVERSATIONS_STORE, "readonly", (store) => store.getAll());
  const conversations = stored.map(normalizeConversation);
  const legacy = stored.filter((conversation) => !conversation.projectId);
  await Promise.all(
    legacy.map((conversation) =>
      withStore(CONVERSATIONS_STORE, "readwrite", (store) =>
        store.put(normalizeConversation(conversation)),
      ),
    ),
  );
  return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function renameConversation(id: string, title: string): Promise<Conversation> {
  const current = await getConversation(id);
  if (!current) throw new Error("会话不存在");
  const conversation = { ...current, title, updatedAt: Date.now(), isTitleManuallySet: true };
  await withStore(CONVERSATIONS_STORE, "readwrite", (store) => store.put(conversation));
  return conversation;
}

export function deleteConversation(id: string): Promise<undefined> {
  return withStore(CONVERSATIONS_STORE, "readwrite", (store) => store.delete(id));
}
