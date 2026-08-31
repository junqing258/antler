import {
  StrictMode,
  useCallback,
  useEffect,
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
  ensureConversation,
  listConversations,
  listProjects,
  renameConversation,
  updateProject,
  type Conversation,
  type Project,
} from "@/lib/conversation-store";
import type { ThreadMessageLike } from "@assistant-ui/react";
import {
  CircleHelpIcon,
  FolderCogIcon,
  FolderIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import "./styles.css";
import { createUuid } from "@/lib/utils";

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
    <div className="project-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="project-dialog"
        aria-labelledby="project-dialog-title"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="project-dialog-heading">
          <div>
            <h2 id="project-dialog-title">
              {project ? "Project settings" : "New project"}
            </h2>
            <p>Conversations in this project use the same working directory.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <label>
          Project name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My project"
          />
        </label>
        <label>
          Working directory
          <input
            value={workingDirectory}
            onChange={(event) => setWorkingDirectory(event.target.value)}
            placeholder="/absolute/path/to/project"
            spellCheck={false}
          />
          <small>
            Leave empty to use the server default. The directory must already exist.
          </small>
        </label>
        <div className="project-dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="project-dialog-save" type="submit" disabled={!name.trim()}>
            {project ? "Save" : "Create project"}
          </button>
        </div>
      </form>
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
      className="settings-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="settings-dialog"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="settings-nav" aria-label="设置菜单">
          <h2 id="settings-title">设置</h2>
          <div
            className="settings-tabs"
            role="tablist"
            aria-orientation="vertical"
          >
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={activeTab === id ? "is-active" : ""}
                onClick={() => setActiveTab(id)}
              >
                <Icon aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <button
            className="settings-close"
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
          >
            <XIcon />
          </button>
        </aside>
        <div className="settings-content">
          {activeTab === "provider" && (
            <form
              className="settings-form"
              aria-labelledby="provider-title"
              onSubmit={submit}
            >
              <div className="settings-heading">
                <div>
                  <h3 id="provider-title">供应商配置</h3>
                  <p>配置仅保存在当前浏览器的本地存储中。</p>
                </div>
              </div>
              <label>
                名称
                <input
                  value={draft.name}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder="例如：OpenAI"
                />
              </label>
              <label>
                协议
                <select
                  value={draft.protocol}
                  onChange={(event) => update("protocol", event.target.value)}
                >
                  <option value="openai-responses">OpenAI Responses</option>
                  <option value="anthropic-messages">Anthropic Messages</option>
                </select>
              </label>
              <label>
                Base URL（可选）
                <input
                  type="url"
                  value={draft.baseUrl}
                  onChange={(event) => update("baseUrl", event.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => update("apiKey", event.target.value)}
                  placeholder="仅保存在本地"
                  autoComplete="off"
                />
              </label>
              <div className="provider-models">
                <span>模型</span>
                <div className="provider-model-list">
                  {draft.models.map((model) => (
                    <div key={model} className="provider-model-row">
                      <label>
                        <input
                          type="radio"
                          name="default-model"
                          checked={draft.model === model}
                          onChange={() => update("model", model)}
                        />
                        <span>{model}</span>
                      </label>
                      <button
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
                <div className="provider-model-add">
                  <input
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
                  <button type="button" onClick={addModel}>
                    添加模型
                  </button>
                </div>
              </div>
              <div className="settings-actions">
                <button
                  type="button"
                  onClick={() => setDraft(defaultProviderConfig)}
                >
                  恢复默认
                </button>
                <button className="settings-save" type="submit">
                  保存配置
                </button>
              </div>
            </form>
          )}
          {activeTab === "profile" && (
            <section className="settings-panel" aria-labelledby="profile-title">
              <div className="settings-heading">
                <div>
                  <h3 id="profile-title">个人资料</h3>
                  <p>管理此设备上的个人信息。</p>
                </div>
              </div>
              <div className="profile-avatar">
                {displayName.slice(0, 1).toUpperCase() || "U"}
              </div>
              <label>
                显示名称
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="输入你的名称"
                />
              </label>
              <p className="settings-note">
                个人资料当前仅保存在本次应用会话中。
              </p>
            </section>
          )}
          {activeTab === "about" && (
            <section
              className="settings-panel about-panel"
              aria-labelledby="about-title"
            >
              <div className="settings-heading">
                <div>
                  <h3 id="about-title">关于</h3>
                  <p>Antler 桌面助手</p>
                </div>
              </div>
              <div className="about-logo">
                <img src="/favicon.png" alt="Antler" />
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
  onConversationSaved: () => void;
}) {
  const runtime = useAntlerRuntime(
    serverInfo,
    conversationId,
    activeProject.workingDirectory,
    () => providerConfig,
    initialMessages,
    onConversationSaved,
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="app-shell">
        <aside className="app-sidebar">
          <div className="brand">
            <img className="brand-logo" src="/favicon.png" alt="" />
            <span>Antler</span>
          </div>
          <button className="new-thread !rounded-full" type="button" onClick={onNewThread}>
            <PlusIcon aria-hidden="true" />
            New Thread
          </button>
          <nav className="project-history" aria-label="Projects and chat history">
            <div className="project-history-title">
              <span>Projects</span>
              <button type="button" onClick={onNewProject} aria-label="New project">
                <FolderPlusIcon />
              </button>
            </div>
            {projects.map((project) => {
              const projectConversations = conversations.filter(
                (conversation) => conversation.projectId === project.id,
              );
              return (
                <section className="project-group" key={project.id}>
                  <div
                    className="project-group-heading"
                    data-active={project.id === activeProject.id || undefined}
                  >
                    <button
                      className="project-select"
                      type="button"
                      onClick={() => onSelectProject(project)}
                      title={project.workingDirectory || "Server default working directory"}
                    >
                      <FolderIcon aria-hidden="true" />
                      <span>{project.name}</span>
                    </button>
                    <button
                      className="project-settings"
                      type="button"
                      onClick={() => onEditProject(project)}
                      aria-label={`Settings for ${project.name}`}
                    >
                      <FolderCogIcon />
                    </button>
                  </div>
                  <div className="project-threads">
                    {projectConversations.length === 0 && (
                      <button
                        className="project-empty"
                        type="button"
                        onClick={() => onSelectProject(project)}
                      >
                        Start a thread
                      </button>
                    )}
                    {projectConversations.map((conversation) => (
                      <div className="thread-history-item" key={conversation.id}>
                        <button
                          className="thread-history-select"
                          type="button"
                          aria-current={
                            conversation.id === conversationId ? "page" : undefined
                          }
                          onClick={() => onSelectThread(conversation.id)}
                        >
                          {conversation.title}
                        </button>
                        <div className="thread-history-actions">
                          <button
                            type="button"
                            aria-label={`重命名 ${conversation.title}`}
                            onClick={() => onRenameThread(conversation)}
                          >
                            <PencilIcon />
                          </button>
                          <button
                            type="button"
                            aria-label={`删除 ${conversation.title}`}
                            onClick={() => onDeleteThread(conversation)}
                          >
                            <Trash2Icon />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </nav>
          <div className="sidebar-footer">
            <button
              className="user-center"
              type="button"
              aria-label="个人资料"
              onClick={() => onOpenSettings("profile")}
            >
              <span className="user-avatar">U</span>
              {/* <span className="user-details"><strong>User</strong><small>User</small></span> */}
            </button>
            <button
              className="settings-center"
              type="button"
              aria-label="设置中心"
              onClick={() => onOpenSettings()}
            >
              <SettingsIcon />
            </button>
          </div>
        </aside>
        <section className="chat-panel">
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
    void ensureConversation(conversationId, activeProjectId)
      .then(async (conversation) => {
        const [nextProjects, nextConversations] = await Promise.all([
          listProjects(),
          listConversations(),
        ]);
        if (cancelled) return;
        setActiveProjectId(conversation.projectId);
        setProjects(nextProjects);
        setConversations(nextConversations);
        setInitialMessages(conversation.messages);
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
      if (conversation.id === conversationId) startNewThread(conversation.projectId);
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
    if (model === providerConfig.model || !providerConfig.models.includes(model))
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
