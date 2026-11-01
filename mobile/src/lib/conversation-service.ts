import { subscribeChangeStream } from "@antler/client-runtime";
import type { ClientPlatform } from "@antler/platform";

export type ConversationSummary = {
  id: string;
  agentId?: string;
  title: string;
  titleSource?: string;
  revision?: number;
  lastMessageAt: string;
};

export type ConversationPage = {
  conversations: ConversationSummary[];
  nextCursor: string | null;
  lastChangeId: number;
};

export type ConversationChange =
  | {
      conversationId: string;
      type: string;
      revision: number;
      changeId: number;
    }
  | { conversationId: ""; type: "reset_required"; revision: 0; changeId: 0 };

function describeError(code: string, status: number): string {
  if (code === "conversation_not_found") return "会话不存在或已删除。";
  if (code === "conversation_revision_conflict")
    return "会话已在其他设备更新，请刷新后重试。";
  if (code === "invalid_title") return "会话名称无效，请修改后重试。";
  if (code === "invalid_cursor") return "会话列表已失效，请刷新后重试。";
  if (status === 401) return "登录已过期，请重新登录。";
  return "请求失败，请检查网络后重试。";
}

/** 404 表示会话已删除，返回 undefined；其余错误抛出带服务端语义的消息。 */
async function conversationRequest<T>(
  platform: ClientPlatform,
  path: string,
  init?: RequestInit,
): Promise<T | undefined> {
  const connection = await platform.connection();
  const response = await platform.request(
    `${connection.baseUrl}/api/conversations${path}`,
    {
      ...init,
      headers: {
        ...connection.headers,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: unknown;
    };
    throw new Error(
      describeError(
        typeof body.error === "string" ? body.error : "",
        response.status,
      ),
    );
  }
  return (await response.json()) as T;
}

export async function listConversations(
  platform: ClientPlatform,
  options: { agentId?: string; cursor?: string; limit?: number } = {},
): Promise<ConversationPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.agentId) query.set("agentId", options.agentId);
  const data = await conversationRequest<ConversationPage>(
    platform,
    `?${query}`,
  );
  if (!data || !Array.isArray(data.conversations))
    throw new Error("会话列表加载失败，请重试。");
  return data;
}

export async function renameConversation(
  platform: ClientPlatform,
  id: string,
  title: string,
  expectedRevision?: number,
): Promise<ConversationSummary> {
  const row = await conversationRequest<ConversationSummary>(
    platform,
    `/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ title, expectedRevision }),
    },
  );
  if (!row) throw new Error("会话不存在或已删除。");
  return row;
}

export async function deleteConversation(
  platform: ClientPlatform,
  id: string,
): Promise<void> {
  const result = await conversationRequest<{ deleted?: boolean }>(
    platform,
    `/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!result?.deleted) throw new Error("会话删除失败，请重试。");
}

/** 订阅服务端会话变更流；重置游标时从列表首页恢复 lastChangeId。 */
export function subscribeConversationChanges(
  platform: ClientPlatform,
  initialCursor: number,
  onChange: (change: ConversationChange) => void,
  onConnection?: (connected: boolean) => void,
): () => void {
  return subscribeChangeStream(
    platform,
    initialCursor,
    async () => {
      const page = await listConversations(platform);
      return page.lastChangeId;
    },
    (change) => {
      if (!("changeId" in change)) {
        onChange({
          conversationId: "",
          type: "reset_required",
          revision: 0,
          changeId: 0,
        });
        return;
      }
      onChange(change);
    },
    onConnection,
  );
}
