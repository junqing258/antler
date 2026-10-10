import {
  StrictMode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { BrowserRouter, useSearchParams } from "react-router";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { AssistantThread } from "@/components/assistant-ui/thread";
import { useAntlerRuntime } from "@/components/assistant-ui/use-antler-runtime";
import {
  getModelPickerConfig,
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
  type Conversation,
  type Project,
} from "@/lib/conversation-store";
import type { ThreadMessageLike } from "@assistant-ui/react";
import {
  FolderCogIcon,
  FolderIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import "./styles.css";
import { createUuid } from "@/lib/utils";
import { ProjectDialog } from "@/components/project-dialog";
import { initializeWorkspaceProjects } from "@/lib/workspace-projects";
import { KnowledgeConfigurationLink } from "@/components/knowledge-configuration-link";
import { SettingsDialog, type SettingsTab } from "@/components/settings-dialog";

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
  serverModel,
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
  onNewThread: (projectId?: string) => void;
  onNewProject: () => void;
  onSelectProject: (project: Project) => void;
  onEditProject: (project: Project) => void;
  onSelectThread: (id: string) => void;
  onRenameThread: (conversation: Conversation) => void;
  onDeleteThread: (conversation: Conversation) => void;
  providerConfig: ProviderConfig;
  serverModel: string;
  onModelChange: (model: string) => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onConversationSaved: () => void;
}) {
  const modelPickerConfig = getModelPickerConfig(providerConfig, serverModel);
  const runtime = useAntlerRuntime(
    serverInfo,
    conversationId,
    activeProject.id,
    activeProject.workingDirectory,
    () => providerConfig,
    initialMessages,
    onConversationSaved,
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="flex h-[100svh] min-h-[560px] overflow-hidden bg-white">
        <aside className="flex w-[250px] shrink-0 flex-col bg-[#fbfbfb] px-3 pb-3.5 pl-[5px] pt-2 max-[800px]:w-[190px] max-[620px]:hidden">
          <div className="relative -mt-2 flex h-[76px] shrink-0 items-center gap-3 px-[15px] text-primary after:pointer-events-none after:absolute after:right-[-12px] after:bottom-0 after:left-[-5px] after:h-px after:bg-[#f1f5f9] after:content-['']">
            <img className="size-10 shrink-0 object-contain" src="/antler-logo.svg" width="40" height="40" alt="" />
            <div className="flex min-w-0 flex-col">
              <strong className="text-[15px] font-bold leading-normal whitespace-nowrap">Antler Agent</strong>
              <span className="font-mono text-[10px] leading-normal tracking-[0.08em]">V0.1.0</span>
            </div>
          </div>
          <button
            className="mt-[26px] flex w-full items-center gap-2 rounded-lg border-0 bg-[#f2f2f2] px-3 py-1 text-left text-sm text-[#222] hover:bg-[#eaeaea]"
            type="button"
            onClick={() => onNewThread()}
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
            New Thread
          </button>
          <KnowledgeConfigurationLink getServerInfo={serverInfo} />
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
                      className="grid size-[26px] shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eaeaea] hover:text-[#333]"
                      type="button"
                      onClick={() => onNewThread(project.id)}
                      aria-label={`New Thread in ${project.name}`}
                      title="New Thread"
                    >
                      <PlusIcon className="size-[15px]" aria-hidden="true" />
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
                  <div className="mt-[3px] grid w-full min-w-0 grid-cols-1 gap-0.5 pb-1 pl-3">
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
                        className="group flex w-full min-w-0 items-center rounded-lg px-2.5 py-px hover:bg-[#f1f1f1] has-[[aria-current=page]]:bg-[#f1f1f1]"
                        key={conversation.id}
                      >
                        <button
                          className="min-w-0 flex-1 truncate border-0 bg-transparent px-0.5 py-1 text-left text-[13px] leading-6 text-[#222]"
                          type="button"
                          title={conversation.title}
                          aria-current={
                            conversation.id === conversationId
                              ? "page"
                              : undefined
                          }
                          onClick={() => onSelectThread(conversation.id)}
                        >
                          {conversation.title}
                        </button>
                        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
            model={modelPickerConfig.model}
            models={modelPickerConfig.models}
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
  const [loadedConversation, setLoadedConversation] = useState<{
    id: string;
    messages: ThreadMessageLike[];
  } | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState(DEFAULT_PROJECT_ID);
  const [projectDialog, setProjectDialog] = useState<
    { project?: Project } | undefined
  >();
  const [providerConfig, setProviderConfig] = useState(loadProviderConfig);
  const [serverModel, setServerModel] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void serverInfo()
      .then((server) => fetch(`${server.baseUrl}/api/config/provider`, {
        headers: { "x-antler-token": server.token },
        signal: controller.signal,
      }))
      .then(async (response) => {
        if (!response.ok) return;
        const config = await response.json() as { model?: unknown };
        if (!controller.signal.aborted && typeof config.model === "string")
          setServerModel(config.model.trim());
      })
      .catch(() => {
        // Chat can still use the server defaults if config discovery fails.
      });
    return () => controller.abort();
  }, []);
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
    void initializeWorkspaceProjects(serverInfo).then((project) => {
      if (project && !cancelled) refreshLibrary();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshLibrary]);
  useEffect(() => {
    let cancelled = false;
    setLoadedConversation(null);
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
        setLoadedConversation({
          id: conversationId,
          messages: conversation?.messages ?? [],
        });
      })
      // IndexedDB can be disabled by a browser policy. Keep chat usable even
      // though persistence is unavailable in that environment.
      .catch(() => {
        if (!cancelled) setLoadedConversation({ id: conversationId, messages: [] });
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
      {/* Never seed a new runtime with messages loaded for another thread. */}
      {loadedConversation?.id === conversationId && (
        <Chat
          key={conversationId}
          conversationId={conversationId}
          initialMessages={loadedConversation.messages}
          title={activeConversation?.title ?? "New Chat"}
          conversations={conversations}
          projects={projects.length ? projects : [activeProject]}
          activeProject={activeProject}
          onNewThread={startNewThread}
          onNewProject={() => setProjectDialog({})}
          onSelectProject={selectProject}
          onEditProject={(project) => setProjectDialog({ project })}
          onSelectThread={selectThread}
          onRenameThread={renameThread}
          onDeleteThread={removeThread}
          providerConfig={providerConfig}
          serverModel={serverModel}
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
          getServerInfo={serverInfo}
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
