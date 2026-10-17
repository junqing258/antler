import { useCallback, useEffect, useState } from "react";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { useSearchParams } from "react-router";
import { ProjectDialog } from "@/components/project-dialog";
import { SchedulerDialog } from "@/components/scheduler-dialog";
import { SettingsDialog, type SettingsTab } from "@/components/settings-dialog";
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
import {
  loadCollapsedProjectIds,
  saveCollapsedProjectIds,
} from "@/lib/project-navigation";
import {
  loadProviderConfig,
  saveProviderConfig,
  type ProviderConfig,
} from "@/lib/provider-config";
import { authHeaders, serverInfo } from "@/lib/server-info";
import { createUuid } from "@/lib/utils";
import { initializeWorkspaceProjects } from "@/lib/workspace-projects";
import { Chat } from "@/views/chat/chat";

function newConversationId() {
  return createUuid();
}

export function ChatView() {
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
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    loadCollapsedProjectIds,
  );
  useEffect(() => {
    saveCollapsedProjectIds(collapsedProjectIds);
  }, [collapsedProjectIds]);
  const toggleProject = (projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };
  const [projectDialog, setProjectDialog] = useState<
    { project?: Project } | undefined
  >();
  const [providerConfig, setProviderConfig] = useState(loadProviderConfig);
  const [serverModel, setServerModel] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void serverInfo()
      .then((server) => fetch(`${server.baseUrl}/api/config/provider`, {
        headers: authHeaders(server),
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
  const [schedulerOpen, setSchedulerOpen] = useState(false);
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
      name: "默认项目",
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
          title={activeConversation?.title ?? "新会话"}
          conversations={conversations}
          projects={projects.length ? projects : [activeProject]}
          activeProject={activeProject}
          collapsedProjectIds={collapsedProjectIds}
          onToggleProject={toggleProject}
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
          onOpenScheduler={() => setSchedulerOpen(true)}
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
      {schedulerOpen && (
        <SchedulerDialog
          getServerInfo={serverInfo}
          onClose={() => setSchedulerOpen(false)}
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

