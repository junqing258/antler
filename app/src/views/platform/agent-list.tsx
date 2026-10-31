import { AgentIcon } from "@/components/agent-icon";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { getConversation } from "@/lib/conversation-store";
import { authMode } from "@/lib/server-info";
import { platformApi, type PlatformAgent } from "@/lib/platform-api";
import { AgentList, type AgentListLink } from "@antler/ui";
import { ErrorNotice, PlatformLayout, primary } from "./layout";
import { HomeBackground } from "@/components/home-background";
export function AgentListPage() {
  const [agents, setAgents] = useState<PlatformAgent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    const id = params.get("conversationId");
    if (!id) return;
    let cancelled = false;
    void getConversation(id)
      .then((conversation) => {
        if (!cancelled)
          navigate(
            conversation?.agentId
              ? `/agents/${conversation.agentId}?conversationId=${encodeURIComponent(id)}`
              : "/",
            { replace: true },
          );
      })
      .catch(() => {
        if (!cancelled)
          navigate("/", {
            replace: true,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [params, navigate]);
  useEffect(() => {
    if (params.get("conversationId")) return;
    let cancelled = false;
    void platformApi<{ agents: PlatformAgent[] }>("/agents")
      .then((data) => {
        if (!cancelled) setAgents(data.agents);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params]);
  return (
    <PlatformLayout title="选择你的 Agent" background={<HomeBackground />}>
      <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[#666]">
          选择专注于任务的 Agent，或创建自己的助手。
        </p>
        <Link className={primary} to="/agents/new">
          新建 Agent
        </Link>
      </div>
      <ErrorNotice error={error} />
      {loading && <p role="status">正在加载…</p>}
      {!loading &&
        !error && (
          <AgentList
            groups={[
              { name: "我的 Agent", items: agents.filter((a) => a.editable) },
              {
                name: "已发布 Agent",
                items: agents.filter((a) => !a.editable),
              },
            ].map((group) => ({
              name: group.name,
              items: group.items.map((agent) => ({
                id: agent.id,
                name: agent.name,
                description: agent.description,
                icon: agent.icon,
                status: agent.status,
                skillCount: agent._count?.skills,
                editable: agent.editable,
                ownerNote:
                  !agent.builtin && authMode() === "supabase"
                    ? ` · 作者 ${agent.ownerId}`
                    : "",
              })),
            }))}
            renderLink={(link: AgentListLink, content: ReactNode) =>
              link.kind === "open" ? (
                <Link to={`/agents/${link.item.id}`}>{content}</Link>
              ) : (
                <Link to={`/agents/${link.item.id}/edit`}>{content}</Link>
              )
            }
            renderIcon={(name) => <AgentIcon name={name} />}
          />
        )}
    </PlatformLayout>
  );
}
