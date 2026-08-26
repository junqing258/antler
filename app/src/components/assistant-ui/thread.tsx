import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ReasoningMessagePartProps,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { DropdownMenu } from "radix-ui";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BarChart3Icon,
  BotIcon,
  BracesIcon,
  LightbulbIcon,
  MicIcon,
  PanelsTopLeftIcon,
  PenLineIcon,
  PlusIcon,
  ShareIcon,
  CloudSunIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  CopyIcon,
  RefreshCwIcon,
  SearchIcon,
  WrenchIcon,
  SquareIcon,
} from "lucide-react";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";

function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md prose prose-sm max-w-none text-foreground"
    />
  );
}

function Reasoning({ text, status }: ReasoningMessagePartProps) {
  return (
    <details className="agent-activity" open={status.type === "running"}>
      <summary>
        <LightbulbIcon aria-hidden="true" />
        <span>{status.type === "running" ? "正在思考" : "思考过程"}</span>
        <ChevronRightIcon className="agent-activity-chevron" aria-hidden="true" />
      </summary>
      <div className="agent-activity-content whitespace-pre-wrap">{text}</div>
    </details>
  );
}

function ToolCall({ toolName, args, result, isError }: ToolCallMessagePartProps) {
  const isRunning = result === undefined;
  const query =
    args && typeof args === "object" && "query" in args
      ? String(args.query ?? "")
      : "";
  return (
    <details className="agent-activity agent-tool-call" open={isRunning}>
      <summary>
        {toolName.toLowerCase().includes("search") ? (
          <SearchIcon aria-hidden="true" />
        ) : (
          <WrenchIcon aria-hidden="true" />
        )}
        <span>
          {isRunning
            ? `正在调用 ${toolName}`
            : isError
              ? `${toolName} 调用失败`
              : `${toolName} 调用完成`}
        </span>
        <ChevronRightIcon className="agent-activity-chevron" aria-hidden="true" />
      </summary>
      <div className="agent-activity-content">
        {query && <p className="m-0">查询：{query}</p>}
        {!query && <pre>{JSON.stringify(args, null, 2)}</pre>}
      </div>
    </details>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="aui-assistant-message group relative mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <MessagePrimitive.Parts
        components={{
          Text: MarkdownText,
          Reasoning,
          tools: { Fallback: ToolCall },
        }}
      />
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="not-last"
        className="aui-action-bar mt-2 flex items-center gap-1 text-muted-foreground"
      >
        <ActionBarPrimitive.Copy
          aria-label="复制回复"
          className="rounded-md p-1.5 hover:bg-muted hover:text-foreground"
        >
          <CopyIcon className="size-3.5" />
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload
          aria-label="重新生成"
          className="rounded-md p-1.5 hover:bg-muted hover:text-foreground"
        >
          <RefreshCwIcon className="size-3.5" />
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="aui-user-message mx-auto w-full max-w-3xl px-4 py-4 md:px-6">
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm leading-6 text-foreground">
        <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

type ModelPickerProps = {
  model: string;
  models: string[];
  onModelChange: (model: string) => void;
};

export function ModelPicker({
  model,
  models,
  onModelChange,
}: ModelPickerProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="model-picker"
          type="button"
          aria-label={`选择模型，当前模型 ${model}`}
        >
          <BotIcon />
          <span>{model}</span>
          <ChevronDownIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="model-picker-content"
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={8}
        >
          <DropdownMenu.Label className="model-picker-label">
            选择模型
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={model} onValueChange={onModelChange}>
            {models.map((candidate) => (
              <DropdownMenu.RadioItem
                className="model-picker-item"
                key={candidate}
                value={candidate}
              >
                <span>{candidate}</span>
                <DropdownMenu.ItemIndicator className="model-picker-indicator">
                  <CheckIcon aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Composer(props: ModelPickerProps) {
  return (
    <ComposerPrimitive.Root className="aui-composer mx-auto w-full max-w-175.5 rounded-[23px] border border-[#e8e8e8] bg-background px-4 pt-3 pb-2 shadow-[0_1px_2px_rgba(0,0,0,.02)] focus-within:border-[#dadada]">
      <ComposerPrimitive.Input
        aria-label="消息"
        className="block min-h-[37px] max-h-24 w-full resize-none bg-transparent py-0 text-[14px] leading-5 outline-none placeholder:text-[#afafaf]"
        placeholder="Send a message... (@ to mention, / for commands)"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <button
            className="composer-icon-button"
            aria-label="添加附件"
            type="button"
          >
            <PlusIcon />
          </button>
          <ModelPicker {...props} />
        </div>
        <div className="flex items-center gap-3">
          <button
            className="composer-icon-button text-[#888]"
            aria-label="语音输入"
            type="button"
          >
            <MicIcon />
          </button>
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel
              aria-label="停止生成"
              className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <SquareIcon className="size-2.5 fill-current" />
            </ComposerPrimitive.Cancel>
          </AuiIf>
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <ComposerPrimitive.Send
              aria-label="发送消息"
              className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-100"
            >
              <ArrowUpIcon className="size-4" />
            </ComposerPrimitive.Send>
          </AuiIf>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}

function Welcome(props: ModelPickerProps) {
  return (
    <div className="aui-welcome flex min-h-[calc(100svh-47px)] flex-col items-center justify-center px-4 text-center">
      <p className="m-0 text-[24px] font-semibold tracking-[-1px] text-foreground">
        How can I help you today?
      </p>
      <div className="mt-6 w-full">
        <Composer {...props} />
      </div>
      {/* <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Suggestion icon={<CloudSunIcon />} label="Weather" />
        <Suggestion icon={<BracesIcon />} label="Code" />
        <Suggestion icon={<PenLineIcon />} label="Write" />
        <Suggestion icon={<BarChart3Icon />} label="Analyze" />
        <Suggestion icon={<LightbulbIcon />} label="Brainstorm" />
      </div> */}
    </div>
  );
}

function Suggestion({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button className="suggestion-chip" type="button">
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function AssistantThread({
  model,
  models,
  title,
  onModelChange,
}: ModelPickerProps & { title: string }) {
  return (
    <ThreadPrimitive.Root className="aui-thread-root flex h-full min-h-0 flex-col bg-background">
      <header className="chat-header">
        <PanelsTopLeftIcon />
        <span>{title}</span>
        <button type="button" aria-label="分享对话">
          <ShareIcon />
        </button>
      </header>
      <ThreadPrimitive.Viewport className="aui-thread-viewport flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <Welcome
            model={model}
            models={models}
            onModelChange={onModelChange}
          />
        </AuiIf>
        <ThreadPrimitive.Messages
          components={{ AssistantMessage, UserMessage }}
        />
        <AuiIf condition={(s) => !s.thread.isEmpty}>
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-12 md:px-6">
            <ThreadPrimitive.ScrollToBottom className="aui-scroll-to-bottom absolute bottom-20 right-4 grid size-8 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground">
              <ArrowDownIcon className="size-4" />
            </ThreadPrimitive.ScrollToBottom>
            <Composer
              model={model}
              models={models}
              onModelChange={onModelChange}
            />
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Antler can make mistakes. Check important results.
            </p>
          </ThreadPrimitive.ViewportFooter>
        </AuiIf>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
