export const slashCommands = [
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

export type SlashCommand = (typeof slashCommands)[number];

export function slashCommandQuery(text: string): string | undefined {
  return /^\/([^\s/]*)$/.exec(text)?.[1].toLowerCase();
}

export function matchSlashCommands(query: string | undefined): SlashCommand[] {
  return query === undefined
    ? []
    : slashCommands.filter(
        (command) =>
          command.name.includes(query) ||
          command.label.includes(query) ||
          command.description.includes(query),
      );
}
