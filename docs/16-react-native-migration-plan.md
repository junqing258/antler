# 移除 assistant-ui 与 Tauri 的 React Native / Web 渐进迁移规划

状态：待实施。本文只记录规划，没有修改运行代码或依赖。

## 1. 目标与默认范围

先建立 Antler 自己的聊天模型和状态管理，再用 React Native 组件替换聊天界面，通过 React Native Web 在现有 Web/PWA 中交付，最后逐页扩展并完成 iOS/Android 客户端。

保留现有 Vite、PWA 和 Fastify 后端入口；移动端建议新增 Expo 入口。本次迁移移除 Tauri 桌面壳、伴生服务启动链路及相关依赖，桌面用户通过浏览器或安装 PWA 使用。React Native Web 仍经 React DOM 渲染；React Native macOS/Windows 不包含在本次迁移内。

后端会话、Run、事件和数据库继续作为权威数据源。UI 技术迁移不要求变更持久化 schema、重写 Agent runtime 或增加一套移动端专用协议。

完成目标分成两个里程碑：M1 为彻底移除 `@assistant-ui/*` 和 Tauri 并交付共享聊天界面；M2 为主要页面完成 RN/RNW 迁移，iOS/Android 原生客户端通过验收。

## 2. 当前代码依据

| 位置 | 当前耦合 | 迁移处理 |
| --- | --- | --- |
| `app/package.json` | React 18.3.1；依赖 `@assistant-ui/react`、`@assistant-ui/react-markdown` | 先核对目标 React/RN/RNW/Expo 版本矩阵，M1 删除两个依赖 |
| `app/src/components/assistant-ui/use-antler-runtime.ts` | `useExternalStoreRuntime` 包含发送、停止、事件订阅、分页、模型绑定和上下文可用性判断；直接使用 document | 抽成独立 session/controller 与 React 订阅层；旧 runtime 只暂时做适配 |
| `app/src/lib/run-events.ts` | 用 `ThreadMessageLike` 做增量归并、事件去重与快照水位比较；fetch reader 解析 SSE | 消息类型迁入领域层；事件归并与网络传输分离 |
| `app/src/lib/conversation-store.ts` | 历史消息及 DTO 转换依赖 `ThreadMessageLike`；维护会话变更流、revision 和账号会话隔离 | 保留协议语义，输出自有消息模型，注入网络和认证能力 |
| `app/src/components/assistant-ui/thread.tsx` | Thread/Message/Composer/ActionBar primitives、Markdown、Radix 菜单、DOM details、Tailwind 样式 | 替换为自有聊天组件、平台 Markdown/菜单/输入组件 |
| `app/src/components/assistant-ui/slash-command-input.tsx` | composer store、textarea ref、DOM 键盘与 IME 事件 | 提取命令匹配/填充逻辑；输入交互按平台实现 |
| `app/src/views/chat/{chat,index}.tsx` | Provider、消息类型和 runtime 接入 | 改接共享 session 和聊天组件 |
| `app/src/lib/server-info.ts`、`provider-config.ts` | Tauri invoke、window、Vite 环境变量、localStorage/浏览器事件 | 删除 Tauri invoke 分支；其余能力移入宿主平台适配层，统一异步配置初始化 |
| `app/src-tauri/`、根与 app 的 package scripts、知识库链接及 PWA 环境判断 | 桌面壳、伴生服务启动、Tauri API/CLI/opener 依赖及桌面专属分支 | P2 退役桌面壳与构建链路；链接改用浏览器能力，移除对应判断和测试 mocks |
| `app/src/main.tsx`、`components/ui/`、其余 views | BrowserRouter、DOM、Radix/Base UI 和 Web 样式 | 保留 Web 壳，按页面逐步替换；不直接带入 native 依赖图 |
| `app/test/` | runtime、run-events、slash commands、模型选择、会话归属等已有测试 | 迁移行为断言，逐步移除 assistant-ui mocks 与 fixture 类型 |

