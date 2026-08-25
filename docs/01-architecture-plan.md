# AI Agent 项目架构规划

> 状态：**已收敛（第一版）**
> 已确认：Node.js 以本地伴生服务运行；前端与服务端采用 HTTP（REST）+ SSE 通信。

---

## 1. 项目定位

### 已确认：B 型（自主型 Agent）

项目以能调用工具、进行多步规划并执行任务的自主型 Agent 为核心。对话能力是其基础交互形态；架构需支持任务状态、工具调用和过程进度的流式反馈。

---

## 2. 技术栈总览（已定）

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | **Tauri 2 + React + TypeScript** | 桌面壳，可打包 mac/win/linux |
| UI | Tailwind CSS（建议） | 复用 React 生态 |
| 后端业务 | **Node.js 本地伴生服务** | 由 Tauri 拉起并随桌面应用生命周期运行 |
| 后端语言 | TypeScript（建议） | 与前端共享类型定义 |

---

## 3. 架构：Tauri 与 Node.js 的职责边界

### 已确认：Node.js 作为本地伴生服务

Node.js 与 Tauri 一起打包。应用启动时由 Tauri Rust 壳拉起服务，应用退出时负责回收；Node.js 承担业务 API、Agent 编排和 LLM 调用，Rust 保持薄，只处理系统级能力（进程管理、文件权限、托盘、通知等）。

该方案带来：
- 后端可独立测试（`node:test` / vitest），不依赖 GUI。
- 前后端通过统一的 HTTP + SSE 接口通信；如未来需要云端部署，可迁移服务部署位置而不改变主要协议。
- 默认仅监听 loopback 地址，并使用由 Tauri 注入的随机令牌或一次性会话令牌校验请求，避免本机其他进程访问服务。

---

## 4. 通信方式

### 已确认：HTTP（REST）+ SSE（流式推送）

- REST：会话/配置/CRUD
- SSE：LLM 流式输出、任务进度推送
- WebSocket 仅在需要客户端主动推大量事件时再引入（多数场景 SSE 足够）

```
Tauri（React）
   │  HTTP / SSE
   ▼
Node.js 本地伴生服务（业务 / Agent 编排 / LLM 调用）
   │
   ▼
LLM Providers (OpenAI / Anthropic / Ollama ...)
```

---

## 5. Monorepo 目录结构（建议）

```
antler/
├── docs/               # 规划与设计文档
├── app/                # Tauri + React 前端
│   ├── src/            # React 源码
│   ├── src-tauri/      # Rust 壳
│   └── package.json
├── server/             # Node.js 后端
│   ├── src/
│   └── package.json
├── packages/           # 共享 (可选：类型、协议定义)
└── package.json        # 根 workspace
```

@ 用 pnpm workspace（或 npm workspaces）组织 monorepo，共享 TS 类型包 `packages/shared`。

---

## 6. 关键技术选型（@ 待确认）

| 关注点 | 建议 | 说明 |
|---|---|---|
| LLM SDK | Vercel AI SDK 或 node-openai | 支持多 provider 抽象 + 流式 |
| 工具调用 | Function Calling / Tool use | 依赖具体 provider SDK |
| 数据库 | 本地 SQLite（better-sqlite3）/ 远端 PG | 取决于后端形态 |
| 会话存储 | SQLite + 向量（可选） | 记忆/检索增强 |
| 鉴权（若远端） | JWT + 中间件 | |
| 配置 | 环境变量 + dotenv | LLM key 管理 |

---

## 7. 建议实现阶段（Milestones）

以下阶段以已确认的本地伴生服务和 HTTP + SSE 链路为基础：

1. **M0 骨架**：✅ 已完成。初始化 monorepo + Tauri + React + Node 服务，打通 HTTP/SSE 最小链路，并实现 loopback + 会话令牌保护。
2. **M1 对话**：单会话流式对话，接入一个 LLM provider。
3. **M2 会话管理**：历史持久化、会话列表、清空/删除。
4. **M3 工具调用**：Function Calling，至少 1-2 个真实工具（如 shell、读写文件、HTTP fetch）。
5. **M4 Agent 编排**：多步规划、任务状态机、进度推送。
6. **M5 打磨**：打包分发（dmg/nsis/deb/appimage）、错误处理、设置页。

---

## 8. 待你确认的问题清单

- [x] **Q1** Agent 定位：B 型（自主型 Agent）
- [x] **Q2** 后端形态：Node.js 本地伴生服务，由 Tauri 拉起和回收
- [ ] **Q3** LLM provider 与模型（以及是否需多 provider 切换）
- [x] **Q4** 通信协议：HTTP（REST）+ SSE（流式推送）
- [ ] **Q5** 数据库选型（本地 SQLite / 远端 PG）
- [ ] **Q6** 是否需要用户系统/鉴权
- [ ] **Q7** 目标平台（mac 全都有？要不要 Windows/Linux）
- [ ] **Q8** 包管理器偏好（pnpm / npm / yarn）

---

## 9. 前置准备（待你确认后再做的安装）

- 安装 `@tauri-apps/cli`（当前未装）
- Rust 1.95 / Node 24 ✅ 已具备
- 初始化 Tauri 项目（`npm create tauri-app`）与 Node 服务骨架
