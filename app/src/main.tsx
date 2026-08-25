import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { AssistantThread } from '@/components/assistant-ui/thread';
import { useAntlerRuntime } from '@/components/assistant-ui/use-antler-runtime';
import { MessageSquareMoreIcon, PlusIcon } from 'lucide-react';
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
        </aside>
        <section className="chat-panel"><AssistantThread /></section>
      </main>
    </AssistantRuntimeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Chat /></StrictMode>);
