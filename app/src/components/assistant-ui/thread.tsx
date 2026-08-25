import { ActionBarPrimitive, AuiIf, ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import { ArrowDownIcon, ArrowUpIcon, BarChart3Icon, BotIcon, BracesIcon, LightbulbIcon, MicIcon, PanelsTopLeftIcon, PenLineIcon, PlusIcon, ShareIcon, CloudSunIcon, ChevronDownIcon, CopyIcon, RefreshCwIcon, SquareIcon } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import type { ReactNode } from 'react';

function MarkdownText() {
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="aui-md prose prose-sm max-w-none text-foreground" />;
}

function AssistantMessage() {
  return <MessagePrimitive.Root className="aui-assistant-message group relative mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
    <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
    <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="aui-action-bar mt-2 flex items-center gap-1 text-muted-foreground">
      <ActionBarPrimitive.Copy aria-label="复制回复" className="rounded-md p-1.5 hover:bg-muted hover:text-foreground"><CopyIcon className="size-3.5" /></ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload aria-label="重新生成" className="rounded-md p-1.5 hover:bg-muted hover:text-foreground"><RefreshCwIcon className="size-3.5" /></ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  </MessagePrimitive.Root>;
}

function UserMessage() {
  return <MessagePrimitive.Root className="aui-user-message mx-auto w-full max-w-3xl px-4 py-4 md:px-6">
    <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm leading-6 text-foreground"><MessagePrimitive.Parts components={{ Text: MarkdownText }} /></div>
  </MessagePrimitive.Root>;
}

function Composer() {
  return <ComposerPrimitive.Root className="aui-composer mx-auto w-full max-w-[702px] rounded-[23px] border border-[#e8e8e8] bg-background px-4 pt-3 pb-2 shadow-[0_1px_2px_rgba(0,0,0,.02)] focus-within:border-[#dadada]">
    <ComposerPrimitive.Input aria-label="消息" className="block min-h-[37px] max-h-24 w-full resize-none bg-transparent py-0 text-[14px] leading-5 outline-none placeholder:text-[#afafaf]" placeholder="Send a message... (@ to mention, / for commands)" />
    <div className="mt-1 flex items-center justify-between gap-2">
      <div className="flex items-center gap-4">
        <button className="composer-icon-button" aria-label="添加附件" type="button"><PlusIcon /></button>
        <button className="model-picker" type="button"><BotIcon /><span>GPT-5.6 Luna</span><ChevronDownIcon /></button>
      </div>
      <div className="flex items-center gap-3">
        <button className="composer-icon-button text-[#888]" aria-label="语音输入" type="button"><MicIcon /></button>
        <AuiIf condition={(s) => s.thread.isRunning}><ComposerPrimitive.Cancel aria-label="停止生成" className="grid size-7 place-items-center rounded-full bg-[#242424] text-background hover:opacity-90"><SquareIcon className="size-2.5 fill-current" /></ComposerPrimitive.Cancel></AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}><ComposerPrimitive.Send aria-label="发送消息" className="grid size-7 place-items-center rounded-full bg-[#939393] text-background hover:bg-[#777] disabled:cursor-not-allowed disabled:opacity-100"><ArrowUpIcon className="size-4" /></ComposerPrimitive.Send></AuiIf>
      </div>
    </div>
  </ComposerPrimitive.Root>;
}

function Welcome() {
  return <div className="aui-welcome flex min-h-[calc(100svh-47px)] flex-col items-center justify-center px-4 text-center">
    <p className="m-0 text-[24px] font-semibold tracking-[-1px] text-foreground">How can I help you today?</p>
    <div className="mt-6 w-full"><Composer /></div>
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      <Suggestion icon={<CloudSunIcon />} label="Weather" />
      <Suggestion icon={<BracesIcon />} label="Code" />
      <Suggestion icon={<PenLineIcon />} label="Write" />
      <Suggestion icon={<BarChart3Icon />} label="Analyze" />
      <Suggestion icon={<LightbulbIcon />} label="Brainstorm" />
    </div>
  </div>;
}

function Suggestion({ icon, label }: { icon: ReactNode; label: string }) {
  return <button className="suggestion-chip" type="button">{icon}<span>{label}</span></button>;
}

export function AssistantThread() {
  return <ThreadPrimitive.Root className="aui-thread-root flex h-full min-h-0 flex-col bg-background">
    <header className="chat-header"><PanelsTopLeftIcon /><span>New Chat</span><button type="button" aria-label="分享对话"><ShareIcon /></button></header>
    <ThreadPrimitive.Viewport className="aui-thread-viewport flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AuiIf condition={(s) => s.thread.isEmpty}><Welcome /></AuiIf>
      <ThreadPrimitive.Messages components={{ AssistantMessage, UserMessage }} />
      <AuiIf condition={(s) => !s.thread.isEmpty}><ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-12 md:px-6">
        <ThreadPrimitive.ScrollToBottom className="aui-scroll-to-bottom absolute bottom-20 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"><ArrowDownIcon className="size-4" /></ThreadPrimitive.ScrollToBottom>
        <Composer />
        <p className="mt-2 text-center text-xs text-muted-foreground">Antler can make mistakes. Check important results.</p>
      </ThreadPrimitive.ViewportFooter></AuiIf>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>;
}
