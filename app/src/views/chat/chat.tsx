import { Link } from "react-router";
import { useEffect, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type { ChatMessage } from "@antler/chat-core";
import type { BoundCredential } from "@antler/client-runtime";
import {
  CalendarClockIcon,
  MenuIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import { AssistantThread } from "@/components/assistant-ui/thread";
import { useAntlerRuntime } from "@/components/assistant-ui/use-antler-runtime";
import { KnowledgeConfigurationLink } from "@/components/knowledge-configuration-link";
import { currentUserProfile } from "@/lib/auth";
import type { SettingsTab } from "@/components/settings-dialog";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import type { Conversation } from "@/lib/conversation-store";
import {
  getModelPickerConfig,
  type ProviderConfig,
} from "@/lib/provider-config";
import { serverInfo } from "@/lib/server-info";

export function Chat({
  agentId,
  conversationId,
  initialMessages,
  title,
  conversations,
  workingDirectory,
  onNewThread,
  onLoadMore,
  onSelectThread,
  onRenameThread,
  onDeleteThread,
  providerConfig,
  serverModel,
  onModelChange,
  onOpenSettings,
  onOpenScheduler,
  onConversationSaved,
}: {
  agentId: string;
  conversationId: string;
  initialMessages: ChatMessage[];
  title: string;
  conversations: Conversation[];
  workingDirectory: string;
  onLoadMore?: () => void;
  onNewThread: () => void;
  onSelectThread: (id: string) => void;
  onRenameThread: (conversation: Conversation) => void;
  onDeleteThread: (conversation: Conversation) => void;
  providerConfig: ProviderConfig;
  serverModel: string;
  onModelChange: (model: string) => void;
  onOpenSettings: (tab?: SettingsTab, credentialBinding?: BoundCredential) => void;
  onOpenScheduler: () => void;
  onConversationSaved: () => void;
}) {
  const { runtime, notice, credentialNotice, boundCredential, hasMore, loadEarlier, boundModel } = useAntlerRuntime(
    serverInfo,
    conversationId,
    workingDirectory,
    () => providerConfig,
    initialMessages,
    onConversationSaved,
    agentId,
  );

  const modelPickerConfig = getModelPickerConfig(providerConfig, serverModel, boundModel);
  const selectModel = (model: string) => {
    if (model === modelPickerConfig.model || !providerConfig.models.includes(model)) return;
    onModelChange(model);
    if (boundModel) onNewThread();
  };

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
  const [user, setUser] = useState<{ email: string; initial: string }>();
  useEffect(() => {
    void currentUserProfile().then((profile) => {
      if (profile) setUser(profile);
    });
  }, []);
  const navigate = (action: () => void) => {
    setNavigationOpen(false);
    action();
  };
  const sidebar = (
    <>
      <Link to="/" aria-label="返回首页" onClick={() => setNavigationOpen(false)} className="relative -mt-2 flex h-[76px] shrink-0 items-center gap-3 px-[15px] text-primary after:pointer-events-none after:absolute after:right-[-12px] after:bottom-0 after:left-[-5px] after:h-px after:bg-[#f1f5f9] after:content-['']">
        <img
          className="size-10 shrink-0 object-contain"
          src="/antler-logo.svg"
          width="40"
          height="40"
          alt=""
        />
        <div className="flex min-w-0 flex-col">
          <strong className="text-[15px] font-bold leading-normal whitespace-nowrap">
            Antler Agent
          </strong>
          <span className="font-mono text-[10px] leading-normal tracking-[0.08em]">
            V0.1.0
          </span>
        </div>
      </Link>
      <button
        className="mt-[26px] flex w-full items-center gap-2 rounded-lg border-0 bg-[#f2f2f2] px-3 py-1 text-left text-sm text-[#222] hover:bg-[#eaeaea]"
        type="button"
        onClick={() => navigate(() => onNewThread())}
      >
        <PlusIcon className="size-3.5" aria-hidden="true" />
        新建会话
      </button>
      <KnowledgeConfigurationLink getServerInfo={serverInfo} />
      <button
        className="mt-1.5 flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-[13px] text-[#4b4b4b] hover:bg-[#f0f0f0] hover:text-[#222]"
        type="button"
        onClick={() => navigate(onOpenScheduler)}
      >
        <CalendarClockIcon
          className="size-[15px] shrink-0"
          aria-hidden="true"
        />
        定时任务
      </button>
      <nav
        className="mt-3.5 min-h-0 overflow-y-auto pb-2"
        aria-label="会话历史"
      >
        <p className="px-3 py-1.5 text-xs text-[#858585]">会话历史</p>
        {conversations.length === 0 && (
          <p className="px-3 py-1.5 text-xs text-[#999]">暂无会话</p>
        )}
        {onLoadMore && <button onClick={onLoadMore}>加载更多会话</button>}
        <div className="grid min-w-0 grid-cols-1 gap-0.5">
          {conversations.map((conversation) => (
            <div
              className="group flex w-full min-w-0 items-center rounded-lg px-2.5 py-px hover:bg-[#f1f1f1] has-[[aria-current=page]]:bg-[#f1f1f1]"
              key={conversation.id}
            >
              <button
                className="min-w-0 flex-1 truncate border-0 bg-transparent px-0.5 py-1 text-left text-[13px] leading-6 text-[#222]"
                type="button"
                title={conversation.title}
                aria-current={
                  conversation.id === conversationId ? "page" : undefined
                }
                onClick={() =>
                  navigate(() => onSelectThread(conversation.id))
                }
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
      </nav>
      <div className="mt-auto flex items-center justify-between px-1 pt-1.5">
        <button
          className="flex items-center gap-2 rounded-md border-0 bg-transparent p-1 text-left text-[#252525] hover:bg-[#eee]"
          type="button"
          aria-label="个人资料"
          onClick={() => navigate(() => onOpenSettings("profile"))}
        >
          <span className="grid size-7 place-items-center rounded-full bg-[#e8f3ef] text-xs font-semibold text-[#087d61]">
            {user?.initial ?? "U"}
          </span>
          {user && (
            <span className="flex min-w-0 flex-col leading-tight">
              <strong className="truncate text-[13px] font-semibold">
                {user.email.split("@")[0]}
              </strong>
              <small className="truncate text-[10px] text-[#777]">
                {user.email}
              </small>
            </span>
          )}
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
          <section className="relative flex min-w-0 flex-1 flex-col">
            {notice && (
              <p
                role="status"
                className="pointer-events-none absolute inset-x-0 top-2 z-10 mx-auto w-fit rounded-full border border-amber-200 bg-amber-50 px-3.5 py-1 text-[13px] text-amber-800 shadow-sm"
              >
                {notice}
              </p>
            )}
            {credentialNotice && (
              <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                <span>{credentialNotice}</span>
                <button type="button" className="underline underline-offset-2" onClick={() => onOpenSettings("provider", boundCredential)}>配置凭据</button>
              </div>
            )}
            {hasMore && (
              <button
                type="button"
                className="mx-auto my-1 shrink-0 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                onClick={() => void loadEarlier()}
              >
                加载更早消息
              </button>
            )}
            <div className="min-h-0 flex-1">
            <AssistantThread
              model={modelPickerConfig.model}
              models={modelPickerConfig.models}
              modelChangeStartsNewThread={Boolean(boundModel)}
              title={title}
              navigation={
                isMobile ? (
                  <DrawerTrigger
                    className="mr-2 grid size-10 shrink-0 place-items-center rounded-lg text-[#555] hover:bg-[#f2f2f2] focus-visible:outline-2 focus-visible:outline-primary"
                    aria-label="打开导航"
                  >
                    <MenuIcon className="size-5" aria-hidden="true" />
                  </DrawerTrigger>
                ) : undefined
              }
              onModelChange={selectModel}
            />
            </div>
          </section>
        </main>
      </Drawer>
    </AssistantRuntimeProvider>
  );
}