消息服务端存储与同步约束沿用 `docs/14-server-conversation-storage-plan.md` 的已实施能力，以当前代码为准，不将该文档的历史现状描述当成当前实现。

## 3. 推荐目标结构

```text
app/                         现有 Web / PWA 宿主，继续使用 Vite
mobile/                      后续 Expo / Metro 原生宿主
packages/
  chat-core/                 纯 TypeScript：消息、事件 reducer、快照合并、命令逻辑
  client-runtime/            API client、会话 controller/store、React hooks
  platform/                  平台接口；web/native 实现与宿主注入边界
  ui/                        RN 基础组件、tokens、聊天组件、逐步迁入的页面
backend/                     保留现有后端
```

`pnpm-workspace.yaml` 已包含 `packages/*`，实际提取时创建目录；新增原生入口时再把 `mobile` 加入 workspace。

依赖方向为宿主 → UI / client-runtime → chat-core；client-runtime 使用平台接口；平台实现由宿主注入。chat-core 不依赖 React、DOM、RN 或 UI 库。共享包不能反向 import `app/src`。

共享包的 React 使用 peer dependency，宿主锁定兼容版本，确保每个应用运行时只加载一份 React。Vite、Metro、TypeScript 和测试工具对包入口与平台扩展名采用一致规则；不得让 native 打包器解析到 Web 专属依赖。

### 消息与状态边界

- 定义 `ChatMessage`、`MessagePart`、`MessageStatus`、`ConversationSnapshot`，覆盖 text、reasoning、tool-call、工具结果及错误，并显式保留 runId、seq、appliedEventId 等信息。
- 服务端 DTO、领域模型、UI props 分层转换；本次不要求服务端内容存储格式随前端更名。领域类型不能只是 assistant-ui 类型的 re-export 或强制断言。
- `ChatSession` 负责 messages、revision、activeRunId、发送确认、网络状态、分页和上下文可用性；按账号/服务端/会话隔离实例并提供明确销毁生命周期。
- session 暴露 send/cancel/loadEarlier/refresh；输入草稿和命令浮层属于 UI 状态。可使用已有 Zustand 做订阅，但单个会话只有一个业务状态源。
- 过渡期旧 assistant-ui adapter 消费同一个 session，不再并行维护一套发送和 SSE 逻辑。新旧界面切换时不同时挂载两个 controller。

### 平台能力边界

| 能力 | Web / PWA | Native |
| --- | --- | --- |
| 服务地址与凭据 | 浏览器配置或同源 API；本地开发可连接独立启动的后端 | 可达的远程服务配置；不能把手机 127.0.0.1 当成开发电脑 |
| 网络与 SSE | 现有 fetch/stream 行为，经适配层封装 | 在所选 SDK 验证流式 fetch；必要时显式使用 Expo 提供的 fetch |
| 会话/普通配置存储 | 包装现有 localStorage，保持已有 key 和配置可读 | 异步本地存储；启动先完成 hydration 再创建 session |
| Token/API Key 存储 | 延续已有行为并封装 | 使用适合凭据的安全存储，和普通配置分开 |
| 前后台与网络恢复 | visibilitychange 等浏览器实现 | AppState 与网络状态；回前台恢复订阅并校验权威快照 |
| 复制、链接、文件能力 | 浏览器 API | 对应 native API；仅暴露平台实际支持的能力 |
| 导航 | 暂保留 React Router | Expo Router 或原生导航壳；共享页面通过意图回调导航 |

小差异使用 Platform；大差异使用 `.web.tsx` / `.native.tsx`。桌面浏览器和 PWA 都使用 web 实现；iOS/Android 使用 native 实现。

Markdown 使用独立 props 边界：Web 可采用 DOM Markdown renderer，native 使用经验证的原生 renderer，共享内容规范和测试样例。代码块、GFM 表格、链接、长文本选择及流式未闭合语法都要验证。

