import { useState } from "react";
import {
  matchSlashCommands,
  slashCommandQuery,
  type SlashCommand,
} from "@antler/chat-core";

export function useSlashCommands(
  value: string,
  onChange: (value: string) => void,
) {
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selection, setSelection] = useState({ query: "", index: 0 });
  const query = slashCommandQuery(value);
  const matches = matchSlashCommands(query);
  const open = focused && query !== undefined && dismissed !== value;
  const activeIndex =
    selection.query === query
      ? Math.min(selection.index, matches.length - 1)
      : 0;
  const fill = (command: SlashCommand) => {
    setDismissed(command.prompt);
    onChange(command.prompt);
  };
  const move = (direction: number) => {
    if (!matches.length || query === undefined) return;
    setSelection({
      query,
      index: (activeIndex + direction + matches.length) % matches.length,
    });
  };
  return {
    focused,
    setFocused,
    open,
    matches,
    activeIndex,
    fill,
    move,
    dismiss: () => setDismissed(value),
  };
}
