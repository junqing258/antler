import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { useSlashCommands } from "./use-slash-commands";
import type { ComposerProps } from "./composer-types";

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  disabled,
}: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const listId = useId();
  const activeOption = useRef<HTMLButtonElement>(null);
  const commands = useSlashCommands(value, onChange);
  const fill = (index: number) => {
    const command = commands.matches[index];
    if (!command) return;
    commands.fill(command);
    input.current?.focus();
  };
  const unavailable = !running && (disabled || !value.trim());

  useEffect(() => {
    if (commands.open)
      activeOption.current?.scrollIntoView?.({ block: "nearest" });
  }, [commands.open, commands.activeIndex, value]);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(120, Math.max(44, element.scrollHeight))}px`;
  }, [value]);

  return (
    <div style={{ position: "relative" }}>
      {commands.open && (
        <div
          id={listId}
          role="listbox"
          aria-label="命令提示"
          style={{
            position: "absolute",
            bottom: "100%",
            zIndex: 10,
            width: "100%",
            maxHeight: 220,
            overflowY: "auto",
            background: "white",
            border: "1px solid #aaa",
            borderRadius: 8,
          }}
        >
          {commands.matches.map((command, index) => (
            <button
              key={command.name}
              ref={index === commands.activeIndex ? activeOption : undefined}
              type="button"
              id={`${listId}-${command.name}`}
              role="option"
              aria-selected={index === commands.activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => fill(index)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: 8,
                border: 0,
                background:
                  index === commands.activeIndex ? "#e4e9e7" : "white",
              }}
            >
              /{command.name} · {command.label} — {command.description}
            </button>
          ))}
          {!commands.matches.length && (
            <div style={{ padding: 8 }}>没有匹配的命令</div>
          )}
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "8px 0",
        }}
      >
        <textarea
          ref={input}
          aria-label="消息"
          aria-expanded={commands.open}
          aria-controls={commands.open ? listId : undefined}
          aria-activedescendant={
            commands.open && commands.matches[commands.activeIndex]
              ? `${listId}-${commands.matches[commands.activeIndex].name}`
              : undefined
          }
          onFocus={() => commands.setFocused(true)}
          onBlur={() => commands.setFocused(false)}
          placeholder="输入消息"
          value={value}
          rows={1}
          onChange={(event) => onChange(event.currentTarget.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              composing.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            )
              return;
            if (commands.open && event.key === "Escape") {
              event.preventDefault();
              commands.dismiss();
              return;
            }
            if (
              event.shiftKey ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey
            )
              return;
            if (commands.open && commands.matches.length) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                commands.move(event.key === "ArrowDown" ? 1 : -1);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                if (!event.repeat) fill(commands.activeIndex);
                return;
              }
            }
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (!running && !unavailable && !event.repeat) onSend();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            boxSizing: "border-box",
            resize: "none",
            maxHeight: 120,
            minHeight: 44,
            overflowY: "auto",
            border: "1px solid #aaa",
            borderRadius: 8,
            padding: 10,
            font: "inherit",
          }}
        />
        <button
          type="button"
          disabled={unavailable}
          onClick={running ? onStop : onSend}
          style={{
            border: 0,
            borderRadius: 8,
            backgroundColor: "#087d61",
            color: "white",
            fontWeight: 600,
            padding: 10,
            alignSelf: "flex-start",
            opacity: unavailable ? 0.45 : 1,
          }}
        >
          {running ? "停止" : "发送"}
        </button>
      </div>
    </div>
  );
}
