import { StrictMode, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { AssistantThread } from '@/components/assistant-ui/thread';
import { useAntlerRuntime } from '@/components/assistant-ui/use-antler-runtime';
import { defaultProviderConfig, loadProviderConfig, saveProviderConfig, type ProviderConfig } from '@/lib/provider-config';
import { MessageSquareMoreIcon, PlusIcon, SettingsIcon, XIcon } from 'lucide-react';
import './styles.css';

type ServerInfo = { baseUrl: string; token: string };

async function serverInfo(): Promise<ServerInfo> {
  if ('__TAURI_INTERNALS__' in window) return invoke<ServerInfo>('server_info');
  return { baseUrl: 'http://127.0.0.1:3210', token: '' };
}

function newConversationId() {
  return crypto.randomUUID();
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

function Chat({ conversationId, onNewThread, providerConfig, onOpenSettings }: { conversationId: string; onNewThread: () => void; providerConfig: ProviderConfig; onOpenSettings: () => void }) {
  const runtime = useAntlerRuntime(serverInfo, conversationId, () => providerConfig);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="app-shell">
        <aside className="app-sidebar">
          <div className="brand"><MessageSquareMoreIcon aria-hidden="true" /><span>assistant-ui</span></div>
          <button className="new-thread" type="button" onClick={onNewThread}><PlusIcon aria-hidden="true" />New Thread</button>
          <nav className="thread-history" aria-label="Chat history">
            <p>Earlier</p>
            <button type="button">User Greeting</button>
          </nav>
          <div className="sidebar-footer">
            <button className="user-center" type="button" aria-label="用户中心">
              <span className="user-avatar">U</span>
              <span className="user-details"><strong>Unsloth</strong><small>Unsloth</small></span>
            </button>
            <button className="settings-center" type="button" aria-label="设置中心" onClick={onOpenSettings}><SettingsIcon /></button>
          </div>
        </aside>
        <section className="chat-panel"><AssistantThread model={providerConfig.model} /></section>
      </main>
    </AssistantRuntimeProvider>
  );
}

function App() {
  const [conversationId, setConversationId] = useState(newConversationId);
  const [providerConfig, setProviderConfig] = useState(loadProviderConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const startNewThread = () => setConversationId(newConversationId());
  const saveSettings = (next: ProviderConfig) => { saveProviderConfig(next); setProviderConfig(next); setSettingsOpen(false); };

  // Remounting clears the local view; every turn in this thread keeps its backend session id.
  return <><Chat key={conversationId} conversationId={conversationId} onNewThread={startNewThread} providerConfig={providerConfig} onOpenSettings={() => setSettingsOpen(true)} />{settingsOpen && <SettingsDialog config={providerConfig} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}</>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
