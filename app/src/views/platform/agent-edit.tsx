import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { listConversations } from "@/lib/conversation-store";
import {
  platformApi,
  agentWorkspace,
  type PlatformAgent,
  type PlatformSkill,
} from "@/lib/platform-api";
import { ErrorNotice, PlatformLayout, control, primary } from "./layout";
export function AgentEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<PlatformAgent>();
  const [skills, setSkills] = useState<PlatformSkill[]>([]);
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [systemPrompt, setPrompt] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]),
    [workspace, setWorkspace] = useState("");
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [hasConversations, setHasConversations] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setDirty(false);
    setError("");
    setAgent(undefined);
    setName("");
    setDescription("");
    setPrompt("");
    setSkillIds([]);
    setWorkspace("");
    void Promise.all([
      platformApi<{ skills: PlatformSkill[] }>("/skills"),
      id ? platformApi<PlatformAgent>(`/agents/${id}`) : undefined,
      listConversations(),
    ])
      .then(([catalog, value, conversations]) => {
        if (cancelled) return;
        setSkills(catalog.skills);
        if (value) {
          setAgent(value);
          setName(value.name);
          setDescription(value.description);
          setPrompt(value.systemPrompt);
          setSkillIds(value.skills?.map((s) => s.skillId) ?? []);
          setWorkspace(
            agentWorkspace(value.id) || value.defaultWorkspace || "",
          );
          setHasConversations(
            value.hasConversations ||
              conversations.some((c) => c.agentId === id),
          );
        }
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const value = await platformApi<PlatformAgent>(
        id ? `/agents/${id}` : "/agents",
        id ? "PUT" : "POST",
        { name, description, systemPrompt, skillIds },
      );
      localStorage.setItem(
        `antler.agent.workspace.${value.id}`,
        workspace.trim() ||
          value.defaultWorkspace ||
          agent?.defaultWorkspace ||
          "",
      );
      setWorkspace(
        workspace.trim() ||
          value.defaultWorkspace ||
          agent?.defaultWorkspace ||
          "",
      );
      setAgent({ ...agent, ...value, editable: true });
      setDirty(false);
      if (!id) navigate(`/agents/${value.id}/edit`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const action = async (kind: "publish" | "unpublish" | "delete") => {
    if (!id) return;
    if (
      kind === "delete" &&
      !window.confirm("删除此 Agent？已有聊天记录会保留。")
    )
      return;
    setBusy(true);
    setError("");
    try {
      const value = await platformApi<PlatformAgent>(
        `/agents/${id}${kind === "delete" ? "" : `/${kind}`}`,
        kind === "delete" ? "DELETE" : "POST",
      );
      if (kind === "delete") navigate("/");
      else setAgent({ ...agent, ...value, editable: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || !loaded || (!!agent && !agent.editable);
  return (
    <PlatformLayout title={id ? "编辑 Agent" : "新建 Agent"}>
      <ErrorNotice error={error} />
      {agent?.status === "published" && hasConversations && (
        <p
          role="status"
          className="mb-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-900"
        >
          此 Agent
          已发布且存在会话。修改提示词或技能后，已有会话将无法继续，使用者需要新建会话。
        </p>
      )}
      <form
        className="max-w-3xl space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onChange={() => setDirty(true)}
      >
        <fieldset disabled={disabled} className="space-y-6">
          <label className="grid gap-2 text-sm font-medium">
            名称
            <input
              className={control}
              maxLength={64}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            描述
            <textarea
              className={control}
              maxLength={1024}
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            系统提示词
            <textarea
              className={`${control} min-h-64 font-mono leading-6`}
              maxLength={32000}
              value={systemPrompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <span className="text-xs font-normal text-[#888]">
              {systemPrompt.length} / 32000 · 发布前需填写提示词
            </span>
          </label>
          <div>
            <p className="mb-3 text-sm font-medium">绑定技能</p>
            <div className="space-y-2">
              {skills.map((skill) => (
                <label
                  key={skill.id}
                  className="flex gap-3 rounded-lg border border-[#e5e5e5] bg-white p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    disabled={!skill.bindable && !skillIds.includes(skill.id)}
                    checked={skillIds.includes(skill.id)}
                    onChange={(e) =>
                      setSkillIds(
                        e.target.checked
                          ? [...skillIds, skill.id]
                          : skillIds.filter((id) => id !== skill.id),
                      )
                    }
                  />
                  <span>
                    {skill.name}
                    <small className="mt-1 block text-[#777]">
                      {skill.bindable
                        ? skill.description
                        : `不可绑定：${skill.unbindableReason}`}
                    </small>
                  </span>
                </label>
              ))}
              {!skills.length && (
                <p className="text-sm text-[#777]">
                  尚无技能，先到
                  <Link to="/skills" className="text-primary">
                    技能库上传
                  </Link>
                  。
                </p>
              )}
            </div>
          </div>
          <label className="grid gap-2 text-sm font-medium">
            默认工作目录
            <input
              className={control}
              placeholder="保存后自动生成独立工作目录"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
            />
            <small className="font-normal text-[#888]">
              留空时自动生成此 Agent
              的独立工作目录；自定义目录仅保存在当前浏览器中。
            </small>
          </label>
          <button className={primary} type="submit">
            {busy ? "处理中…" : "保存"}
          </button>
        </fieldset>
        {id && (
          <div className="flex flex-wrap items-center gap-4 border-t pt-6">
            <button
              type="button"
              disabled={disabled || dirty}
              className={control}
              onClick={() =>
                void action(
                  agent?.status === "published" ? "unpublish" : "publish",
                )
              }
            >
              {agent?.status === "published" ? "下线" : "发布"}
            </button>
            <Link className={control} to={`/agents/${id}`}>
              调试对话
            </Link>
            <button
              type="button"
              disabled={disabled}
              className={`${control} text-red-700`}
              onClick={() => void action("delete")}
            >
              删除
            </button>
            {dirty && (
              <small className="text-[#777]">请先保存后再发布或下线。</small>
            )}
          </div>
        )}
      </form>
    </PlatformLayout>
  );
}
