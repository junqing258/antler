import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

const commands = [
  {
    name: "summarize",
    label: "总结",
    description: "提炼重点与结论",
    prompt: "请总结以下内容，提炼重点与结论：\n",
  },
  {
    name: "explain",
    label: "解释",
    description: "用易懂的语言解释概念或代码",
    prompt: "请用易懂的语言解释以下内容：\n",
  },
  {
    name: "review",
    label: "审查",
    description: "检查代码问题并给出改进建议",
    prompt: "请审查以下代码，指出潜在问题并给出改进建议：\n",
  },
  {
    name: "translate",
    label: "翻译",
    description: "翻译文本并保留原意",
    prompt: "请翻译以下内容，保留原意与语气：\n",
  },
  {
    name: "polish",
    label: "润色",
    description: "让表达更清晰、流畅",
    prompt: "请润色以下内容，使表达更清晰、流畅：\n",
  },
  {
    name: "plan",
    label: "计划",
    description: "拆解目标，制定执行步骤",
    prompt: "请为以下目标制定可执行的计划，列出步骤与注意事项：\n",
  },
  {
    name: "compact",
    label: "压缩会话",
    description: "压缩模型上下文，保留聊天记录",
    prompt: "/compact",
  },
];

export function SlashCommandInput() {
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissedText, setDismissedText] = useState<string | null>(null);
  const [selection, setSelection] = useState({ query: "", index: 0 });
  const query = /^\/([^\s/]*)$/.exec(text)?.[1].toLowerCase();
  const matches =
    query === undefined
      ? []
      : commands.filter(
          (command) =>
            command.name.includes(query) ||
            command.label.includes(query) ||
            command.description.includes(query),
        );
  const open = focused && query !== undefined && dismissedText !== text;
  const activeIndex =
    selection.query === query
      ? Math.min(selection.index, matches.length - 1)
      : 0;

  useEffect(() => {
    if (open) activeOptionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, query]);

  const fill = (command: (typeof commands)[number]) => {
    aui.composer.setText(command.prompt);
    setDismissedText(command.prompt);
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(
        command.prompt.length,
        command.prompt.length,
      );
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    // Some IMEs report keyCode 229 on the final Enter without isComposing.
    if (event.keyCode === 229) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedText(text);
      return;
    }
    if (
      !matches.length ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setSelection({
        query: query!,
        index: (activeIndex + direction + matches.length) % matches.length,
      });
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      fill(matches[activeIndex]);
    }
  };

  return (
    <div className="relative">
      {open && (
        <div className="absolute bottom-full z-50 mb-4 w-full overflow-hidden rounded-xl border border-[#e5e5e5] bg-background shadow-[0_10px_32px_rgb(0_0_0_/_12%)]">
          <div className="flex flex-wrap items-center justify-between gap-1 px-3 pb-1 pt-2 text-[11px] text-muted-foreground">
            <span>命令 · 选择后填入，发送后执行</span>
            <span aria-hidden="true" className="hidden sm:inline">
              ↑↓ 选择 · Enter / Tab 填充 · Esc 关闭
            </span>
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="命令提示"
            className="max-h-[min(14rem,30svh)] overflow-y-auto p-1.5"
          >
            {matches.map((command, index) => (
              <button
                key={command.name}
                ref={index === activeIndex ? activeOptionRef : undefined}
                id={`${listId}-${command.name}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm ${index === activeIndex ? "bg-muted" : "hover:bg-muted"}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSelection({ query: query!, index })}
                onClick={() => fill(command)}
              >
                <span className="w-24 shrink-0 font-medium text-foreground">
                  /{command.name}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">
                    {command.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {command.description}
                  </span>
                </span>
              </button>
            ))}
            {!matches.length && (
              <p className="m-0 px-2.5 py-3 text-xs text-muted-foreground">
                没有匹配的命令
              </p>
            )}
          </div>
        </div>
      )}
      <ComposerPrimitive.Input
        ref={inputRef}
        aria-label="消息"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && matches[activeIndex]
            ? `${listId}-${matches[activeIndex].name}`
            : undefined
        }
        className="block min-h-[37px] max-h-24 w-full resize-none bg-transparent py-0 text-[14px] leading-5 outline-none placeholder:text-[#afafaf]"
        placeholder="输入消息…（@ 提及，/ 使用命令）"
        cancelOnEscape={!open}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={() => setDismissedText(null)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
