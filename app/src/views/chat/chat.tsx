import { useEffect, useState } from "react";
import { AssistantRuntimeProvider, type ThreadMessageLike } from "@assistant-ui/react";
import {
  ChevronRightIcon,
  FolderCogIcon,
  FolderIcon,
  FolderPlusIcon,
  MenuIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import { AssistantThread } from "@/components/assistant-ui/thread";
import { useAntlerRuntime } from "@/components/assistant-ui/use-antler-runtime";
import { KnowledgeConfigurationLink } from "@/components/knowledge-configuration-link";
import type { SettingsTab } from "@/components/settings-dialog";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import type { Conversation, Project } from "@/lib/conversation-store";
import { getModelPickerConfig, type ProviderConfig } from "@/lib/provider-config";
import { serverInfo } from "@/lib/server-info";

export function Chat({
  conversationId,
  initialMessages,
  title,
  conversations,
  projects,
  activeProject,
  collapsedProjectIds,
  onToggleProject,
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
  collapsedProjectIds: Set<string>;
  onToggleProject: (projectId: string) => void;
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

  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia?.("(width < 620px)").matches ?? false,
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.("(width < 620px)");
    if (!media) return;
    const updateLayout = () => {
      setIsMobile(media.matches);
      if (!media.matches) setNavigationOpen(false);
    };
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);
  const navigate = (action: () => void) => {
    setNavigationOpen(false);
    action();
  };
  const sidebar = (
    <>
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
        onClick={() => navigate(() => onNewThread())}
      >
        <PlusIcon className="size-3.5" aria-hidden="true" />
        新建会话
      </button>
      <KnowledgeConfigurationLink getServerInfo={serverInfo} />
      <nav
        className="mt-3.5 min-h-0 overflow-y-auto pb-2"
        aria-label="项目与会话历史"
      >
        <div className="mb-1.5 flex items-center justify-between px-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#858585]">
          <span>项目</span>
          <button className="grid size-[26px] place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eaeaea] hover:text-[#333]"
            type="button"
            onClick={() => navigate(onNewProject)}
            aria-label="新建项目"
          >
            <FolderPlusIcon className="size-[15px]" />
          </button>
        </div>
        {projects.map((project) => {
          const isCollapsed = collapsedProjectIds.has(project.id);
          const conversationsId = `project-conversations-${project.id}`;
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
                  onClick={() => navigate(() => onSelectProject(project))}
                  title={
                    project.workingDirectory ||
                    "服务端默认工作目录"
                  }
                >
                  <FolderIcon className="size-[15px] shrink-0 text-[#777]" aria-hidden="true" />
                  <span className="truncate">{project.name}</span>
                </button>
                <button
                  className="grid size-[26px] shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eaeaea] hover:text-[#333]"
                  type="button"
                  onClick={() => onToggleProject(project.id)}
                  aria-label={`${isCollapsed ? "展开" : "折叠"} ${project.name}`}
                  aria-expanded={!isCollapsed}
                  aria-controls={conversationsId}
                  title={isCollapsed ? "展开项目" : "折叠项目"}
                >
                  <ChevronRightIcon
                    className={`size-3.5 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                    aria-hidden="true"
                  />
                </button>
                <button
                  className="grid size-[26px] shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eaeaea] hover:text-[#333]"
                  type="button"
                  onClick={() => navigate(() => onNewThread(project.id))}
                  aria-label={`在 ${project.name} 中新建会话`}
                  title="新建会话"
                >
                  <PlusIcon className="size-[15px]" aria-hidden="true" />
                </button>
                <button
                  className="mr-[3px] grid size-[26px] shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777] opacity-0 max-[620px]:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[active=true]:opacity-100 hover:bg-[#eaeaea] hover:text-[#333]"
                  type="button"
                  onClick={() => navigate(() => onEditProject(project))}
                  aria-label={`${project.name} 的设置`}
                >
                  <FolderCogIcon className="size-[15px]" />
                </button>
              </div>
              <div
                id={conversationsId}
                hidden={isCollapsed}
                className={`mt-[3px] w-full min-w-0 grid-cols-1 gap-0.5 pb-1 pl-3 ${isCollapsed ? "hidden" : "grid"}`}
              >
                {projectConversations.length === 0 && (
                  <button
                    className="w-full border-0 bg-transparent px-3 py-1.5 text-left text-xs text-[#999] hover:text-[#666]"
                    type="button"
                    onClick={() => navigate(() => onSelectProject(project))}
                  >
                    开始新的会话
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
                      onClick={() => navigate(() => onSelectThread(conversation.id))}
                    >
                      {conversation.title}
                    </button>
                    <div className="flex shrink-0 gap-0.5 opacity-0 max-[620px]:opacity-100 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
          onClick={() => navigate(() => onOpenSettings("profile"))}
        >
          <span className="grid size-7 place-items-center rounded-full bg-[#e8f3ef] text-xs font-semibold text-[#087d61]">U</span>
          {/* <span className="user-details"><strong>User</strong><small>User</small></span> */}
        </button>
        <button
          className="grid size-7 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eaeaea] hover:text-[#333]"
          type="button"
          aria-label="设置中心"
          onClick={() => navigate(() => onOpenSettings())}
        >
          <SettingsIcon className="size-[15px]" />
        </button>
      </div>
    </>
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Drawer
        open={isMobile && navigationOpen}
        onOpenChange={setNavigationOpen}
      >
        <main className="flex h-dvh min-h-0 overflow-hidden bg-white">
          <DrawerContent>{sidebar}</DrawerContent>
          {!isMobile && (
            <aside className="flex w-[250px] shrink-0 flex-col bg-[#fbfbfb] px-3 pb-3.5 pl-[5px] pt-2 max-[800px]:w-[190px]">
              {sidebar}
            </aside>
          )}
          <section className="min-w-0 flex-1">
            <AssistantThread
              model={modelPickerConfig.model}
              models={modelPickerConfig.models}
              title={title}
              navigation={isMobile ? (
                <DrawerTrigger
                  className="mr-2 grid size-10 shrink-0 place-items-center rounded-lg text-[#555] hover:bg-[#f2f2f2] focus-visible:outline-2 focus-visible:outline-primary"
                  aria-label="打开导航"
                >
                  <MenuIcon className="size-5" aria-hidden="true" />
                </DrawerTrigger>
              ) : undefined}
              onModelChange={onModelChange}
            />
          </section>
        </main>
      </Drawer>
    </AssistantRuntimeProvider>
  );
}

