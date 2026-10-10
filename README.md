# Antler

Antler 是一个 Web Agent 项目。前端使用 React + Vite，后端使用 Fastify；浏览器通过 HTTP API 创建任务，并通过 SSE 接收流式输出。后端使用 Prisma + SQLite 保存运行记录；知识库由外部 Antler RAG 服务管理。

## 本地开发

需要 Node.js、pnpm 10。安装依赖并同时启动前后端：

```bash
pnpm install
pnpm dev
```

在浏览器打开 <http://127.0.0.1:1420>。Vite 开发服务器使用 `1420` 端口，后端 API 默认监听 `127.0.0.1:3210`。也可以分别运行 `pnpm dev:web` 和 `pnpm dev:server`。

在页面的“供应商配置”中填写模型密钥，或在仓库根目录的 `.env` 中设置服务端密钥，例如：

```dotenv
OPENAI_API_KEY=your-api-key
# ANTLER_MODEL=gpt-4.1-mini
```

服务端也支持 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL` 等配置。未配置可用密钥时，任务会以 `task.failed` 结束。浏览器中填写的供应商配置保存在当前浏览器的本地存储中。

后端数据默认写入 `workspace/antler.db`；可通过 `DATABASE_URL` 和 `ANTLER_WORKSPACE_ROOT` 调整。修改 `backend/prisma/schema.prisma` 后，运行：

```bash
pnpm --filter @antler/server db:migrate -- --name <migration-name>
pnpm --filter @antler/server db:generate
```

## backend 共享技能

`backend/skills/` 中的技能随服务端分发，供所有 Web Agent 工作空间使用，目前内置 `antler-rag`。服务端从自身模块的位置定位该目录，本地开发、编译后启动和 Docker 运行使用同一套发现逻辑，无需把技能安装到开发机或各个工作空间的 `.agents` 目录。

技能优先级为工作空间的 `.agents/skills/`、用户级 `~/.agents/skills/`（可通过 `ANTLER_AGENTS_DIR` 调整）、backend 内置技能。同名技能只保留优先级最高的版本。`GET /api/skills` 返回内置技能的 `scope: "bundled"`；Web 使用的 `POST /api/runs` 默认采用 `skillPolicy: { "mode": "auto" }`，Agent 根据名称和描述选择技能，再调用 `load_skill` 加载完整说明。请求仍可显式指定 `disabled` 或 `selected`。

使用 `antler-rag` 检索前，点击侧栏“知识库配置”，填写 RAG 服务地址和 API Key，保存后即时生效，无需重启 backend。配置保存在当前 backend 工作空间的 `.antler/rag-config.json`，重启后保留；同一 backend 的客户端共享该配置。密钥不会通过配置接口返回，留空保存会保留现有密钥，也可以单独清除。

backend 环境变量作为默认值（界面配置优先）：

```dotenv
ANTLER_RAG_URL=https://rag.example.com
ANTLER_RAG_KEY=your-rag-api-key
```

在配置界面点击“恢复环境默认值”可移除界面覆盖，重新使用 `ANTLER_RAG_URL`、`ANTLER_RAG_KEY`。环境变量修改仍需重启 backend。RAG 地址必须是服务 origin，不含路径或查询参数；除本机外须使用 HTTPS。配置界面提供“打开知识库管理页面”链接。Antler 不再提供本地知识库管理、索引和自动检索。

本地可填写仓库根目录的 `.env`；Docker 部署可填写 `.env.deploy`，部署脚本会合并并传入容器。密钥不会写入技能或镜像。Docker 镜像包含技能文件和 Python 3；本地调用技能需安装 Python 3.9+。Agent 通过 `read_skill_resource` 获取随技能打包的客户端脚本，并在当前工作空间临时执行，无需知道服务器的安装路径。

## 部署 Web 版

Docker 镜像会编译前端，并由 Fastify 在同一个端口提供网页、API 和 SSE；远端数据保存在部署目录的 `workspace/`。本地需要 Docker（含 buildx）、SSH 和 SCP，远端需要 Docker Compose。

```bash
touch .env
cp .env.deploy.example .env.deploy
# 编辑 .env.deploy 中的 SSH 目标、端口和可选模型配置
scripts/deploy-apps-ssh.sh
```

脚本合并 `.env` 与 `.env.deploy`，后者的同名配置优先；它会探测远端 amd64/arm64 架构、构建并传输镜像，然后启动容器并等待健康检查。示例配置默认部署到 `root@47.100.210.56:/opt/antler`，访问地址为 <http://47.100.210.56:3210/>。目标和端口可在环境文件中修改；运行 `scripts/deploy-apps-ssh.sh --help` 可查看其他选项。

镜像先导出为本地 gzip 压缩归档，再通过 SSH 上传并导入远端 Docker。`pv` 按归档实际大小显示传输进度、吞吐率与 ETA；本地需有足够空间存放临时压缩归档，脚本退出时自动清理。

Docker 构建默认使用 npmmirror 下载 pnpm 和 npm 依赖，使用中科大 Debian 镜像安装系统依赖。apt 下载最多重试 3 次，连接及数据等待超时为 30 秒。手动构建时可通过 `--build-arg DEBIAN_MIRROR=http://其他镜像主机` 更换 Debian 镜像；该主机需同时提供 `/debian` 和 `/debian-security`。

镜像在 `/opt/antler-python` 中预装 pip、uv 和 Tushare SDK（版本见 `backend/requirements-runtime.txt`），`python`、`python3`、`pip`、`pip3` 和 `uv` 可直接在容器内使用。Python 包默认从腾讯云 PyPI 镜像下载，可在构建时通过 `--build-arg PYPI_INDEX_URL=https://其他镜像/simple` 更换；运行时可分别通过 `PIP_INDEX_URL` 和 `UV_DEFAULT_INDEX` 覆盖。部署脚本会在传输镜像前离线检查工具版本、依赖完整性及 Tushare 导入，避免把缺少依赖的镜像部署到远端。

Tushare Pro 的 Token 可放在 `.env.deploy` 的 `TUSHARE_TOKEN` 中，随部署传入容器。直接执行 `python3` 脚本即可使用预装的 SDK。股票技能的 `uv run --project` 使用独立项目环境；使用 Tushare 时需加 `--extra enhanced`（例如 `uv run --project .agents/skills/stock-analysis --extra enhanced .agents/skills/stock-analysis/references/stock_data_fetcher.py --stocks 600519`），首次运行仍会安装该技能的项目依赖。

镜像构建时预下载与运行环境匹配的 Prisma 迁移引擎，启动时无需临时下载。健康检查提供 120 秒启动宽限期，部署脚本最多等待 300 秒；启动失败会输出容器状态、健康检查结果和最近日志。

脚本还会把仓库中 git 跟踪的 `workspace/` 内容上传到远端 `workspace/`，补齐远端缺失的种子项目（例如 `workspace/Stock-Analysis`）。解包使用 `--skip-old-files`，远端已存在的文件不会被覆盖，因此远端生成的报告和运行数据会保留；种子目录中后续的技能改动需先删除远端同名文件再重新部署。

部署其他环境时，可使用 `.env.<环境>` 覆盖 `.env`，例如 `scripts/deploy-apps-ssh.sh test`；此时 `.env.test` 必须存在。

Web 部署会直接公开后端端口。公网部署请通过防火墙限制访问来源，或在外部网关配置用户认证。

## 检查

```bash
pnpm check
pnpm test
```
