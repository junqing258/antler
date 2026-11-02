import { AgentIcon } from "@/components/agent-icon";
import { loadProviderConfig } from "@/lib/provider-config";
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
  const [icon, setIcon] = useState("Bot");
  const [iconSource, setIconSource] = useState("");
  const [iconWarning, setIconWarning] = useState("");
  const [generatingIcon, setGeneratingIcon] = useState(false);
  const [showMoreSkills, setShowMoreSkills] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setDirty(false);
    setError("");
    setAgent(undefined);
    setIcon("Bot");
    setIconSource("");
    setIconWarning("");
    setName("");
    setDescription("");
    setPrompt("");
    setSkillIds([]);
    setShowMoreSkills(false);
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
          setIcon(value.icon ?? "Bot");
          setIconSource(value.icon ? JSON.stringify([value.name, value.description]) : "");
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
  const generateIcon = async () => {
    setGeneratingIcon(true);
    setIconWarning("");
    try {
      const config = loadProviderConfig();
      const { icon: generated } = await platformApi<{ icon: string }>("/agents/icon", "POST", {
        name,
        description,
        ...(config.apiKey.trim() ? { provider: {
          protocol: config.protocol,
          model: config.model,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
        } } : {}),
      });
      if (!generated) throw new Error("模型未返回图标。");
      setIcon(generated);
      setIconSource(JSON.stringify([name, description]));
      setDirty(true);
      return generated;
    } catch {
      setIconWarning("图标生成失败，已保留当前图标。可稍后重新生成。");
      return icon;
    } finally {
      setGeneratingIcon(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const selectedIcon = iconSource === JSON.stringify([name, description]) ? icon : await generateIcon();
      const value = await platformApi<PlatformAgent>(
        id ? `/agents/${id}` : "/agents",
        id ? "PUT" : "POST",
        { name, description, systemPrompt, skillIds, icon: selectedIcon },
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
  const disabled = busy || generatingIcon || !loaded || (!!agent && !agent.editable);
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
          <div className="flex items-center gap-4">
            <div aria-label="Agent 图标" className="grid size-14 place-items-center rounded-xl bg-[#eef4ef] text-primary">
              <AgentIcon name={icon} className="size-7" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Agent 图标</p>
              <p className="text-xs text-[#777]">保存时使用已配置的模型，根据名称和描述自动选择图标。</p>
              <button type="button" className="text-sm text-primary" disabled={!name.trim()}
                onClick={() => { void generateIcon(); }}>
                {generatingIcon ? "正在生成图标…" : "重新生成图标"}
              </button>
            </div>
          </div>
          {iconWarning && <p role="status" className="text-sm text-amber-800">{iconWarning}</p>}
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">绑定技能</p>
              <button
                type="button"
                className="text-sm text-primary"
                aria-expanded={showMoreSkills}
                aria-controls="available-agent-skills"
                onClick={() => setShowMoreSkills(!showMoreSkills)}
              >
                更多
              </button>
            </div>
            <div className="space-y-2">
              {skills.filter((skill) => skillIds.includes(skill.id)).map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#e5e5e5] bg-white p-3 text-sm"
                >
                  <span>
                    {skill.name}
                    <small className="mt-1 block text-[#777]">
                      {skill.bindable ? skill.description : `不可绑定：${skill.unbindableReason}`}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-red-700"
                    aria-label={`移除 ${skill.name}`}
                    onClick={() => {
                      setSkillIds(skillIds.filter((id) => id !== skill.id));
                      setDirty(true);
                    }}
                  >
                    移除
                  </button>
                </div>
              ))}
              {!skillIds.length && (
                <p className="text-sm text-[#777]">尚未绑定技能，点击“更多”选择添加。</p>
              )}
            </div>
            {showMoreSkills && (
              <div id="available-agent-skills" className="mt-3 space-y-2 rounded-lg border border-[#e5e5e5] p-3">
                <p className="text-sm font-medium">选择添加技能</p>
                {skills.filter((skill) => !skillIds.includes(skill.id)).map((skill) => (
                  <div key={skill.id} className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 text-sm">
                    <span>
                      {skill.name}
                      <small className="mt-1 block text-[#777]">
                        {skill.bindable ? skill.description : `不可绑定：${skill.unbindableReason}`}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-primary disabled:text-[#aaa]"
                      disabled={!skill.bindable}
                      aria-label={`添加 ${skill.name}`}
                      onClick={() => {
                        setSkillIds([...skillIds, skill.id]);
                        setDirty(true);
                      }}
                    >
                      添加
                    </button>
                  </div>
                ))}
                {skills.length > 0 && skills.every((skill) => skillIds.includes(skill.id)) && (
                  <p className="text-sm text-[#777]">已添加全部技能。</p>
                )}
                {!skills.length && (
                  <p className="text-sm text-[#777]">
                    尚无技能，先到<Link to="/skills" className="text-primary">技能库上传</Link>。
                  </p>
                )}
              </div>
            )}
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