新共享组件默认采用 RN `StyleSheet` 与共享 tokens；旧页面的 Tailwind/CSS 在页面切换时再清理。Radix、Base UI、lucide-react 等可暂留 Web 壳，跨平台组件需封装或替换，不能直接假设可在 RN 使用。

## 4. 分阶段实施与验收

### P0：兼容性验证与行为基线

交付：记录目标版本组合、当前行为矩阵，以及最小 RNW 页面和原生验证入口。验证分支可以做实验，合并到主线的依赖升级应独立、可回退。

1. 运行现有 check/test，记录现有失败；核对 React/RN/RNW/Expo、TypeScript、Vite 与 Metro 的 peer dependencies。当前 React 18 不作为目标版本的默认前提；如需升级 React/类型，单独提交并验证旧界面。
2. 在现有 Vite 页面验证 View/Text/Pressable/TextInput、主题、字体、尺寸和 Web/PWA 构建；配置精确的 `react-native` → `react-native-web` alias 及平台文件解析，不对 RN 内部路径做宽泛替换。
3. 提前用同一拟定依赖矩阵验证 native：带鉴权头 SSE、增量到达、中文解码、Abort、断线续传、Token 刷新和前后台恢复。真实移动设备验证服务地址可达。
4. 盘点可用功能与占位入口。当前 UI 有重新生成按钮，但自定义 runtime 没有提供 onReload；附件按钮也没有实际动作。确认实际能力后用 capability 控制显隐/禁用，不把占位按钮当作已实现契约。

验收：版本矩阵可安装、Web/RNW 与 native 最小入口可运行；没有新增重复 React；两端流式传输实测通过。无需在此阶段迁移全部页面。

### P1：提取聊天领域模型与独立 session

交付：chat-core 与最小 client-runtime；旧界面通过临时 adapter 接入，外观保持现有基线。

1. 从 run-events 和 conversation-store 提取领域消息模型、DTO 映射、事件 reducer、快照合并与命令表。
2. 从 useAntlerRuntime 提取发送、幂等重试、停止、运行恢复、分页、模型绑定和上下文禁用逻辑。adapter 只在展示边界转换消息并桥接 assistant-ui。
3. 迁移现有测试到领域/session 边界，保留模型选择、会话归属和账号隔离断言。

验收：chat-core/client-runtime 无 assistant-ui 类型泄漏；旧界面完整工作；重复事件不重复追加，低水位快照不擦除 live 内容；发送重试复用同一 clientRequestId 与请求体。

### P2：平台接口、移除 Tauri 与 RN/RNW 组件基础

交付：platform 与 ui 的最小实现，包含 Button/Input/Menu/Disclosure/MessageRenderer 的接口和 tokens；完成 Tauri 退役，Web/PWA 与后端可独立运行和构建。

1. 注入网络、认证、配置、前后台、UUID、剪贴板和链接能力；统一服务配置读取与异步初始化。
2. 将 document/window/localStorage/import.meta.env 从共享业务层移到宿主或平台实现；同时拆分 conversation changes 与 Run SSE 的传输和解析，保留各自独立游标。
3. 实现 Web Markdown 和输入框平台边界；先验证中文 IME、Enter/Shift+Enter、命令菜单、焦点、Tab/Escape 和复制。
4. native 复用相同 session 跑通最小聊天闭环，尽早验证存储 hydration、登录和流式回复。
5. 删除 `app/src-tauri/`、`@tauri-apps/*` 依赖、Tauri 专属 API 分支与测试 mocks；知识库链接使用浏览器打开，清理 PWA 中的桌面壳排除判断。移除根 `dev:app`、`build:app` 与 app 的 `tauri` script，提供明确的 Web 与后端构建命令，更新 lockfile、开发/部署说明及相关构建配置。
6. 明确原桌面端用户转用 Web/PWA 时的服务地址与登录方式。浏览器不自动继承 WebView 的模型配置和凭据，需提供重新配置说明；保留已有后端数据，退役任务不删除数据库或服务端文件。本地开发仍可独立启动 Fastify 后端，发布客户端连接统一远程后端。

