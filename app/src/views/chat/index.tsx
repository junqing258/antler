import { agentWorkspace } from "@/lib/platform-api";
import { useCallback, useEffect, useState } from "react";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { useSearchParams } from "react-router";
import { SchedulerDialog } from "@/components/scheduler-dialog";
import { SettingsDialog, type SettingsTab } from "@/components/settings-dialog";
import {
  deleteConversation,
  getConversation,
  listConversations,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("provider");
  const refreshLibrary = useCallback(() => {
    void listConversations()
      .then((nextConversations) => {
        setConversations(filterConversations(nextConversations));
      })
      .catch(() => {
        setConversations([]);
      });
  }, [filterConversations]);
  useEffect(() => {
    let cancelled = false;
    setLoadedConversation(null);
    void getConversation(conversationId)
      .then(async (conversation) => {
        const nextConversations = await listConversations();
        if (cancelled) return;
        if (conversation && (conversation.agentId ?? undefined) !== agentId) {
          const id = newConversationId();
          setSearchParams({ conversationId: id }, { replace: true });
          setConversationId(id);
          return;
        }
        setConversations(filterConversations(nextConversations));
        setLoadedConversation({
          id: conversationId,
          messages: conversation?.messages ?? [],
        });
      })
      // IndexedDB can be disabled by a browser policy. Keep chat usable even
      // though persistence is unavailable in that environment.
      .catch(() => {
        if (!cancelled)
          setLoadedConversation({ id: conversationId, messages: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, agentId, filterConversations, setSearchParams]);
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
    void renameConversation(conversation.id, title).then(refreshLibrary);
  };
  const removeThread = (conversation: Conversation) => {
    if (!window.confirm(`删除会话“${conversation.title}”？此操作无法撤销。`))
      return;
    void deleteConversation(conversation.id).then(() => {
      refreshLibrary();
      if (conversation.id === conversationId)
        startNewThread();
    });
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
