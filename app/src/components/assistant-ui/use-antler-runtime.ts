import {
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ChatMessage } from "@antler/chat-core";
import {
  ChatSession,
  getBoundCredential,
  subscribeRunStream,
} from "@antler/client-runtime";
import type { ProviderConfig } from "@/lib/provider-config";
import {
  displayMessages,
  getMessagePage,
  getConversation,
  listConversationPage,
  subscribeConversationChanges,
  subscribeConversationSessionReset,
} from "@/lib/conversation-store";
import { createWebPlatform } from "@/lib/platform/web-platform";

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]),
    );
  return null;
}

const convertMessage = (message: ChatMessage): ThreadMessageLike => ({
  id: message.id,
  role: message.role,
  content: message.content.map((part) => {
    if (part.type === "unknown")
      return { type: "text" as const, text: "[不支持的消息内容]" };
    if (part.type === "tool-call")
      return {
        ...part,
        args: Object.fromEntries(
          Object.entries(part.args).map(([key, value]) => [
            key,
            toJsonValue(value),
          ]),
        ),
      };
    return part;
  }),
  createdAt: message.createdAt,
  status: message.status,
  metadata: {
    custom: { runId: message.runId, appliedEventId: message.appliedEventId },
  },
});

type ServerInfo = { baseUrl: string; token: string };
export function useAntlerRuntime(
  getServerInfo: () => Promise<ServerInfo>,
  conversationId: string,
  workingDirectory: string,
  getProviderConfig: () => ProviderConfig,
  initialMessages: ChatMessage[],
  onConversationSaved: () => void,
  agentId?: string,
) {
  const refs = useRef({
    getServerInfo,
    getProviderConfig,
    onConversationSaved,
  });
  refs.current = { getServerInfo, getProviderConfig, onConversationSaved };
  const platform = useMemo(
    () => createWebPlatform(() => refs.current.getServerInfo()),
    [],
  );
  const session = useMemo(
    () =>
      new ChatSession(
        { conversationId, workingDirectory, initialMessages, agentId },
        {
          initialize: () => platform.initialize(),
          listChangesCursor: async () =>
            (await listConversationPage()).lastChangeId,
          getConversation,
          getEarlier: async (id, beforeSeq) => {
            const page = await getMessagePage(id, beforeSeq);
            return {
              messages: displayMessages(page),
              firstSeq: page.messages[0]?.seq,
              hasMore: page.hasMore,
            };
          },
          subscribeChanges: subscribeConversationChanges,
          subscribeRun: (runId, onEvent, onConnection) =>
            subscribeRunStream(platform, runId, onEvent, onConnection),
          prepareSend: async () => {
            const server = await platform.connection();
            return async (body) => {
              const response = await platform.request(
                `${server.baseUrl}/api/runs`,
                {
                  method: "POST",
                  headers: {
                    ...server.headers,
                    "content-type": "application/json",
                  },
                  body,
                },
              );
              const data: { runId?: unknown; error?: string } = await response
                .json()
                .catch(() => ({}));
              return { ok: response.ok, data };
            };
          },
          prepareCancel: async () => {
            const server = await platform.connection();
            return async (runId) => {
              await platform.request(
                `${server.baseUrl}/api/runs/${runId}/cancel`,
                {
                  method: "POST",
                  headers: server.headers,
                },
              );
            };
          },
          getProvider: () => ({ ...refs.current.getProviderConfig() }),
          createId: platform.createId,
          delay: (ms) =>
            new Promise((resolve) => {
              platform.schedule(resolve, ms);
            }),
          onSaved: () => refs.current.onConversationSaved(),
        },
      ),
    [conversationId, workingDirectory, agentId, platform],
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const provider = getProviderConfig();
  useEffect(() => {
    session.providerChanged();
  }, [session, provider.apiKey, provider.protocol, provider.baseUrl]);
  const credentialNotice = session.credentialProblem();
  useEffect(() => {
    session.start();
    const unsubscribeReset = subscribeConversationSessionReset(() =>
      session.stop(),
    );
    const unsubscribeForeground = platform.onForeground(() => {
      void session.refresh().catch(() => {});
    });
    return () => {
      unsubscribeReset();
      unsubscribeForeground();
      session.stop();
    };
  }, [session, platform]);
  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages: state.messages,
    isRunning: state.running,
    isSendDisabled:
      !state.ready ||
      state.sending ||
      state.running ||
      Boolean(state.contextReason) ||
      Boolean(credentialNotice),
    convertMessage,
    onNew: async (message) =>
      session.send(
        message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      ),
    onCancel: () => session.cancel(),
  });
  return {
    runtime,
    notice:
      state.contextReason ||
      state.notice ||
      (!state.ready ? "正在加载会话配置…" : ""),
    credentialNotice,
    boundCredential: getBoundCredential(state.executionConfig),
    hasMore: state.hasMore,
    loadEarlier: () => session.loadEarlier(),
    boundModel:
      typeof state.executionConfig?.model === "string"
        ? state.executionConfig.model
        : undefined,
  };
}
