import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { platformApi, type PlatformAgent } from "@/lib/platform-api";
import { ChatView } from "@/views/chat";
import { ErrorNotice } from "./layout";
export function AgentChatPage() {
  const { id } = useParams();
  const [agent, setAgent] = useState<PlatformAgent>(),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setAgent(undefined);
    setError("");
    void platformApi<PlatformAgent>(`/agents/${id}`)
      .then((value) => {
        if (!cancelled) setAgent(value);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (!agent)
    return (
      <main className="grid h-[var(--app-viewport-height)] place-items-center bg-[#fafaf9] text-[#222]">
        <div className="px-6 text-center">
          <ErrorNotice error={error} />
          {!error && <p role="status">正在加载…</p>}
          {error && <Link to="/">返回 Agent 列表</Link>}
        </div>
      </main>
    );
  return <ChatView key={agent.id} agentId={agent.id} agentName={agent.name} />;
}
