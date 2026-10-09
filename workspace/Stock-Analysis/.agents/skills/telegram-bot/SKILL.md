---
name: telegram-bot
description: |
  Telegram Bot 群消息发送技能。用于通过 Telegram Bot API 向默认群聊或指定 chat_id 发送通知、报告链接、任务结果和简短文本消息。

  触发场景：用户要求发送 Telegram/电报群消息、给群里发通知、推送报告到 Telegram、用机器人发消息，或要求测试 Telegram Bot 发信能力。
allowed-tools:
  - read
  - read_skill_resource
  - write
  - bash
metadata:
  trigger: 当用户要求通过 Telegram Bot 发送群消息或通知时触发
  version: "1.0.0"
  last_updated: "2026-06-10"
---

# TelegramBot Skill

## Antler 运行约定

- 当前工作目录为 `Stock-Analysis`，下文命令均从该目录执行。
- Skill 目录为 `.agents/skills/telegram-bot`；无需 Claude 专用环境变量。
- 读取本 Skill 的 `references/`、`scripts/` 等资源时，使用 `read_skill_resource`，传入 `skillId: "telegram-bot"` 和相对资源路径；读取工作目录内文件使用 `read`，写入使用 `write`，执行命令使用 `bash`。

使用 Telegram Bot API 向群聊发送消息。Bot token 和默认群聊 ID 必须从本地环境变量或项目根目录 `.env` 读取。

## 安全原则

- 不要把 Bot token 明文写入代码、Skill 正文、报告或 Git 跟踪文件。
- 只从环境变量或项目根目录 `.env` 读取：`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`。
- 输出日志时不要打印完整 token；需要诊断时最多显示前 6 位和后 4 位。
- 发送真实群消息前，确认消息内容和目标 `chat_id` 符合用户意图。

## 环境变量

在本地 shell 或项目根目录 `.env` 中配置：

```bash
TELEGRAM_BOT_TOKEN=你的BotToken
TELEGRAM_CHAT_ID=你的群聊ChatId
TELEGRAM_PROXY=
```

`.env` 已被项目 `.gitignore` 忽略，适合放本机私密配置。

`TELEGRAM_PROXY` 可选，支持 `http://127.0.0.1:7897` 这类代理；也可以使用系统环境变量 `HTTPS_PROXY` / `HTTP_PROXY`。

兼容旧变量名：脚本也会在未配置 `TELEGRAM_CHAT_ID` 时尝试读取 `TELEGRAM_NCHAT_ID`。

## 首选脚本

优先使用随 Skill 提供的脚本：

```bash
python3 .agents/skills/telegram-bot/scripts/telegram_cli.py --help
```

### 发送默认群消息

```bash
python3 .agents/skills/telegram-bot/scripts/telegram_cli.py send "报告已生成"
```

### 从 stdin 发送长消息

```bash
printf '%s\n' "报告已生成：https://example.com/report.html" \
  | python3 .agents/skills/telegram-bot/scripts/telegram_cli.py send --stdin
```

### 指定群聊或启用 Markdown

```bash
python3 .agents/skills/telegram-bot/scripts/telegram_cli.py send \
  --chat-id "-1001234567890" \
  --parse-mode Markdown \
  "*报告已生成*"
```

## 操作习惯

1. 简短通知直接使用命令行参数；多行报告摘要使用 `--stdin`。
2. 未指定 `--chat-id` 时使用 `.env` 中的 `TELEGRAM_CHAT_ID`。
3. 默认不使用 `parse_mode`，避免 Markdown/HTML 转义问题；用户明确要求格式化时再启用。
4. 发送前不要在终端或最终回复里复述 token。
5. 成功后只反馈 `chat_id`、`message_id`、发送时间和消息摘要。