import { StrictMode, useCallback, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { AssistantThread } from '@/components/assistant-ui/thread';
import { useAntlerRuntime } from '@/components/assistant-ui/use-antler-runtime';
import { defaultProviderConfig, loadProviderConfig, saveProviderConfig, type ProviderConfig } from '@/lib/provider-config';
import { deleteConversation, ensureConversation, listConversations, renameConversation, type Conversation } from '@/lib/conversation-store';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { PencilIcon, PlusIcon, SettingsIcon, Trash2Icon, XIcon } from 'lucide-react';
import './styles.css';

type ServerInfo = { baseUrl: string; token: string };

async function serverInfo(): Promise<ServerInfo> {
  if ('__TAURI_INTERNALS__' in window) return invoke<ServerInfo>('server_info');
  return { baseUrl: 'http://127.0.0.1:3210', token: '' };
}

function newConversationId() {
  return crypto.randomUUID();
}

function getConversationIdFromUrl() {
  return new URL(window.location.href).searchParams.get('conversationId');
}

function setConversationIdInUrl(conversationId: string, replace = false) {
  const url = new URL(window.location.href);
  url.searchParams.set('conversationId', conversationId);
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

function SettingsDialog({ config, onSave, onClose }: { config: ProviderConfig; onSave: (config: ProviderConfig) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(config);
  const [newModel, setNewModel] = useState("");
  const update = (key: keyof ProviderConfig, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const addModel = () => {
    const model = newModel.trim();
    if (!model || draft.models.includes(model)) return;
    setDraft((current) => ({ ...current, models: [...current.models, model], model: current.model || model }));
    setNewModel("");
  };
  const removeModel = (model: string) => setDraft((current) => {
    if (current.models.length === 1) return current;
    const models = current.models.filter((item) => item !== model);
    return { ...current, models, model: current.model === model ? models[0] : current.model };
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ ...draft, name: draft.name.trim() || "自定义供应商", baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim(), models: draft.models.map((model) => model.trim()).filter(Boolean), model: draft.model.trim() });
  };
  return <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
    <form className="settings-dialog" aria-labelledby="settings-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <div className="settings-heading"><div><h2 id="settings-title">供应商配置</h2><p>配置仅保存在当前浏览器的本地存储中。</p></div><button type="button" onClick={onClose} aria-label="关闭设置"><XIcon /></button></div>
      <label>名称<input value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：OpenAI" /></label>
      <label>协议<select value={draft.protocol} onChange={(event) => update("protocol", event.target.value)}><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
      <label>Base URL（可选）<input type="url" value={draft.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} placeholder="https://api.openai.com/v1" /></label>
      <label>API Key<input type="password" value={draft.apiKey} onChange={(event) => update("apiKey", event.target.value)} placeholder="仅保存在本地" autoComplete="off" /></label>
      <div className="provider-models"><span>模型</span><div className="provider-model-list">{draft.models.map((model) => <div key={model} className="provider-model-row"><label><input type="radio" name="default-model" checked={draft.model === model} onChange={() => update("model", model)} /><span>{model}</span></label><button type="button" onClick={() => removeModel(model)} disabled={draft.models.length === 1} aria-label={`删除 ${model}`}>删除</button></div>)}</div><div className="provider-model-add"><input value={newModel} onChange={(event) => setNewModel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addModel(); } }} placeholder="输入模型 ID，例如 gpt-4.1-mini" /><button type="button" onClick={addModel}>添加模型</button></div></div>
      <div className="settings-actions"><button type="button" onClick={() => setDraft(defaultProviderConfig)}>恢复默认</button><button className="settings-save" type="submit">保存配置</button></div>
    </form>
  </div>;
}

function Chat({ conversationId, initialMessages, title, conversations, onNewThread, onSelectThread, onRenameThread, onDeleteThread, providerConfig, onOpenSettings, onConversationSaved }: { conversationId: string; initialMessages: ThreadMessageLike[]; title: string; conversations: Conversation[]; onNewThread: () => void; onSelectThread: (id: string) => void; onRenameThread: (conversation: Conversation) => void; onDeleteThread: (conversation: Conversation) => void; providerConfig: ProviderConfig; onOpenSettings: () => void; onConversationSaved: () => void }) {
  const runtime = useAntlerRuntime(serverInfo, conversationId, () => providerConfig, initialMessages, onConversationSaved);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="app-shell">
        <aside className="app-sidebar">
          <div className="brand"><img className="brand-logo" src="/favicon.png" alt="" /><span>Antler</span></div>
          <button className="new-thread" type="button" onClick={onNewThread}><PlusIcon aria-hidden="true" />New Thread</button>
          <nav className="thread-history" aria-label="Chat history">
            <p>Earlier</p>
            {conversations.map((conversation) => <div className="thread-history-item" key={conversation.id}><button className="thread-history-select" type="button" aria-current={conversation.id === conversationId ? 'page' : undefined} onClick={() => onSelectThread(conversation.id)}>{conversation.title}</button><div className="thread-history-actions"><button type="button" aria-label={`重命名 ${conversation.title}`} onClick={() => onRenameThread(conversation)}><PencilIcon /></button><button type="button" aria-label={`删除 ${conversation.title}`} onClick={() => onDeleteThread(conversation)}><Trash2Icon /></button></div></div>)}
          </nav>
          <div className="sidebar-footer">
            <button className="user-center" type="button" aria-label="用户中心">
              <span className="user-avatar">U</span>
              <span className="user-details"><strong>User</strong><small>User</small></span>
            </button>
            <button className="settings-center" type="button" aria-label="设置中心" onClick={onOpenSettings}><SettingsIcon /></button>
          </div>
        </aside>
        <section className="chat-panel"><AssistantThread model={providerConfig.model} title={title} /></section>
      </main>
    </AssistantRuntimeProvider>
  );
}

