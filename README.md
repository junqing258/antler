# Antler

桌面自主型 Agent 的 M0 骨架。Tauri/React 前端通过 HTTP（REST）创建任务，通过 SSE 接收流式输出；Node.js 服务仅监听 `127.0.0.1`，由 Tauri 在桌面模式下启动、退出时回收。Tauri 开发模式依赖系统已安装的 Node.js；正式分发前需将 Node 运行时与服务入口构建为对应平台的 sidecar 二进制。

## 开发

```bash
pnpm install
pnpm dev:server # 浏览器模式下的本地服务
pnpm dev:app    # 浏览器模式下的 React 前端
# 或在 app/ 中执行 pnpm tauri dev，体验 Tauri 拉起 Node 伴生服务
```

当前服务流返回确定性的占位响应，待 Q3（LLM provider 与模型）收敛后替换为真实 Agent 编排和模型调用。

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
