import { agentWorkspace } from "@/lib/platform-api";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { useSearchParams } from "react-router";
import { SchedulerDialog } from "@/components/scheduler-dialog";
import { SettingsDialog, type SettingsTab } from "@/components/settings-dialog";
import {
  deleteConversation,
  getConversation,
  listConversationPage,
  subscribeConversationChanges,
  renameConversation,
  type Conversation,
} from "@/lib/conversation-store";
import {
  loadProviderConfig,
  saveProviderConfig,
  type ProviderConfig,
} from "@/lib/provider-config";
import { authHeaders, serverInfo } from "@/lib/server-info";
import { createUuid } from "@/lib/utils";
import { Chat } from "@/views/chat/chat";

function newConversationId() {
  return createUuid();
}

export function ChatView({
  agentId,
  agentName,
}: { agentId: string; agentName?: string }) {
  const filterConversations = useCallback(
    (items: Conversation[]) =>
      items.filter((c) => (c.agentId ?? undefined) === agentId),
    [agentId],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversationId, setConversationId] = useState(
    () => searchParams.get("conversationId") ?? newConversationId(),
  );
  const [loadedConversation, setLoadedConversation] = useState<{
    id: string;
    messages: ThreadMessageLike[];
  } | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [providerConfig, setProviderConfig] = useState(loadProviderConfig);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [serverModel, setServerModel] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void serverInfo()
      .then((server) =>
        fetch(`${server.baseUrl}/api/config/provider`, {
          headers: authHeaders(server),
          signal: controller.signal,
        }),
      )
      .then(async (response) => {
        if (!response.ok) return;
        const config = (await response.json()) as { model?: unknown };
        if (!controller.signal.aborted && typeof config.model === "string")
          setServerModel(config.model.trim());
      })
      .catch(() => {
        // Chat can still use the server defaults if config discovery fails.
      });
    return () => controller.abort();
  }, []);
  const tombstones = useRef(new Set<string>());
  const acceptLibrary = useCallback((items: Conversation[]) => {
    setConversations((current) => {
      const merged = new Map(current.map((row) => [row.id, row]));
      for (const row of items) {
        if ((merged.get(row.id)?.revision ?? -1) <= (row.revision ?? 0)) merged.set(row.id, row);
      }
      return filterConversations([...merged.values()]).filter((row) => !tombstones.current.has(row.id)).sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
    });
  }, [filterConversations]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("provider");
  const refreshLibrary = useCallback(() => {
    void listConversationPage(undefined, agentId)
      .then((page) => {
        acceptLibrary(page.conversations);
        setNextCursor(page.nextCursor);
        setLoadError("");
      })
      .catch(() => { setLoadError("历史加载失败，请重试。"); });
  }, [filterConversations, agentId, acceptLibrary]);
  useEffect(() => {
    let cancelled = false;
    setLoadedConversation(null);
    setLoadError("");
    void getConversation(conversationId)
      .then(async (conversation) => {
        const page = await listConversationPage(undefined, agentId);
        const nextConversations = page.conversations;
        if (cancelled) return;
        if (conversation && (conversation.agentId ?? undefined) !== agentId) {
          const id = newConversationId();
          setSearchParams({ conversationId: id }, { replace: true });
          setConversationId(id);
          return;
        }
        acceptLibrary(nextConversations);
        setNextCursor(page.nextCursor);
        setLoadedConversation({
          id: conversationId,
          messages: conversation?.messages ?? [],
        });
      })
      .catch(() => { if (!cancelled) setLoadError("历史加载失败，请重试。"); });
    return () => {
      cancelled = true;
    };
  }, [conversationId, agentId, filterConversations, setSearchParams, loadAttempt, acceptLibrary]);
  useEffect(() => {
    const urlConversationId = searchParams.get("conversationId");
    if (urlConversationId) {
      setConversationId((current) =>
        current === urlConversationId ? current : urlConversationId,
      );
    } else {
      setSearchParams({ conversationId }, { replace: true });
    }
  }, [searchParams, conversationId, setSearchParams]);
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void listConversationPage(undefined, agentId).then((page) => {
      if (disposed) return;
      acceptLibrary(page.conversations);
      setNextCursor(page.nextCursor);
      unsubscribe = subscribeConversationChanges(page.lastChangeId, (change) => {
        if (change.type === "reset_required") { setConversations([]); tombstones.current.clear(); }
        if (change.type === "deleted") {
          tombstones.current.add(change.conversationId);
          setConversations((rows) => rows.filter((row) => row.id !== change.conversationId));
          if (change.conversationId === conversationId) {
            const id = newConversationId(); setConversationId(id); setSearchParams({ conversationId: id });
          }
        }
        refreshLibrary();
      });
    }).catch(() => { if (!disposed) setLoadError("历史加载失败，请重试。"); });
    const foreground = () => { if (document.visibilityState === "visible") refreshLibrary(); };
    document.addEventListener("visibilitychange", foreground);
    return () => { disposed = true; unsubscribe?.(); document.removeEventListener("visibilitychange", foreground); };
  }, [agentId, conversationId, refreshLibrary, setSearchParams, acceptLibrary]);
  const loadMore = () => {
    if (!nextCursor) return;
    void listConversationPage(nextCursor, agentId).then((page) => {
      acceptLibrary(page.conversations);
      setNextCursor(page.nextCursor);
    }).catch(() => setLoadError("历史加载失败，请重试。"));
  };
  const startNewThread = () => {
    const id = newConversationId();
    setSearchParams({ conversationId: id });
    setConversationId(id);
  };
  const selectThread = (id: string) => {
    if (id === conversationId) return;
    setSearchParams({ conversationId: id });
    setConversationId(id);
  };
  const renameThread = (conversation: Conversation) => {
    const title = window.prompt("会话名称", conversation.title)?.trim();
    if (!title || title === conversation.title) return;
    void renameConversation(conversation.id, title).then(refreshLibrary).catch((error) => setLoadError(error.message));
  };
  const removeThread = (conversation: Conversation) => {
    if (!window.confirm(`删除会话“${conversation.title}”？此操作无法撤销。`))
      return;
    void deleteConversation(conversation.id).then(() => {
      tombstones.current.add(conversation.id);
      setConversations((rows) => rows.filter((row) => row.id !== conversation.id));
      refreshLibrary();
      if (conversation.id === conversationId)
        startNewThread();
    }).catch((error) => setLoadError(error.message));
  };
  const saveSettings = (next: ProviderConfig) => {
    saveProviderConfig(next);
    setProviderConfig(next);
    setSettingsOpen(false);
  };
  const selectModel = (model: string) => {
    if (
      model === providerConfig.model ||
      !providerConfig.models.includes(model)
    )
      return;
    const next = { ...providerConfig, model };
    saveProviderConfig(next);
    setProviderConfig(next);
  };
  const openSettings = (tab: SettingsTab = "provider") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const activeConversation = conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  return (
    <>
      {loadError && <p role="alert">{loadError} <button onClick={() => { setLoadError(""); setLoadAttempt((value) => value + 1); }}>重试</button></p>}
      {!loadedConversation && !loadError && <p role="status">正在加载会话…</p>}
      {/* Never seed a new runtime with messages loaded for another thread. */}
      {loadedConversation?.id === conversationId && (
        <Chat
          key={conversationId}
          agentId={agentId}
          conversationId={conversationId}
          initialMessages={loadedConversation.messages}
          title={activeConversation?.title ?? agentName ?? "新会话"}
          conversations={conversations}
          workingDirectory={agentWorkspace(agentId)}
          onLoadMore={nextCursor ? loadMore : undefined}
          onNewThread={startNewThread}
          onSelectThread={selectThread}
          onRenameThread={renameThread}
          onDeleteThread={removeThread}
          providerConfig={providerConfig}
          serverModel={serverModel}
          onModelChange={selectModel}
          onOpenSettings={openSettings}
          onOpenScheduler={() => setSchedulerOpen(true)}
          onConversationSaved={refreshLibrary}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          config={providerConfig}
          initialTab={settingsTab}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {schedulerOpen && (
        <SchedulerDialog
          getServerInfo={serverInfo}
          onClose={() => setSchedulerOpen(false)}
        />
      )}
    </>
  );
}