function App() {
  const [conversationId, setConversationId] = useState(() => getConversationIdFromUrl() ?? newConversationId());
  const [initialMessages, setInitialMessages] = useState<ThreadMessageLike[] | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [providerConfig, setProviderConfig] = useState(loadProviderConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const refreshConversations = useCallback(() => {
    void listConversations().then(setConversations).catch(() => setConversations([]));
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!getConversationIdFromUrl()) setConversationIdInUrl(conversationId, true);
    setInitialMessages(null);
    void ensureConversation(conversationId)
      .then((conversation) => {
        if (cancelled) return;
        setInitialMessages(conversation.messages);
        refreshConversations();
      })
      // IndexedDB can be disabled by a browser policy. Keep chat usable even
      // though persistence is unavailable in that environment.
      .catch(() => {
        if (!cancelled) setInitialMessages([]);
      });
    return () => { cancelled = true; };
  }, [conversationId, refreshConversations]);
  useEffect(() => {
    const onPopState = () => {
      const id = getConversationIdFromUrl() ?? newConversationId();
      if (!getConversationIdFromUrl()) setConversationIdInUrl(id, true);
      setConversationId(id);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const startNewThread = () => {
    const id = newConversationId();
    setConversationIdInUrl(id);
    setConversationId(id);
  };
  const selectThread = (id: string) => {
    if (id === conversationId) return;
    setConversationIdInUrl(id);
    setConversationId(id);
  };
  const renameThread = (conversation: Conversation) => {
    const title = window.prompt('会话名称', conversation.title)?.trim();
    if (!title || title === conversation.title) return;
    void renameConversation(conversation.id, title).then(refreshConversations);
  };
  const removeThread = (conversation: Conversation) => {
    if (!window.confirm(`删除会话“${conversation.title}”？此操作无法撤销。`)) return;
    void deleteConversation(conversation.id).then(() => {
      refreshConversations();
      if (conversation.id === conversationId) startNewThread();
    });
  };
  const saveSettings = (next: ProviderConfig) => { saveProviderConfig(next); setProviderConfig(next); setSettingsOpen(false); };

  const activeConversation = conversations.find((conversation) => conversation.id === conversationId);
  return <>{initialMessages && <Chat key={conversationId} conversationId={conversationId} initialMessages={initialMessages} title={activeConversation?.title ?? 'New Chat'} conversations={conversations} onNewThread={startNewThread} onSelectThread={selectThread} onRenameThread={renameThread} onDeleteThread={removeThread} providerConfig={providerConfig} onOpenSettings={() => setSettingsOpen(true)} onConversationSaved={refreshConversations} />}{settingsOpen && <SettingsDialog config={providerConfig} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}</>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
