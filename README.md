# Antler

桌面自主型 Agent 的 M0 骨架。Tauri/React 前端通过 HTTP（REST）创建任务，通过 SSE 接收流式输出；Node.js 服务仅监听 `127.0.0.1`，由 Tauri 在桌面模式下启动、退出时回收。Tauri 开发模式依赖系统已安装的 Node.js；正式分发前需将 Node 运行时与服务入口构建为对应平台的 sidecar 二进制。

## 开发

```bash
pnpm install
pnpm dev:server # 浏览器模式下的本地服务
pnpm dev:app    # 浏览器模式下的 React 前端
# 或在 app/ 中执行 pnpm tauri dev，体验 Tauri 拉起 Node 伴生服务
```

服务已接入 Pi Agent Core 的最小运行时。当前首个 provider 为 OpenAI：设置 `OPENAI_API_KEY`（可选 `ANTLER_MODEL`，默认 `gpt-4.1-mini`）后，`/api/tasks` 会返回真实的流式模型输出；未配置密钥时会以结构化 `task.failed` 结束，而不会回退到占位回复。运行时为每个会话限制一个 active run，并支持 `POST /api/runs/:runId/cancel` 取消。

## Docker 一键部署

部署只包含一个 backend 容器：镜像构建阶段同时编译 React Web，运行时由 Fastify 直接提供静态资源、SPA 回退、API 与 SSE，不依赖 Nginx。远端工作区持久化在部署目录下的 `workspace/`。

```bash
cp .env.deploy.example .env.deploy
# 编辑 .env.deploy 中的 SSH 目标、端口和可选模型配置
scripts/deploy-apps-ssh.sh
```

脚本会自动探测远端的 amd64/arm64 架构，在本机构建包含 Web 的 backend 镜像，通过 SSH 传输镜像和配置，并执行 Compose 健康检查。默认部署到 `root@47.100.210.56:/opt/antler`，默认访问地址为 `http://47.100.210.56:3210/`。所有默认值均可通过脚本 `--help` 中列出的 `DEPLOY_*` 环境变量覆盖。

Docker Web 模式会直接公开 backend 端口，不启用桌面伴生服务使用的 `ANTLER_ACCESS_TOKEN`。公网部署应通过云安全组或主机防火墙限制 `ANTLER_WEB_PORT` 的来源；如需用户级认证，应在外部认证网关实现。

部署其他环境时，可使用 `.env.<环境>` 覆盖 `.env`：

```bash
scripts/deploy-apps-ssh.sh test
```

这种情况下 `.env.test` 必须存在。模型密钥既可以放在部署环境文件中，也可以由用户在 Web 页面的“供应商配置”中保存到当前浏览器。

## macOS：应用无法启动

若双击 `Antler.app` 后立即退出，且崩溃报告中包含 `SIGABRT`、`RegisterApplication` 或 LaunchServices 错误 `-10822`，则问题出在 macOS 的 LaunchServices 用户服务，而非应用代码。`-10822` 表示无法与维护应用注册数据库的系统服务通信。

先重启当前用户的 LaunchServices 服务，再重新打开应用：

```bash
killall -u "$USER" lsd
open app/src-tauri/target/release/bundle/macos/Antler.app
```

`lsd` 会由 macOS 自动重新拉起。可用下列命令确认应用包可被 LaunchServices 正常解析：

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -lint app/src-tauri/target/release/bundle/macos/Antler.app
```

如果验证签名时提示 `code has no resources but signature indicates they must be present`，可为本机开发构建重新进行 ad-hoc 签名：

```bash
codesign --force --deep --sign - app/src-tauri/target/release/bundle/macos/Antler.app
codesign --verify --deep --strict --verbose=2 app/src-tauri/target/release/bundle/macos/Antler.app
```

正式分发时应使用 Developer ID 证书签名并完成公证，不能使用 ad-hoc 签名。
