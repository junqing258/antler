import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { AssistantThread } from '@/components/assistant-ui/thread';
import { useAntlerRuntime } from '@/components/assistant-ui/use-antler-runtime';
import { MessageSquareMoreIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import './styles.css';

type ServerInfo = { baseUrl: string; token: string };

async function serverInfo(): Promise<ServerInfo> {
  if ('__TAURI_INTERNALS__' in window) return invoke<ServerInfo>('server_info');
  return { baseUrl: 'http://127.0.0.1:3210', token: '' };
}

function Chat() {
  const runtime = useAntlerRuntime(serverInfo);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="app-shell">
        <aside className="app-sidebar">
          <div className="brand"><MessageSquareMoreIcon aria-hidden="true" /><span>assistant-ui</span></div>
          <button className="new-thread" type="button"><PlusIcon aria-hidden="true" />New Thread</button>
          <nav className="thread-history" aria-label="Chat history">
            <p>Earlier</p>
            <button type="button">User Greeting</button>
          </nav>
          <div className="sidebar-footer">
            <button className="user-center" type="button" aria-label="用户中心">
              <span className="user-avatar">U</span>
              <span className="user-details"><strong>Unsloth</strong><small>Unsloth</small></span>
            </button>
            <button className="settings-center" type="button" aria-label="设置中心"><SettingsIcon /></button>
          </div>
        </aside>
        <section className="chat-panel"><AssistantThread /></section>
      </main>
    </AssistantRuntimeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Chat /></StrictMode>);