验收：共享业务包不访问 DOM；运行代码、manifest、解析后的依赖图与构建链路不再依赖 Tauri；Web/PWA 可独立启动、构建并访问后端，知识库链接与 PWA 更新功能通过回归。Web 与 native 能用同一 session 发送并恢复运行；配置未加载时不误发送到默认服务或默认模型。

### P3：切换聊天视图并彻底移除 assistant-ui（M1）

交付：共享 ChatScreen、MessageList、MessageBubble、Composer、ReasoningBlock、ToolCallBlock、ModelPicker；Web/PWA 默认启用。

1. 用 RN primitives 构建界面；Markdown、菜单和输入框走平台实现。保持欢迎页、等待态、错误态、发送/停止、命令、历史分页及模型切换语义。
2. 显式实现列表自动滚动：用户在底部才跟随增量；向上阅读时保留位置；加载更早消息保留锚点；折叠思考/工具块和软键盘变化不能导致内容跳动。
3. 通过开发开关短暂比较新旧视图，确保一次只挂载一种实现。M1 合并时删除旧视图、adapter 和开关，避免为了回滚继续保留 assistant-ui。
4. 移除两个 package dependency、Provider、primitives、类型导入、测试 mocks 和旧目录；清理相关 aui 样式及 Vite 中绑定旧 runtime 路径的刷新插件，是否保留通用刷新行为按新实现实际需要判断。
5. 更新 lockfile，检查整个 workspace 依赖树和运行构建产物；历史设计文档允许保留对旧实现的描述。

验收：运行代码、类型、测试、manifest 与解析后的依赖图均不依赖 `@assistant-ui/*`；Tauri 退役验收已完成；Web/PWA 通过聊天行为回归；native 共用新聊天组件完成发送/停止/恢复冒烟。

### P4：按页面切换其余前端

交付顺序：会话侧栏与导航布局 → 登录/注册/找回密码 → 设置与模型配置 → Agent 列表/详情/编辑 → Skill 与定时任务等剩余页面。

每次只切换一个可验收的页面或功能域；页面使用共享组件，路由和 PWA 更新提示留在对应壳中。复杂编辑或平台专有能力通过平台组件实现，并明确移动端支持范围。

验收：每页通过已有用户行为测试、桌面与窄屏视觉核查、键盘焦点及无障碍核查后删除旧实现。最后清理不再使用的 Radix/Base UI、DOM 图标与样式依赖；Web 专用 renderer 仍需要的依赖按实际用途保留。

### P5：原生产品完善与发布验收（M2）

交付：iOS/Android 入口、导航、登录与配置恢复、完整共享页面、构建和测试流程。

- 完善 safe area、软键盘避让、长按复制、返回导航、横竖屏、长列表性能和系统字体适配。
- 验证登录刷新/退出、密码恢复、深链（如实际采用）、前后台切换和弱网；后台不保证持续接收 SSE，前台必须能从服务端恢复。
- Web/PWA 和移动端发布客户端连接统一远程后端；本机目录路径属于后端执行环境，不能映射成手机文件路径。移动端附件上传另列需求。
- 为 mobile 加入 workspace scripts 与 CI；原生构建验证不能只依赖 Web 的 jsdom 测试。

验收：同账号、同服务端在 Web/PWA/iOS/Android 查看和续聊同一会话，生成中切端可恢复；切账号立即停止旧订阅并丢弃迟到响应。

## 5. 必须保持的行为契约

