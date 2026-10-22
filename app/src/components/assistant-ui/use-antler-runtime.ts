import {
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderConfig } from "@/lib/provider-config";
import {
  displayMessages,
  getMessagePage,
  getConversation,
  listConversationPage,
  subscribeConversationChanges,
} from "@/lib/conversation-store";
import { authHeaders } from "@/lib/server-info";
import { createUuid } from "@/lib/utils";

const convertMessage = (message: ThreadMessageLike) => message;

type ServerInfo = { baseUrl: string; token: string };
export function useAntlerRuntime(
  getServerInfo: () => Promise<ServerInfo>,
  conversationId: string,
  workingDirectory: string,
  getProviderConfig: () => ProviderConfig,
  initialMessages: ThreadMessageLike[],
  onConversationSaved: () => void,
  agentId?: string,
) {
  const [messages, setMessages] = useState(initialMessages);
  const [hasMore, setHasMore] = useState(false);
  const firstSeq = useRef<number>();
  const [running, setRunning] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [contextReason, setContextReason] = useState("");
  const [notice, setNotice] = useState("");
  const revision = useRef(0);
  const activeRun = useRef<string | null>(null);
  const config = useRef<Record<string, unknown>>();
  const mounted = useRef(true);
  const sending = useRef(false);
  const refresh = useCallback(async () => {
    const conversation = await getConversation(conversationId);
    if (
      !mounted.current ||
      !conversation ||
      (conversation.revision ?? 0) < revision.current
    )
      return;
    revision.current = conversation.revision ?? 0;
    activeRun.current = conversation.activeRunId ?? null;
    config.current = conversation.executionConfig;
    setContextReason(
      conversation.contextState && conversation.contextState !== "available"
        ? (conversation.contextReason ?? "模型上下文未恢复，请新建会话。")
        : "",
    );
    setHasMore(conversation.hasMoreMessages ?? false);
    setMessages((current) => {
      const incoming = new Set(conversation.messages.map((message) => message.id));
      const overlap = current.findIndex((item) => incoming.has(item.id));
      if (overlap < 0) {
        firstSeq.current = conversation.firstSeq;
        return conversation.messages;
      }
      firstSeq.current = firstSeq.current === undefined
        ? conversation.firstSeq
        : Math.min(firstSeq.current, conversation.firstSeq ?? firstSeq.current);
      return [...current.slice(0, overlap), ...conversation.messages];
    });
    setRunning(Boolean(conversation.activeRunId));
  }, [conversationId]);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void listConversationPage()
      .then(async (page) => {
        await refresh();
        if (disposed) return;
        unsubscribe = subscribeConversationChanges(
          page.lastChangeId,
          (change) => {
            if (
              change.conversationId === conversationId ||
              change.type === "reset_required"
            )
              void refresh().catch(() => {});
          },
          (connected) => {
            if (mounted.current)
              setNotice(connected ? "" : "连接中断，正在重连");
            if (connected) void refresh().catch(() => {});
          },
        );
      })
      .catch(() => {
        if (mounted.current) setNotice("无法加载会话，请重试。");
      });
    const foreground = () => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => {});
    };
    document.addEventListener("visibilitychange", foreground);
    return () => {
      disposed = true;
      mounted.current = false;
      unsubscribe?.();
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [conversationId, refresh]);
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning: running,
    isSendDisabled: isSending || running || Boolean(contextReason),
    convertMessage,
    onNew: async (message) => {
      if (sending.current || activeRun.current) {
        setNotice("该会话正在回复中");
        return;
      }
      sending.current = true;
      setIsSending(true);
      setNotice("发送中…");
      try {
        const server = await getServerInfo();
        const provider = getProviderConfig();
        const bound = config.current;
        const body = JSON.stringify({
          message: message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
          conversationId,
          clientRequestId: createUuid(),
          expectedRevision: revision.current,
          ...(agentId ? { agentId } : {}),
          ...(bound ? {} : workingDirectory.trim() ? { workingDirectory } : {}),
          ...(bound?.credentialSource === "server"
            ? {}
            : provider.apiKey.trim()
              ? {
                  provider: bound
                    ? {
                        ...provider,
                        protocol: bound.protocol,
                        baseUrl: bound.baseUrl,
                        model: bound.model,
                      }
                    : provider,
                }
              : {}),
        });
        let response: Response | undefined;
        // A lost acknowledgement is retried with precisely the same request ID and body.
        for (let attempt = 0; mounted.current; attempt++) {
          try {
            response = await fetch(`${server.baseUrl}/api/runs`, {
              method: "POST",
              headers: {
                ...authHeaders(server),
                "content-type": "application/json",
              },
              body,
            });
            break;
          } catch (error) {
            if (mounted.current) setNotice("发送待确认，正在重试…");
            await new Promise((resolve) =>
              setTimeout(resolve, Math.min(500 * 2 ** attempt, 15000)),
            );
          }
        }
        if (!response?.ok) {
          const data = await response?.json();
          throw new Error(
            data?.error === "conversation_busy"
              ? "该会话正在回复中"
              : (data?.error ?? "发送失败"),
          );
        }
        if (mounted.current) {
          setNotice("");
          await refresh();
          onConversationSaved();
        }
      } catch (error) {
        if (mounted.current)
          setNotice(
            error instanceof Error
              ? error.message
              : "发送待确认，请重新连接服务端。",
          );
      } finally {
        sending.current = false;
        if (mounted.current) setIsSending(false);
      }
    },
    onCancel: async () => {
      if (!activeRun.current) return;
      const server = await getServerInfo();
      await fetch(`${server.baseUrl}/api/runs/${activeRun.current}/cancel`, {
        method: "POST",
        headers: authHeaders(server),
      });
    },
  });
  const loadEarlier = async () => {
    const page = await getMessagePage(conversationId, firstSeq.current);
    if (!mounted.current) return;
    const earlier = displayMessages(page);
    setMessages((current) => [
      ...earlier.filter((item) => !current.some((row) => row.id === item.id)),
      ...current,
    ]);
    firstSeq.current = page.messages[0]?.seq;
    setHasMore(page.hasMore);
  };
  return {
    runtime,
    notice: contextReason || notice,
    hasMore,
    loadEarlier,
    boundModel: config.current?.model as string | undefined,
  };
}
