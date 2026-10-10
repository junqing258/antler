---
name: tencent-cos
description: |
  腾讯云对象存储 COS 操作技能。用于上传、下载、列出、删除 COS 对象，尤其适合把生成的 HTML 报告、数据文件、图片等发布到指定 COS Bucket。

  触发场景：用户要求上传文件到腾讯云 COS/对象存储、生成 COS 链接、查看 COS 文件列表、从 COS 下载对象、删除 COS 对象，或要求发布报告到腾讯云对象存储。
allowed-tools:
  - read
  - read_skill_resource
  - write
  - bash
metadata:
  trigger: 当用户要求操作腾讯云 COS 对象存储时触发
  version: "1.0.0"
  last_updated: "2026-06-10"
---

# Tencent COS Skill

## Antler 运行约定

- 每次 `bash` 都从项目配置的工作目录重新启动；选择现有 `Stock-Analysis` 项目时，这里已经是项目根目录，不要再 `cd Stock-Analysis` 或创建同名目录。先用 `pwd` 和 `test -f .agents/skills/tencent-cos/SKILL.md` 校验位置。需要切换目录时，使用已确认的绝对路径，并与目标命令放在同一次调用中；上一次调用的 `cd` 不会延续。
- Skill 目录为 `.agents/skills/tencent-cos`；无需 Claude 专用环境变量。
- 使用现有目录中的 Skill 和文件，仅按需创建 `reports/` 等输出目录。找不到资源时先检查项目工作目录设置，不要通过移动项目文件修补路径。`.env` 和 `.env.example` 都受保护；保持现有配置文件原位，由业务脚本加载。遇到 `secret_access_denied` 后取消相关文件操作，继续可执行的任务，不用通配符、别名或其他脚本重试被拒绝的操作。
- 读取本 Skill 的 `references/`、`scripts/` 等资源时，使用 `read_skill_resource`，传入 `skillId: "tencent-cos"` 和相对资源路径；读取工作目录内文件使用 `read`，写入使用 `write`，执行命令使用 `bash`。

使用腾讯云 COS Python SDK 操作对象存储。Bucket、Appid、Region 不在 Skill 中定义默认值，必须从本地环境变量或项目根目录 `.env` 读取。

官方快速入门文档：<https://cloud.tencent.com/document/product/436/12269>

## 安全原则

- 不要把 `SecretId` / `SecretKey` 明文写入代码、Skill、报告或 Git 跟踪文件。
- 只从环境变量或项目根目录 `.env` 读取密钥：`COS_SECRET_ID`、`COS_SECRET_KEY`。
- 如用户提供了永久密钥，优先提醒使用子账号最小权限密钥；执行真实操作前确认本地环境变量已配置。
- 输出日志时不要打印完整密钥；需要诊断时最多显示前 6 位和后 4 位。

## 环境变量

在本地 shell 或项目根目录 `.env` 中配置：

```bash
COS_APP_ID=你的Appid
COS_SECRET_ID=你的SecretId
COS_SECRET_KEY=你的SecretKey
COS_REGION=你的Region
COS_BUCKET=你的BucketName-Appid
COS_ENDPOINT=
COS_PREFIX=
```

`.env` 已被项目 `.gitignore` 忽略，适合放本机私密配置。

说明：COS Python SDK 的 `Bucket` 参数通常需要使用完整的 `BucketName-Appid` 格式。若只配置了裸 BucketName，可同时配置 `COS_APP_ID`，脚本会组合为 `BucketName-Appid`。

## 首选脚本

优先使用随 Skill 提供的脚本：

```bash
uv run --project .agents/skills/tencent-cos .agents/skills/tencent-cos/scripts/cos_cli.py --help
```

如果缺少 SDK，先安装：

```bash
uv sync --project .agents/skills/tencent-cos
```

### 上传文件

```bash
uv run --project .agents/skills/tencent-cos .agents/skills/tencent-cos/scripts/cos_cli.py upload ./report.html reports/report.html
```

输出 JSON 会包含 `bucket`、`key`、`etag` 和默认访问 URL。若 Bucket 或对象不是公共读，URL 可能无法匿名访问，但对象已上传成功。

### 列出对象

```bash
uv run --project .agents/skills/tencent-cos .agents/skills/tencent-cos/scripts/cos_cli.py list reports/
```

### 下载对象

```bash
uv run --project .agents/skills/tencent-cos .agents/skills/tencent-cos/scripts/cos_cli.py download reports/report.html ./report.html
```

### 删除对象

删除前向用户确认目标 Key：

```bash
uv run --project .agents/skills/tencent-cos .agents/skills/tencent-cos/scripts/cos_cli.py delete reports/report.html
```

## 操作习惯

1. 操作前检查本地文件是否存在、Key 是否符合用户意图。
2. 上传 HTML 报告时，Key 优先按用户指定；若未指定，可结合 `COS_PREFIX` 生成 `<COS_PREFIX>/<原文件名>`，否则使用原文件名或清晰的业务目录。
3. `upload_file` 会自动选择简单上传或分块上传，适合报告和较大文件。
4. `list_objects` 单次最多返回 1000 个对象；需要完整遍历时使用脚本的分页逻辑。
5. 遇到配置缺失时，提示检查 `COS_BUCKET`、`COS_REGION`、`COS_SECRET_ID` / `COS_SECRET_KEY`；遇到鉴权失败时，提示检查 Bucket 权限和子账号策略。
6. 不在最终回复中复述密钥。只给出对象 Key、Bucket、区域、URL 和操作结果。