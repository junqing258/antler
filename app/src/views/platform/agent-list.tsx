import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { getConversation } from "@/lib/conversation-store";
import { authMode } from "@/lib/server-info";
import { platformApi, type PlatformAgent } from "@/lib/platform-api";
import { ErrorNotice, PlatformLayout, primary } from "./layout";
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
    <PlatformLayout title="选择你的 Agent">
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
      {!loading && !error && !agents.length && (
        <p className="rounded-xl border border-dashed p-12 text-center text-[#777]">
          还没有 Agent。新建一个，设置提示词并绑定技能即可开始对话。
        </p>
      )}
      {[
        { name: "内置 Agent", items: agents.filter((a) => a.builtin) },
        { name: "我的 Agent", items: agents.filter((a) => !a.builtin && a.editable) },
        { name: "已发布 Agent", items: agents.filter((a) => !a.builtin && !a.editable) },
      ].map(
        (group) =>
          group.items.length > 0 && (
            <section key={group.name} className="mb-10">
              <h2 className="mb-4 text-lg font-semibold">{group.name}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((agent) => (
                  <article
                    key={agent.id}
                    className="flex flex-col rounded-xl border border-[#e6e6e2] bg-white p-6 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-lg font-semibold">{agent.name}</h3>
                      <span className="shrink-0 rounded-full bg-[#eef4ef] px-2 py-1 text-xs">
                        {agent.builtin ? "内置" : agent.status === "published" ? "已发布" : "草稿"}
                      </span>
                    </div>
                    <p className="my-4 flex-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#666]">
                      {agent.description}
                    </p>
                    <p className="mb-5 text-xs text-[#888]">
                      {agent._count?.skills ?? 0} 个技能
                      {!agent.builtin && authMode() === "supabase" && ` · 作者 ${agent.ownerId}`}
                    </p>
                    <div className="flex items-center justify-between">
                      <Link
                        to={`/agents/${agent.id}`}
                        className="text-sm font-semibold text-primary"
                      >
                        开始对话 →
                      </Link>
                      {agent.editable && (
                        <Link
                          className="text-sm text-[#666]"
                          to={`/agents/${agent.id}/edit`}
                        >
                          编辑
                        </Link>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ),
      )}
    </PlatformLayout>
  );
}
