import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useSlashCommands } from "./use-slash-commands";
import type { ComposerProps } from "./composer-types";

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  disabled,
  leading,
}: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
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
    element.style.height = `${Math.min(120, Math.max(36, element.scrollHeight))}px`;
  }, [value]);

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      {commands.open && (
        <div
          id={listId}
          role="listbox"
          aria-label="命令提示"
          style={{
            position: "absolute",
            bottom: "100%",
            marginBottom: 8,
            zIndex: 10,
            width: "100%",
            maxHeight: 220,
            overflowY: "auto",
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 14,
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
                  index === commands.activeIndex ? "#f3f3f3" : "white",
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
          flexDirection: "column",
          gap: 4,
          border: `1px solid ${focused ? "#aaa" : "#e3e3e3"}`,
          borderRadius: 24,
          padding: "12px 12px 8px",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
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
          onFocus={() => {
            setFocused(true);
            commands.setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
            commands.setFocused(false);
          }}
          placeholder="随心输入，/ 使用命令"
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
            width: "100%",
            minWidth: 0,
            boxSizing: "border-box",
            resize: "none",
            maxHeight: 120,
            minHeight: 36,
            overflowY: "auto",
            border: 0,
            outline: "none",
            background: "transparent",
            padding: "2px 4px",
            font: "inherit",
            fontSize: 15,
            lineHeight: "24px",
            color: "#292929",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            minWidth: 0,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            {leading}
          </div>
          <button
            type="button"
            aria-label={running ? "停止" : "发送"}
            disabled={unavailable}
            onClick={running ? onStop : onSend}
            style={{
              display: "grid",
              placeItems: "center",
              width: 40,
              height: 40,
              flexShrink: 0,
              border: 0,
              borderRadius: "50%",
              backgroundColor: unavailable ? "#999" : "#292929",
              color: "white",
              cursor: unavailable ? "default" : "pointer",
            }}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
            >
              {running ? (
                <rect
                  x="6"
                  y="6"
                  width="12"
                  height="12"
                  rx="2"
                  fill="currentColor"
                />
              ) : (
                <path
                  d="M12 20V4m-7 7 7-7 7 7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
