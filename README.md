# Antler

Antler 是一个 Web Agent 项目。前端使用 React + Vite，后端使用 Fastify；浏览器通过 HTTP API 创建任务，并通过 SSE 接收流式输出。后端使用 Prisma + PostgreSQL 保存运行记录；知识库由外部 Antler RAG 服务管理。

项目演示：[http://47.100.210.56:3210/](http://47.100.210.56:3210/)

知识库（Antler RAG）演示：[http://47.100.210.56:6050/](http://47.100.210.56:6050/)

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

## Supabase 登录认证（Web 多用户）

自托管 Web 部署可启用 Supabase Auth（邮箱密码注册/登录）：浏览器持有 Supabase 会话并随请求发送 `Authorization: Bearer <access_token>`，backend 校验签名后按用户 ID 隔离运行记录与定时任务。Tauri 桌面模式与本地开发不受影响，仍使用共享访问令牌。

Supabase 控制台准备：开启 Email provider；项目使用非对称 JWT 签名密钥（新项目默认即是，`GET <项目URL>/auth/v1/.well-known/jwks.json` 能返回密钥）。若项目仍是 HS256 共享密钥，需配置 `ANTLER_SUPABASE_PUBLISHABLE_KEY`，backend 会改走 `/auth/v1/user` 在线校验。

backend 环境变量（`.env`）：

```dotenv
ANTLER_AUTH_MODE=supabase
ANTLER_SUPABASE_URL=https://<project-ref>.supabase.co
# 仅 HS256 项目需要：
# ANTLER_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

前端无需单独配置：启动时从 `GET /api/auth-config` 获取认证配置（含 Supabase URL 与 publishable key），随后在浏览器直连 Supabase 完成邮箱密码登录。`ANTLER_AUTH_MODE=supabase` 时本地开发与 Web 部署行为一致。
数据隔离：`runs`、`scheduled_tasks`、`task_executions` 均记录归属用户；local 模式写入空字符串，查询不过滤。会话仍保存在浏览器 IndexedDB，不随账号跨设备同步。已知约束：登录用户仍可指定服务器上任意绝对路径作为 Agent 工作目录，如需收紧应在网关或后续版本限制在 `ANTLER_WORKSPACE_ROOT` 之下。

后端数据存放在 Postgres（推荐 Supabase）中，启动前必须设置 `DATABASE_URL` 指向 Postgres 连接串（应用运行可使用事务池化连接；`prisma migrate deploy` 需要直连或会话池化连接）。`ANTLER_WORKSPACE_ROOT` 仍决定 Agent 工作空间目录。修改 `backend/prisma/schema.prisma` 后，运行：

```bash
pnpm --filter @antler/server db:migrate -- --name <migration-name>
pnpm --filter @antler/server db:generate
```

## PWA

Web 生产构建支持安装到桌面或手机主屏幕。使用 HTTPS 部署后，可通过浏览器的“安装应用”入口安装；iPhone/iPad 在 Safari 分享菜单中选择“添加到主屏幕”。Service Worker 仅在生产环境的安全浏览器上下文中注册，开发模式和 Tauri 桌面端不启用。

首次在线访问并完成缓存后，页面和本地保存的会话可离线打开；发送消息、执行任务和读取服务端配置仍需要网络。缓存只包含前端静态资源，不缓存 API、SSE 或模型响应。发现新版本时会显示提示，点击“刷新更新”后应用更新，请先等待当前任务完成。

本地验证生产版本：

```bash
pnpm --filter @antler/app build
pnpm --filter @antler/app exec vite preview --host 127.0.0.1
```

在 <http://127.0.0.1:4173> 检查浏览器开发者工具的 Application → Manifest / Service Workers，并在缓存完成后切换离线、刷新页面。localhost/回环地址可使用 HTTP 测试；公网 HTTP 地址（包括当前演示地址）无法启用 Service Worker，需要配置 HTTPS。预览服务器不提供后端 API，完整聊天功能需部署到后端同源服务。

## backend 共享技能

`backend/skills/` 中的技能随服务端分发，供所有 Web Agent 工作空间使用，目前内置 `antler-rag`。服务端从自身模块的位置定位该目录，本地开发、编译后启动和 Docker 运行使用同一套发现逻辑，无需把技能安装到开发机或各个工作空间的 `.agents` 目录。

技能优先级为工作空间的 `.agents/skills/`、用户级 `~/.agents/skills/`（可通过 `ANTLER_AGENTS_DIR` 调整）、backend 内置技能。同名技能只保留优先级最高的版本。`GET /api/skills` 返回内置技能的 `scope: "bundled"`；Web 使用的 `POST /api/runs` 默认采用 `skillPolicy: { "mode": "auto" }`，Agent 根据名称和描述选择技能，再调用 `load_skill` 加载完整说明。请求仍可显式指定 `disabled` 或 `selected`。

使用 `antler-rag` 检索前，点击侧栏“知识库配置”，填写 RAG 服务地址和 API Key，保存后即时生效，无需重启 backend。配置保存在当前 backend 工作空间的 `.antler/rag-config.json`，重启后保留；同一 backend 的客户端共享该配置。密钥不会通过配置接口返回，留空保存会保留现有密钥，也可以单独清除。

backend 环境变量作为默认值（界面配置优先）：

```dotenv
ANTLER_RAG_URL=https://rag.example.com
ANTLER_RAG_KEY=your-rag-api-key
```

在配置界面点击“恢复环境默认值”可移除界面覆盖，重新使用 `ANTLER_RAG_URL`、`ANTLER_RAG_KEY`。环境变量修改仍需重启 backend。RAG 地址支持 HTTP 和 HTTPS，必须是服务 origin，不含路径或查询参数。配置界面提供“打开知识库管理页面”链接。Antler 不再提供本地知识库管理、索引和自动检索。

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

Tushare Pro 的 Token 可放在 `.env.deploy` 的 `TUSHARE_TOKEN` 中，随部署传入容器，并显式注入 Agent 工具子进程；工具输出中的 Token 会脱敏。Python 调用需显式传入环境变量，例如 `ts.pro_api(os.environ["TUSHARE_TOKEN"])`（先导入 `os` 和 `tushare as ts`）；仅检查 `ts.get_token()` 不能判断环境变量是否配置。直接执行 `python3` 脚本即可使用预装的 SDK。股票技能的 `uv run --project` 使用独立项目环境；使用 Tushare 时需加 `--extra enhanced`（例如 `uv run --project .agents/skills/stock-analysis --extra enhanced .agents/skills/stock-analysis/references/stock_data_fetcher.py --stocks 600519`），首次运行仍会安装该技能的项目依赖。

镜像构建时预下载与运行环境匹配的 Prisma 迁移引擎，启动时无需临时下载。健康检查提供 120 秒启动宽限期，部署脚本最多等待 300 秒；启动失败会输出容器状态、健康检查结果和最近日志。

内置“股票分析师”在种子项目包含 `SKILL.md` 和 `pyproject.toml` 时，默认使用 `workspace/Stock-Analysis` 作为工作目录；缺少种子项目时回退到独立 Agent 目录。显式选择的工作目录优先。已有会话保留原工作目录，应用此默认值需新建会话。

脚本还会把仓库中 git 跟踪的 `workspace/` 内容上传到远端 `workspace/`，补齐远端缺失的种子项目（例如 `workspace/Stock-Analysis`）。解包使用 `--skip-old-files`，远端已存在的文件不会被覆盖，因此远端生成的报告和运行数据会保留；种子目录中后续的技能改动需先删除远端同名文件再重新部署。

部署其他环境时，可使用 `.env.<环境>` 覆盖 `.env`，例如 `scripts/deploy-apps-ssh.sh test`；此时 `.env.test` 必须存在。

Web 部署会直接公开后端端口。公网部署请通过防火墙限制访问来源，或在外部网关配置用户认证。

## 日志与 traces

后端支持通过共享 Vector 将 HTTP、Agent Run、模型和工具调用的 traces 写入 OpenObserve，并在日志中附加 trace ID。配置、采集范围及查看方式见 [tracing 接入说明](docs/tracing.md)。共享采集器独立维护于 `../observability`，同时采集后端和 RAG 日志。

## 检查

```bash
pnpm check
pnpm test
```

内部 knowledge 模块已移除，初始化迁移不再创建知识库表。已部署的数据库在执行 `pnpm --filter @antler/server db:deploy` 后，会通过清理迁移删除旧的 7 张知识库表及相关枚举（包括其中的数据），运行记录和外部 RAG 配置保留。

## Agent 平台

首页可新建 Agent，编辑名称、描述、系统提示词并绑定平台技能，发布后对登录用户可见；作者可反复调试草稿、编辑、下线和删除。local 模式等价于本机单用户。聊天统一从 Agent 进入，会话历史按 Agent 展示，不再提供项目管理或普通聊天入口。旧聊天链接若已绑定 Agent 则跳转到对应 Agent，否则返回列表；旧本地数据保留，不自动改绑。

技能库接受含 `SKILL.md` 和资源文件的 ZIP（压缩包最多 5 MiB、200 条目、解压总量 20 MiB、单文件 1 MiB，指令文件最多 64 KiB）。名称来自 frontmatter 且全局唯一；覆盖内容用 `PUT /api/skills/:id`，不可改名，无版本回滚。`disable-model-invocation: true` 可上传展示，但不能绑定。技能被引用时不可删除；错误响应只展示调用者可见的 Agent 引用。

Agent 的技能是封闭集，不叠加本地技能。已发布 Agent 仍可直接编辑；提示词或技能内容变更后，旧会话下一轮返回 `agent_context_changed`，需新建会话；切换 Agent 返回 `agent_changed`。下线不打断进行中的运行，作者仍可续聊草稿，其他用户得到 404。定时任务保存时固化 Agent ID 与内容指纹，执行只允许 published；内容变化后须重新保存任务，并使用新会话。相关校验失败不自动重试。

`ANTLER_PLATFORM_ROOT` 默认是仓库根的 `.antler-platform`，必须位于 `ANTLER_WORKSPACE_ROOT` 之外。**平台状态的唯一事实源是数据库**：skill 文件内容存于 `skill_files` 表（上传在单个数据库事务内提交），该目录只是按需从数据库重建的本地缓存，回填完成后可整目录删除；`.tmp/` 仅在缓存安装期间短暂存在。Docker 将主机 `platform/` 挂载到 `/platform` 与 `workspace/` 分离；容器属主应与目录属主一致。

v1 **每个数据库仅允许一个 backend 进程**（会话上下文、调度器和活动 run 是进程内状态；第二个实例会把活动 run 误标为中断并双重触发定时任务，启动时的 warning 日志会提示）。此约束为部署约定，不再由锁强制——平台文件与数据库不再双写，旧的单实例锁已随文件事务机制一并移除。升级先执行 `pnpm --filter @antler/server db:deploy`，首次启动时保留旧平台目录，自动把存量磁盘技能回填进 `skill_files`；确认回填完成前不要删除旧目录。数据库备份必须包含文件表；部署先停旧进程再启动新进程，禁止重叠运行。回填失败的技能标记 `broken`，重新上传即可修复。`DEPLOY_DRY_RUN=1 scripts/deploy-apps-ssh.sh` 可只检查环境合并，不访问远端。

`read` / `write` / `edit` 对平台根进行路径拒绝，技能资源读取限制在单技能目录内。**bash 没有文件系统沙箱**，仍可访问进程用户可访问的绝对路径；`0700` 不能隔离同一用户启动的 bash。bash 改写或删除缓存文件不会污染数据库：下次读取检测到指纹不符即从数据库重建缓存，技能保持 `ready`；只有数据库行自身不一致才会标记 `tampered`，`broken` 表示数据库内容本身不可用（如回填失败），作者重新上传同一技能可恢复。真正隔离需在部署层让 bash 使用另一个用户或容器。运行持有技能读租约直到工具执行结束，覆盖更新与删除等待租约释放。

升级前没有技能上下文的普通聊天，首次成功续聊建立技能基线；此后重启也严格校验。无法据此检测升级前的技能变化。历史空属主或多属主冲突会话在 supabase 模式下拒绝自动认领，需明确迁移。`/api/runs` 不再要求 `projectId`；数据库中的旧项目字段仅为历史兼容保留，不参与会话组织。