1. 服务端历史是权威源；revision、changeId 与每个 run 的 appliedEventId 作用独立，不能合并成一个游标。
2. 发送待确认时，重试相同请求；并发发送、revision 冲突和上下文不可恢复时显示明确状态，不偷偷创建重复运行。
3. 切换页面或销毁订阅不会取消服务端 Run，只有显式停止才请求 cancel。
4. 用户正在阅读历史时不强行滚到底部；分页不遗漏、不重复、不丢当前内容。
5. 旧会话使用绑定的执行配置；切换模型按现有规则新建会话，不改变历史会话语义。
6. 账号/服务端切换清空所属状态和订阅，旧请求、旧 Token 和旧消息不能流入新 session。
7. Markdown、思考内容、工具调用、工具错误与运行终态在历史回放和 live 显示中一致；保留未来未知内容类型的可控降级边界。

## 6. 验证与回退

每个可合并阶段运行 `pnpm check` 和 `pnpm test`，并运行受影响的 Web 构建；P0/P2/P3/P4 触及界面时做实际页面与响应式视觉核查。P2 验证 Tauri 退役后的 Web/PWA 启动、生产构建与独立后端连接；原生入口建立后增加对应类型检查、组件行为测试和设备构建/冒烟。共享包落地时同步调整根 check/test，确保 workspace 新包不会被现有两个 filter 漏掉。

复用并迁移当前 run-events、conversation-store、use-antler-runtime、slash-command-input、chat-model-selection、chat-ownership、auth 等测试。补充测试只覆盖提取/平台切换带来的实际风险，重点是发送幂等、流式分片/重复/重连、快照竞争、账号隔离、IME 和滚动锚点。

建立固定数据集：长会话、长代码块/GFM 表格、连续 thinking/text/tool、空输出等待、403/失败/取消、断网后完成、分页期间仍在生成。记录基线与迁移后的交互表现；性能阈值由 P0 测量确定，不先承诺没有依据的百分比。

按阶段或页面形成独立 PR，schema 和 API 保持兼容。M1 前可用临时开关回到旧视图；M1 删除依赖之后，通过回退完整 PR/发布版本回滚，不保留隐式运行时兜底。PWA 发布还需验证缓存更新和旧客户端与现有 API 的兼容。

## 7. 首批可执行任务

1. P0：兼容矩阵、基线测试、RNW/native 流式验证；如需要，单独完成 React 升级。
2. P1a：创建 chat-core，自有消息模型与 reducer/DTO 迁移，旧 UI 通过 adapter 保持可用。
3. P1b：提取 ChatSession，迁移发送、停止、订阅和分页测试。
4. P2：平台接口、Tauri 壳与依赖退役、独立 Web/后端构建、RN 基础组件和最小原生聊天验证。
5. P3a：新聊天视图完成并对比验收。
6. P3b：删除 assistant-ui、旧适配层和依赖，确认 Tauri 退役已完成，达成 M1。
7. 按 P4 页面顺序交付，再完成 P5 原生产品验收。

首批完成标准是 P0 验证结果和 P1 的可运行提取，不把“换包成功”视为迁移完成。暂不承诺日历工期，P0 后根据 renderer、输入法、流式网络和依赖兼容性的实测工作量估算。

## 8. 技术依据

- [React Native Web 安装与增量接入](https://necolas.github.io/react-native-web/docs/installation/)：支持在现有 React Web 应用中渐进采用。
- [React Native Web 构建配置](https://necolas.github.io/react-native-web/docs/setup/)：说明 react-native alias 和 Web 构建边界。
- [React Native 平台差异](https://reactnative.dev/docs/platform-specific-code)：支持 Platform 与平台文件组织方式。
- [Expo SDK 版本参考](https://docs.expo.dev/versions/latest/)：实施时按 SDK 对齐 React、RN、RNW 和运行环境版本。
- [Expo monorepo 指南](https://docs.expo.dev/guides/monorepos/)：用于配置 workspace、Metro 和依赖去重。
- [Expo 流式 fetch](https://docs.expo.dev/versions/latest/sdk/expo/#fetch)：用于验证原生流式传输方案，最终以选定 SDK 的文档与设备实测为准。
