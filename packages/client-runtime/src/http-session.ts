import { messageFromDto, type MessageDto } from "@antler/chat-core";
import type { ClientPlatform } from "@antler/platform";
import type { SessionDependencies, SessionProvider } from "./index";
import { subscribeRunStream } from "./run-stream";
import { subscribeChangeStream } from "./change-stream";

type Page = {
  messages: MessageDto[];
  revision: number;
  activeRunId: string | null;
  hasMore: boolean;
};
type Conversation = {
  executionConfig?: Record<string, unknown>;
  contextState?: string;
  contextReason?: string;
};

/** Portable HTTP binding for hosts with an isolated server/account configuration. */
export function createHttpSessionDependencies(
  platform: ClientPlatform,
  getProvider: () => SessionProvider,
  onSaved: () => void,
): SessionDependencies {
  async function request(path: string): Promise<unknown | undefined> {
    const connection = await platform.connection();
    const response = await platform.request(
      `${connection.baseUrl}/api/conversations${path}`,
      { headers: connection.headers },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error("无法加载服务端会话");
    return response.json();
  }
  async function page(id: string, beforeSeq?: number): Promise<Page> {
    const result = await request(
      `/${encodeURIComponent(id)}/messages?limit=50${beforeSeq === undefined ? "" : `&beforeSeq=${beforeSeq}`}`,
    );
    if (!result) throw new Error("会话已删除");
    return result as Page;
  }
  async function listChangesCursor() {
    const result = (await request("?limit=50")) as
      { lastChangeId: number } | undefined;
    if (!result || !Number.isSafeInteger(result.lastChangeId))
      throw new Error("无法加载会话游标");
    return result.lastChangeId;
  }
  return {
    initialize: () => platform.initialize(),
    listChangesCursor,
    getConversation: async (id) => {
      const detail = (await request(`/${encodeURIComponent(id)}`)) as
        Conversation | undefined;
      if (!detail) return undefined;
      const messages = await page(id);
      return {
        ...detail,
        messages: messages.messages.map(messageFromDto),
        revision: messages.revision,
        activeRunId: messages.activeRunId,
        hasMoreMessages: messages.hasMore,
        firstSeq: messages.messages[0]?.seq,
      };
    },
    getEarlier: async (id, beforeSeq) => {
      const result = await page(id, beforeSeq);
      return {
        messages: result.messages.map(messageFromDto),
        firstSeq: result.messages[0]?.seq,
        hasMore: result.hasMore,
      };
    },
    subscribeChanges: (cursor, onChange, onConnection) =>
      subscribeChangeStream(
        platform,
        cursor,
        listChangesCursor,
        onChange,
        onConnection,
      ),
    subscribeRun: (id, onEvent, onConnection) =>
      subscribeRunStream(platform, id, onEvent, onConnection),
    prepareSend: async () => {
      const connection = await platform.connection();
      return async (body) => {
        const response = await platform.request(
          `${connection.baseUrl}/api/runs`,
          {
            method: "POST",
            headers: {
              ...connection.headers,
              "content-type": "application/json",
            },
            body,
          },
        );
        const data = (await response.json().catch(() => ({}))) as {
          runId?: unknown;
          error?: string;
        };
        return { ok: response.ok, data };
      };
    },
    prepareCancel: async () => {
      const connection = await platform.connection();
      return async (runId) => {
        await platform.request(
          `${connection.baseUrl}/api/runs/${encodeURIComponent(runId)}/cancel`,
          { method: "POST", headers: connection.headers },
        );
      };
    },
    getProvider,
    createId: () => platform.createId(),
    delay: (ms) =>
      new Promise((resolve) => {
        platform.schedule(resolve, ms);
      }),
    onSaved,
  };
}
