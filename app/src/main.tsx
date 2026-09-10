import {
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { BrowserRouter, useSearchParams } from "react-router";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { AssistantThread } from "@/components/assistant-ui/thread";
import { useAntlerRuntime } from "@/components/assistant-ui/use-antler-runtime";
import {
  defaultProviderConfig,
  loadProviderConfig,
  saveProviderConfig,
  type ProviderConfig,
} from "@/lib/provider-config";
import {
  createProject,
  DEFAULT_PROJECT_ID,
  deleteConversation,
  getConversation,
  listConversations,
  listProjects,
  renameConversation,
  updateProject,
  updateProjectKnowledgePolicy,
  type Conversation,
  type Project,
} from "@/lib/conversation-store";
import type { ThreadMessageLike } from "@assistant-ui/react";
import {
  CircleHelpIcon,
  BookOpenIcon,
  ChevronDownIcon,
  FileTextIcon,
  FolderCogIcon,
  FolderIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SettingsIcon,
  Trash2Icon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import "./styles.css";
import { createUuid } from "@/lib/utils";
import { DirectoryPicker } from "@/components/directory-picker";

type ServerInfo = { baseUrl: string; token: string };

async function serverInfo(): Promise<ServerInfo> {
  if ("__TAURI_INTERNALS__" in window) return invoke<ServerInfo>("server_info");
  return {
    // Development keeps talking to the locally started backend. A production
    // Web build uses the current origin because Fastify serves both UI and API.
    baseUrl:
      import.meta.env.VITE_ANTLER_SERVER_BASE_URL ??
      (import.meta.env.DEV ? "http://127.0.0.1:3210" : ""),
    token: import.meta.env.VITE_ANTLER_ACCESS_TOKEN ?? "",
  };
}

function newConversationId() {
  return createUuid();
}

type SettingsTab = "provider" | "profile" | "about";

type KnowledgeSourceSummary = {
  id: string;
  displayName: string;
  type: "text" | "file" | "directory";
  status: "pending" | "indexing" | "ready" | "degraded" | "failed";
  lastIndexedAt: string | null;
  errorCode: string | null;
};

type KnowledgeBaseSummary = {
  id: string;
  name: string;
  _count?: { sources: number };
  sources: KnowledgeSourceSummary[];
};

const knowledgeStatusLabel: Record<KnowledgeSourceSummary["status"], string> = {
  pending: "等待索引",
  indexing: "正在索引",
  ready: "已就绪",
  degraded: "需重新索引",
  failed: "索引失败",
};

function ProjectDialog({
  project,
  onSave,
  onClose,
}: {
  project?: Project;
  onSave: (values: { name: string; workingDirectory: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [workingDirectory, setWorkingDirectory] = useState(
    project?.workingDirectory ?? "",
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), workingDirectory: workingDirectory.trim() });
  };

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/38 p-6" role="presentation" onMouseDown={onClose}>
      <form
        className="grid w-full max-w-[520px] gap-5 rounded-[14px] border border-[#e4e4e4] bg-white p-[26px] shadow-[0_24px_70px_rgb(0_0_0_/_20%)]"
        aria-labelledby="project-dialog-title"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 className="m-0 text-xl text-[#252525]" id="project-dialog-title">
              {project ? "Project settings" : "New project"}
            </h2>
            <p className="m-0 mt-1.5 text-xs leading-6 text-[#777]">Conversations in this project use the same working directory.</p>
          </div>
          <button className="grid size-[30px] shrink-0 place-items-center rounded-[7px] border-0 bg-transparent text-[#777] hover:bg-[#f0f0f0] hover:text-[#222]" type="button" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
          Project name
          <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My project"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
          Working directory
          <DirectoryPicker
            value={workingDirectory}
            onChange={setWorkingDirectory}
            getServerInfo={serverInfo}
          />
          <small className="text-[11px] font-normal leading-6 text-[#888]">
            Choose a folder inside the server workspace, or use the server
            default.
          </small>
        </label>
        <div className="flex justify-end gap-2">
          <button className="h-9 rounded-[7px] border border-[#ddd] bg-white px-[13px] text-[13px] text-[#333] hover:bg-[#f6f6f6]" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="h-9 rounded-[7px] border border-primary bg-primary px-[13px] text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-45"
            type="submit"
            disabled={!name.trim()}
          >
            {project ? "Save" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}

function KnowledgeDialog({
  project,
  onSave,
  onClose,
}: {
  project: Project;
  onSave: (policy: "disabled" | "auto") => void;
  onClose: () => void;
}) {
  const [enabled, setEnabled] = useState(project.knowledgePolicy === "auto");
  const [bases, setBases] = useState<KnowledgeBaseSummary[]>([]);
  const [collapsedBaseIds, setCollapsedBaseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const hasLoadedBases = useRef(false);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<"text" | "file" | "directory">("text");
  const [sourceValue, setSourceValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const server = await serverInfo();
      const response = await fetch(`${server.baseUrl}/api/projects/${encodeURIComponent(project.id)}/knowledge-bases`, { headers: { "x-antler-token": server.token } });
      if (!response.ok) throw new Error("无法读取知识库列表");
      const nextBases = (await response.json()) as KnowledgeBaseSummary[];
      setBases(nextBases);
      if (!hasLoadedBases.current) {
        setCollapsedBaseIds(new Set(nextBases.map((base) => base.id)));
        hasLoadedBases.current = true;
      }
    } catch {
      setError("本地后端未连接。请先启动 Antler 服务（pnpm dev:server 或 pnpm dev）。");
    }
  }, [project.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!bases.some((base) => base.sources.some((source) => source.status === "pending" || source.status === "indexing"))) return;
    const timer = window.setInterval(() => void load(), 1_200);
    return () => window.clearInterval(timer);
  }, [bases, load]);
  const createBase = async () => {
    if (!name.trim()) return;
    setBusy(true); setError("");
    try { const server = await serverInfo(); const response = await fetch(`${server.baseUrl}/api/projects/${encodeURIComponent(project.id)}/knowledge-bases`, { method: "POST", headers: { "content-type": "application/json", "x-antler-token": server.token }, body: JSON.stringify({ name: name.trim() }) }); if (!response.ok) throw new Error("无法创建知识库"); setName(""); await load(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); } finally { setBusy(false); }
  };
  const addSource = async (baseId: string) => {
    if (!sourceValue.trim()) return;
    setBusy(true); setError("");
    try { const server = await serverInfo(); const body = sourceType === "text" ? { type: "text", text: sourceValue } : { type: sourceType, path: sourceValue }; const response = await fetch(`${server.baseUrl}/api/knowledge-bases/${baseId}/sources`, { method: "POST", headers: { "content-type": "application/json", "x-antler-token": server.token }, body: JSON.stringify(body) }); if (!response.ok) throw new Error("无法添加资料来源"); setSourceValue(""); await load(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); } finally { setBusy(false); }
  };
  const manageSource = async (sourceId: string, action: "reindex" | "delete") => {
    setBusy(true); setError("");
    try {
      const server = await serverInfo();
      const response = await fetch(
        `${server.baseUrl}/api/knowledge-sources/${sourceId}${action === "reindex" ? "/reindex" : ""}`,
        { method: action === "reindex" ? "POST" : "DELETE", headers: { "x-antler-token": server.token } },
      );
      if (!response.ok) throw new Error(action === "reindex" ? "无法重新索引资料" : "无法删除资料");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); } finally { setBusy(false); }
  };
  const toggleBase = (baseId: string) => {
    setCollapsedBaseIds((current) => {
      const next = new Set(current);
      if (next.has(baseId)) next.delete(baseId);
      else next.add(baseId);
      return next;
    });
  };
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/38 p-6" role="presentation" onMouseDown={onClose}>
      <section
        className="grid max-h-[calc(100svh-48px)] w-full max-w-[620px] gap-[18px] overflow-y-auto rounded-[14px] border border-[#e4e4e4] bg-white p-[26px] shadow-[0_24px_70px_rgb(0_0_0_/_20%)]"
        aria-labelledby="knowledge-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 className="m-0 text-xl text-[#252525]" id="knowledge-dialog-title">知识库</h2>
            <p className="m-0 mt-1.5 text-xs leading-6 text-[#777]">为 {project.name} 配置知识检索。</p>
          </div>
          <button className="grid size-[30px] shrink-0 place-items-center rounded-[7px] border-0 bg-transparent text-[#777] hover:bg-[#f0f0f0] hover:text-[#222]" type="button" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="grid gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5">
            <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
              知识库名称
              <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：项目文档" />
            </label>
            <button className="h-9 rounded-[7px] border border-primary bg-primary px-[13px] text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={() => void createBase()} disabled={busy || !name.trim()}>新建</button>
          </div>
          {bases.map((base) => (
            <div className="grid min-w-0 gap-4 rounded-[10px] border border-[#e5e7e6] bg-[#fafcfb] p-4" key={base.id}>
              <div className="flex items-center gap-2">
                <BookOpenIcon className="size-[17px] shrink-0 text-[#16876c]" aria-hidden="true" />
                <strong className="min-w-0 flex-1 truncate">{base.name}</strong>
                <small className="text-[11px] font-normal leading-6 text-[#888]">{base._count?.sources ?? 0} 个来源</small>
                <button
                  className="grid size-7 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#e8f3ef] hover:text-[#16876c]"
                  type="button"
                  aria-expanded={!collapsedBaseIds.has(base.id)}
                  aria-controls={`knowledge-base-${base.id}`}
                  aria-label={`${collapsedBaseIds.has(base.id) ? "展开" : "折叠"} ${base.name}`}
                  onClick={() => toggleBase(base.id)}
                >
                  <ChevronDownIcon className="size-4" aria-hidden="true" />
                </button>
              </div>
              {!collapsedBaseIds.has(base.id) && (
                <div id={`knowledge-base-${base.id}`} className="grid gap-4">
              {base.sources.length > 0 && (
                <div className="grid gap-1.5" aria-label={`${base.name} 的资料来源`}>
                  {base.sources.map((source) => (
                    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-[#edf0ef] bg-white p-2.5" key={source.id}>
                      {source.type === "directory" ? <FolderIcon className="size-4 shrink-0 text-[#777]" aria-hidden="true" /> : <FileTextIcon className="size-4 shrink-0 text-[#777]" aria-hidden="true" />}
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-[13px]">{source.displayName}</strong>
                        <span className="text-xs text-[#16876c]" data-status={source.status}>{knowledgeStatusLabel[source.status]}</span>
                        {source.errorCode && <small className="block text-[11px] text-[#b42318]">请检查资料路径或内容后重新索引。</small>}
                      </div>
                      <div className="flex gap-1">
                        <button className="grid size-7 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eaeaea] hover:text-[#333] disabled:cursor-not-allowed disabled:opacity-45" type="button" title="重新索引" aria-label={`重新索引 ${source.displayName}`} onClick={() => void manageSource(source.id, "reindex")} disabled={busy || source.status === "indexing"}>
                          <RefreshCwIcon className="size-3.5" aria-hidden="true" />
                        </button>
                        <button className="grid size-7 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eaeaea] hover:text-[#333] disabled:cursor-not-allowed disabled:opacity-45" type="button" title="删除资料" aria-label={`删除 ${source.displayName}`} onClick={() => void manageSource(source.id, "delete")} disabled={busy}>
                          <Trash2Icon className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid gap-2.5 rounded-lg border border-dashed border-[#dfe7e4] bg-white p-3">
                <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                  资料类型
                  <select className="h-9 rounded-lg border border-[#ddd] bg-white px-2.5 text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" value={sourceType} onChange={(e) => setSourceType(e.target.value as typeof sourceType)}>
                    <option value="text">粘贴文本</option>
                    <option value="file">文件路径</option>
                    <option value="directory">目录路径</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                  {sourceType === "text" ? "资料内容" : "工作区内路径"}
                  {sourceType === "text" ? (
                    <textarea className="w-full resize-y rounded-lg border border-[#ddd] p-2.5 text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" rows={4} value={sourceValue} onChange={(e) => setSourceValue(e.target.value)} placeholder="在此粘贴资料内容，支持多行文本" />
                  ) : (
                    <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" value={sourceValue} onChange={(e) => setSourceValue(e.target.value)} placeholder="例如：docs/architecture.md" />
                  )}
                </label>
                <button className="h-9 w-fit rounded-[7px] border border-primary bg-primary px-[13px] text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={() => void addSource(base.id)} disabled={busy || !sourceValue.trim()}>添加资料</button>
              </div>
                </div>
              )}
            </div>
          ))}
          {!bases.length && (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-[#dfe7e4] p-5 text-[#888]">
              <BookOpenIcon className="size-5" aria-hidden="true" />
              <div><strong className="block text-sm text-[#444]">还没有知识库</strong><span className="text-xs">创建一个知识库后，再添加文本、文件或目录。</span></div>
            </div>
          )}
          {error && <p className="m-0 text-xs text-[#b42318]" role="alert">{error}</p>}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>
            <strong className="block">Automatically search this project</strong>
            <small className="mt-1 block text-xs font-normal text-[#888]">
              When sources are indexed, relevant snippets will be attached to
              new chat runs.
            </small>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button className="h-9 rounded-[7px] border border-[#ddd] bg-white px-[13px] text-[13px] text-[#333] hover:bg-[#f6f6f6]" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="h-9 rounded-[7px] border border-primary bg-primary px-[13px] text-[13px] text-white"
            type="button"
            onClick={() => onSave(enabled ? "auto" : "disabled")}
          >
            Save
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsDialog({
  config,
  initialTab = "provider",
  onSave,
  onClose,
}: {
  config: ProviderConfig;
  initialTab?: SettingsTab;
  onSave: (config: ProviderConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config);
  const [newModel, setNewModel] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [displayName, setDisplayName] = useState("User");
  const update = (key: keyof ProviderConfig, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const addModel = () => {
    const model = newModel.trim();
    if (!model || draft.models.includes(model)) return;
    setDraft((current) => ({
      ...current,
      models: [...current.models, model],
      model: current.model || model,
    }));
    setNewModel("");
  };
  const removeModel = (model: string) =>
    setDraft((current) => {
      if (current.models.length === 1) return current;
      const models = current.models.filter((item) => item !== model);
      return {
        ...current,
        models,
        model: current.model === model ? models[0] : current.model,
      };
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      ...draft,
      name: draft.name.trim() || "自定义供应商",
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      models: draft.models.map((model) => model.trim()).filter(Boolean),
      model: draft.model.trim(),
    });
  };
  const tabs: { id: SettingsTab; label: string; icon: typeof SettingsIcon }[] =
    [
      { id: "provider", label: "供应商配置", icon: SettingsIcon },
      { id: "profile", label: "个人资料", icon: UserRoundIcon },
      { id: "about", label: "关于", icon: CircleHelpIcon },
    ];
  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-black/38 p-8"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="grid max-h-[calc(100svh-64px)] w-full max-w-[820px] grid-cols-[190px_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-[#e4e4e4] bg-white shadow-[0_24px_70px_rgb(0_0_0_/_20%)]"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="relative flex flex-col border-r border-[#eee] bg-[#fafafa] p-5" aria-label="设置菜单">
          <h2 className="m-0 text-lg" id="settings-title">设置</h2>
          <div
            className="mt-5 grid gap-1"
            role="tablist"
            aria-orientation="vertical"
          >
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`flex items-center gap-2 rounded-lg border-0 px-3 py-2 text-left text-[13px] ${activeTab === id ? "bg-[#e8f3ef] font-semibold text-[#087d61]" : "bg-transparent text-[#555] hover:bg-[#f0f0f0]"}`}
                onClick={() => setActiveTab(id)}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <button
            className="absolute right-4 top-4 grid size-7 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eee] hover:text-[#222]"
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
          >
            <XIcon />
          </button>
        </aside>
        <div className="min-w-0 overflow-y-auto p-7">
          {activeTab === "provider" && (
            <form
              className="grid max-w-[560px] gap-5"
              aria-labelledby="provider-title"
              onSubmit={submit}
            >
              <div className="border-b border-[#eee] pb-4">
                <div>
                  <h3 className="m-0 text-lg" id="provider-title">供应商配置</h3>
                  <p className="m-0 mt-1 text-xs text-[#777]">配置仅保存在当前浏览器的本地存储中。</p>
                </div>
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                名称
                <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  value={draft.name}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder="例如：OpenAI"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                协议
                <select className="h-10 w-full rounded-lg border border-[#ddd] bg-white px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  value={draft.protocol}
                  onChange={(event) => update("protocol", event.target.value)}
                >
                  <option value="openai-responses">OpenAI Responses</option>
                  <option value="anthropic-messages">Anthropic Messages</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                Base URL（可选）
                <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  type="url"
                  value={draft.baseUrl}
                  onChange={(event) => update("baseUrl", event.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                API Key
                <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => update("apiKey", event.target.value)}
                  placeholder="仅保存在本地"
                  autoComplete="off"
                />
              </label>
              <div className="grid gap-2 text-xs font-semibold text-[#4b4b4b]">
                <span>模型</span>
                <div className="grid gap-1.5">
                  {draft.models.map((model) => (
                    <div key={model} className="flex items-center justify-between rounded-lg border border-[#eee] px-3 py-2">
                      <label className="flex items-center gap-2 font-normal">
                        <input
                          type="radio"
                          name="default-model"
                          checked={draft.model === model}
                          onChange={() => update("model", model)}
                        />
                        <span>{model}</span>
                      </label>
                      <button
                        className="border-0 bg-transparent text-xs text-[#b42318] disabled:opacity-40"
                        type="button"
                        onClick={() => removeModel(model)}
                        disabled={draft.models.length === 1}
                        aria-label={`删除 ${model}`}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input className="h-9 min-w-0 flex-1 rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                    value={newModel}
                    onChange={(event) => setNewModel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addModel();
                      }
                    }}
                    placeholder="输入模型 ID，例如 gpt-4.1-mini"
                  />
                  <button className="h-9 rounded-[7px] border border-[#ddd] bg-white px-3 text-[13px] text-[#333] hover:bg-[#f6f6f6]" type="button" onClick={addModel}>
                    添加模型
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-[#eee] pt-4">
                <button className="h-9 rounded-[7px] border border-[#ddd] bg-white px-[13px] text-[13px] text-[#333] hover:bg-[#f6f6f6]"
                  type="button"
                  onClick={() => setDraft(defaultProviderConfig)}
                >
                  恢复默认
                </button>
                <button className="h-9 rounded-[7px] border border-primary bg-primary px-[13px] text-[13px] text-white" type="submit">
                  保存配置
                </button>
              </div>
            </form>
          )}
          {activeTab === "profile" && (
            <section className="grid max-w-[560px] gap-5" aria-labelledby="profile-title">
              <div className="border-b border-[#eee] pb-4">
                <div>
                  <h3 className="m-0 text-lg" id="profile-title">个人资料</h3>
                  <p className="m-0 mt-1 text-xs text-[#777]">管理此设备上的个人信息。</p>
                </div>
              </div>
              <div className="grid size-16 place-items-center rounded-full bg-[#e8f3ef] text-xl font-semibold text-[#087d61]">
                {displayName.slice(0, 1).toUpperCase() || "U"}
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                显示名称
                <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="输入你的名称"
                />
              </label>
              <p className="m-0 text-xs text-[#777]">
                个人资料当前仅保存在本次应用会话中。
              </p>
            </section>
          )}
          {activeTab === "about" && (
            <section
              className="grid max-w-[560px] gap-5"
              aria-labelledby="about-title"
            >
              <div className="border-b border-[#eee] pb-4">
                <div>
                  <h3 className="m-0 text-lg" id="about-title">关于</h3>
                  <p className="m-0 mt-1 text-xs text-[#777]">Antler 桌面助手</p>
                </div>
              </div>
              <div className="grid size-20 place-items-center rounded-2xl bg-[#f5f5f5]">
                <img className="size-14 rounded-full" src="/favicon.png" alt="Antler" />
              </div>
              <dl>
                <div>
                  <dt>应用名称</dt>
                  <dd>Antler</dd>
                </div>
                <div>
                  <dt>当前版本</dt>
                  <dd>v0.1.0</dd>
                </div>
                <div>
                  <dt>运行环境</dt>
                  <dd>本地桌面应用</dd>
                </div>
              </dl>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function Chat({
  conversationId,
  initialMessages,
  title,
  conversations,
  projects,
  activeProject,
  onNewThread,
  onNewProject,
  onSelectProject,
  onEditProject,
  onSelectThread,
  onRenameThread,
  onDeleteThread,
  providerConfig,
  onModelChange,
  onOpenSettings,
  onOpenKnowledge,
  onConversationSaved,
}: {
  conversationId: string;
  initialMessages: ThreadMessageLike[];
  title: string;
  conversations: Conversation[];
  projects: Project[];
  activeProject: Project;
  onNewThread: () => void;
  onNewProject: () => void;
  onSelectProject: (project: Project) => void;
  onEditProject: (project: Project) => void;
  onSelectThread: (id: string) => void;
  onRenameThread: (conversation: Conversation) => void;
  onDeleteThread: (conversation: Conversation) => void;
  providerConfig: ProviderConfig;
  onModelChange: (model: string) => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onOpenKnowledge: () => void;
  onConversationSaved: () => void;
}) {
  const runtime = useAntlerRuntime(
    serverInfo,
    conversationId,
    activeProject.id,
    activeProject.knowledgePolicy ?? "disabled",
    activeProject.workingDirectory,
    () => providerConfig,
    initialMessages,
    onConversationSaved,
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="flex h-[100svh] min-h-[560px] overflow-hidden bg-white">
        <aside className="flex w-[250px] shrink-0 flex-col bg-[#fbfbfb] px-3 pb-3.5 pl-[5px] pt-2 max-[800px]:w-[190px] max-[620px]:hidden">
          <div className="flex items-center gap-1.5 px-1 text-sm font-semibold tracking-[-0.4px] text-[#191919]">
            <img className="size-[30px] rounded-full object-contain" src="/favicon.png" alt="" />
            <span>Antler</span>
          </div>
          <button
            className="mt-[26px] flex w-full items-center gap-2 rounded-full border-0 bg-[#f2f2f2] px-3 py-1 text-left text-sm text-[#222] hover:bg-[#eaeaea]"
            type="button"
            onClick={onNewThread}
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
            New Thread
          </button>
          <button
            className="mt-1.5 flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-[13px] text-[#4b4b4b] hover:bg-[#f0f0f0] hover:text-[#222]"
            type="button"
            onClick={onOpenKnowledge}
          >
            <BookOpenIcon className="size-[15px]" aria-hidden="true" />
            <span>知识库</span>
            <small className="ml-auto text-[11px] text-[#888]">
              {activeProject.knowledgePolicy === "auto" ? "Auto" : "Off"}
            </small>
          </button>
          <nav
            className="mt-3.5 min-h-0 overflow-y-auto pb-2"
            aria-label="Projects and chat history"
          >
            <div className="mb-1.5 flex items-center justify-between px-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#858585]">
              <span>Projects</span>
              <button className="grid size-[26px] place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eaeaea] hover:text-[#333]"
                type="button"
                onClick={onNewProject}
                aria-label="New project"
              >
                <FolderPlusIcon className="size-[15px]" />
              </button>
            </div>
            {projects.map((project) => {
              const projectConversations = conversations.filter(
                (conversation) => conversation.projectId === project.id,
              );
              return (
                <section className="mb-2 last:mb-0" key={project.id}>
                  <div
                    className="group flex min-w-0 items-center rounded-lg hover:bg-[#f0f0f0] data-[active=true]:bg-[#f0f0f0]"
                    data-active={project.id === activeProject.id || undefined}
                  >
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-semibold text-[#333]"
                      type="button"
                      onClick={() => onSelectProject(project)}
                      title={
                        project.workingDirectory ||
                        "Server default working directory"
                      }
                    >
                      <FolderIcon className="size-[15px] shrink-0 text-[#777]" aria-hidden="true" />
                      <span className="truncate">{project.name}</span>
                    </button>
                    <button
                      className="mr-[3px] grid size-[26px] shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[active=true]:opacity-100 hover:bg-[#eaeaea] hover:text-[#333]"
                      type="button"
                      onClick={() => onEditProject(project)}
                      aria-label={`Settings for ${project.name}`}
                    >
                      <FolderCogIcon className="size-[15px]" />
                    </button>
                  </div>
                  <div className="mt-[3px] grid gap-0.5 pb-1 pl-3">
                    {projectConversations.length === 0 && (
                      <button
                        className="w-full border-0 bg-transparent px-3 py-1.5 text-left text-xs text-[#999] hover:text-[#666]"
                        type="button"
                        onClick={() => onSelectProject(project)}
                      >
                        Start a thread
                      </button>
                    )}
                    {projectConversations.map((conversation) => (
                      <div
                        className="group flex items-center rounded-full px-2.5 py-px hover:bg-[#f1f1f1] has-[[aria-current=page]]:bg-[#f1f1f1]"
                        key={conversation.id}
                      >
                        <button
                          className="min-w-0 flex-1 overflow-hidden border-0 bg-transparent px-0.5 py-1 text-left text-sm leading-6 text-[#222] text-ellipsis whitespace-nowrap"
                          type="button"
                          aria-current={
                            conversation.id === conversationId
                              ? "page"
                              : undefined
                          }
                          onClick={() => onSelectThread(conversation.id)}
                        >
                          {conversation.title}
                        </button>
                        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <button
                            className="grid size-[26px] place-items-center rounded border-0 bg-transparent text-[#777] hover:bg-[#ddd] hover:text-[#333]"
                            type="button"
                            aria-label={`重命名 ${conversation.title}`}
                            onClick={() => onRenameThread(conversation)}
                          >
                            <PencilIcon className="size-3.5" />
                          </button>
                          <button
                            className="grid size-[26px] place-items-center rounded border-0 bg-transparent text-[#777] hover:bg-[#ddd] hover:text-[#333]"
                            type="button"
                            aria-label={`删除 ${conversation.title}`}
                            onClick={() => onDeleteThread(conversation)}
                          >
                            <Trash2Icon className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </nav>
          <div className="mt-auto flex items-center justify-between px-1 pt-1.5">
            <button
              className="flex items-center gap-2 rounded-md border-0 bg-transparent p-1 text-left text-[#252525] hover:bg-[#eee]"
              type="button"
              aria-label="个人资料"
              onClick={() => onOpenSettings("profile")}
            >
              <span className="grid size-7 place-items-center rounded-full bg-[#e8f3ef] text-xs font-semibold text-[#087d61]">U</span>
              {/* <span className="user-details"><strong>User</strong><small>User</small></span> */}
            </button>
            <button
              className="grid size-7 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eaeaea] hover:text-[#333]"
              type="button"
              aria-label="设置中心"
              onClick={() => onOpenSettings()}
            >
              <SettingsIcon className="size-[15px]" />
            </button>
          </div>
        </aside>
        <section className="min-w-0 flex-1">
          <AssistantThread
            model={providerConfig.model}
            models={providerConfig.models}
            title={title}
            onModelChange={onModelChange}
          />
        </section>
      </main>
    </AssistantRuntimeProvider>
  );
}

function App() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversationId, setConversationId] = useState(
    () => searchParams.get("conversationId") ?? newConversationId(),
  );
  const [initialMessages, setInitialMessages] = useState<
    ThreadMessageLike[] | null
  >(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState(DEFAULT_PROJECT_ID);
  const [projectDialog, setProjectDialog] = useState<
    { project?: Project } | undefined
  >();
  const [knowledgeProject, setKnowledgeProject] = useState<Project>();
  const [providerConfig, setProviderConfig] = useState(loadProviderConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("provider");
  const refreshLibrary = useCallback(() => {
    void Promise.all([listProjects(), listConversations()])
      .then(([nextProjects, nextConversations]) => {
        setProjects(nextProjects);
        setConversations(nextConversations);
      })
      .catch(() => {
        setProjects([]);
        setConversations([]);
      });
  }, []);
  useEffect(() => {
    let cancelled = false;
    setInitialMessages(null);
    void getConversation(conversationId)
      .then(async (conversation) => {
        const [nextProjects, nextConversations] = await Promise.all([
          listProjects(),
          listConversations(),
        ]);
        if (cancelled) return;
        if (conversation) setActiveProjectId(conversation.projectId);
        setProjects(nextProjects);
        setConversations(nextConversations);
        setInitialMessages(conversation?.messages ?? []);
      })
      // IndexedDB can be disabled by a browser policy. Keep chat usable even
      // though persistence is unavailable in that environment.
      .catch(() => {
        if (!cancelled) setInitialMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);
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
  const startNewThread = (projectId = activeProjectId) => {
    const id = newConversationId();
    setActiveProjectId(projectId);
    setSearchParams({ conversationId: id });
    setConversationId(id);
  };
  const selectThread = (id: string) => {
    if (id === conversationId) return;
    const conversation = conversations.find((candidate) => candidate.id === id);
    if (conversation) setActiveProjectId(conversation.projectId);
    setSearchParams({ conversationId: id });
    setConversationId(id);
  };
  const selectProject = (project: Project) => {
    const latest = conversations.find(
      (conversation) => conversation.projectId === project.id,
    );
    if (latest) selectThread(latest.id);
    else startNewThread(project.id);
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
        startNewThread(conversation.projectId);
    });
  };
  const saveProject = (values: { name: string; workingDirectory: string }) => {
    const editedProject = projectDialog?.project;
    const operation = editedProject
      ? updateProject(editedProject.id, values)
      : createProject(values.name, values.workingDirectory);
    void operation.then((project) => {
      setProjectDialog(undefined);
      setActiveProjectId(project.id);
      refreshLibrary();
      if (!editedProject) startNewThread(project.id);
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
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ??
    ({
      id: DEFAULT_PROJECT_ID,
      name: "General",
      workingDirectory: "",
      createdAt: 0,
      updatedAt: 0,
    } satisfies Project);
  return (
    <>
      {initialMessages && (
        <Chat
          key={conversationId}
          conversationId={conversationId}
          initialMessages={initialMessages}
          title={activeConversation?.title ?? "New Chat"}
          conversations={conversations}
          projects={projects.length ? projects : [activeProject]}
          activeProject={activeProject}
          onNewThread={() => startNewThread()}
          onNewProject={() => setProjectDialog({})}
          onSelectProject={selectProject}
          onEditProject={(project) => setProjectDialog({ project })}
          onSelectThread={selectThread}
          onRenameThread={renameThread}
          onDeleteThread={removeThread}
          providerConfig={providerConfig}
          onModelChange={selectModel}
          onOpenSettings={openSettings}
          onOpenKnowledge={() => setKnowledgeProject(activeProject)}
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
      {projectDialog && (
        <ProjectDialog
          project={projectDialog.project}
          onSave={saveProject}
          onClose={() => setProjectDialog(undefined)}
        />
      )}
      {knowledgeProject && (
        <KnowledgeDialog
          project={knowledgeProject}
          onSave={(policy) => {
            void updateProjectKnowledgePolicy(knowledgeProject.id, policy).then(
              () => {
                setKnowledgeProject(undefined);
                refreshLibrary();
              },
            );
          }}
          onClose={() => setKnowledgeProject(undefined)}
        />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
