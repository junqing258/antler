# 移除 assistant-ui 的 React Native / Web 渐进迁移规划

> 当前工作区的实施进度、验证范围与后续顺序见 [迁移进度与后续计划](16-react-native-migration-progress.md)。本文的现状描述保留方案制定时的基线。

状态：Tauri 退役已完成；assistant-ui 解耦与 RN/RNW 迁移待实施。更新日期：2026-10-31。

Tauri 清理已随 `cfc21a7`（`refactor： 移除 tauri`）合入，作为后续迁移的现有基线，不再列入 P2 待办。本文其余阶段仍是规划，不代表共享包或原生客户端已经实现。

## 1. 目标与默认范围

先建立 Antler 自己的聊天模型和状态管理，再用 React Native 组件替换聊天界面，通过 React Native Web 在现有 Web/PWA 中交付，最后逐页扩展并完成 iOS/Android 客户端。

保留现有 Vite、PWA 和 Fastify 后端入口；移动端建议新增 Expo 入口。Tauri 桌面壳、伴生服务启动链路及相关依赖已移除，桌面用户通过浏览器或安装 PWA 使用。React Native Web 仍经 React DOM 渲染；React Native macOS/Windows 不包含在本次迁移内。

后端会话、Run、事件和数据库继续作为权威数据源。UI 技术迁移不要求变更持久化 schema、重写 Agent runtime 或增加一套移动端专用协议。

剩余目标分成两个里程碑：M1 为彻底移除 `@assistant-ui/*` 并交付共享聊天界面；M2 为主要页面完成 RN/RNW 迁移，iOS/Android 原生客户端通过验收。

结合 Orca 移动端源码调研，本方案采用自有消息模型、独立 session/controller、自建 RN/RNW 聊天组件。默认交付路径为浏览器直接运行 RNW、Expo 客户端直接渲染 RN 组件；Orca 当前使用的原生壳内运行 RNW 页面、动态下载页面 bundle 和 bridge RPC 的混合架构作为参考，另见第 9 节。

## 2. 当前状态与代码依据

### 已完成的前置清理

- 已删除 `app/src-tauri/`，包括 Rust 工程、桌面配置、权限定义、生成 schema 和专用图标。
- 已移除 `@tauri-apps/api`、`@tauri-apps/plugin-opener`、`@tauri-apps/cli` 及 lockfile 中对应依赖；根 `dev:app`、`build:app` 和 app 的 `tauri` script 已删除。
- `server-info.ts` 已移除 invoke 分支，保留 Web 的后端地址、local 共享令牌和 Supabase 会话逻辑；知识库链接使用浏览器标准外链；PWA 已移除桌面壳排除判断，对应测试 mocks 已清理。
- 已提供 `pnpm build`、`pnpm build:web`、`pnpm build:server`；开发仍使用 `pnpm dev`、`pnpm dev:web`、`pnpm dev:server`。README、开发约定、编辑器配置及架构图已同步，旧设计中的桌面方案已标注退役。

当前运行代码、依赖清单、lockfile 和构建链路不再依赖 Tauri。`@assistant-ui/*` 与现有聊天组件仍保留；`packages/chat-core`、`client-runtime`、`platform`、`ui` 和 `mobile/` 尚未创建。

### 剩余迁移涉及的代码

| 位置 | 当前耦合 | 迁移处理 |
| --- | --- | --- |
| `app/package.json` | React 18.3.1；依赖 `@assistant-ui/react`、`@assistant-ui/react-markdown` | 先核对目标 React/RN/RNW/Expo 版本矩阵，M1 删除两个依赖 |
| `app/src/components/assistant-ui/use-antler-runtime.ts` | `useExternalStoreRuntime` 包含发送、停止、事件订阅、分页、模型绑定和上下文可用性判断；直接使用 document | 抽成独立 session/controller 与 React 订阅层；旧 runtime 只暂时做适配 |
| `app/src/lib/run-events.ts` | 用 `ThreadMessageLike` 做增量归并、事件去重与快照水位比较；fetch reader 解析 SSE | 消息类型迁入领域层；事件归并与网络传输分离 |
| `app/src/lib/conversation-store.ts` | 历史消息及 DTO 转换依赖 `ThreadMessageLike`；维护会话变更流、revision 和账号会话隔离 | 保留协议语义，输出自有消息模型，注入网络和认证能力 |
| `app/src/components/assistant-ui/thread.tsx` | Thread/Message/Composer/ActionBar primitives、Markdown、Radix 菜单、DOM details、Tailwind 样式 | 替换为自有聊天组件、平台 Markdown/菜单/输入组件 |
| `app/src/components/assistant-ui/slash-command-input.tsx` | composer store、textarea ref、DOM 键盘与 IME 事件 | 提取命令匹配/填充逻辑；输入交互按平台实现 |
| `app/src/views/chat/{chat,index}.tsx` | Provider、消息类型和 runtime 接入 | 改接共享 session 和聊天组件 |
| `app/src/lib/server-info.ts`、`provider-config.ts` | Vite 环境变量、Supabase 会话、localStorage/浏览器事件 | 将配置、认证和存储能力移入宿主平台适配层，统一异步配置初始化 |
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

### assistant-ui 的具体替代方案

替代由领域、会话和展示三层共同完成，不另选一个聊天 UI 框架承接全部职责。

| 现有能力 | 目标实现 | 选型状态 |
| --- | --- | --- |
| `ThreadMessageLike` 等消息类型 | chat-core 自有 `ChatMessage`、`MessagePart`、`MessageStatus` 与 DTO 转换 | 确定边界，P1 实施 |
| `useExternalStoreRuntime`、Provider | client-runtime 的 `ChatSession`、controller 与 React hooks；默认用 `useSyncExternalStore` 订阅 session；可选使用已声明但当前未使用的 zustand 依赖 | 确定单一业务状态源，P1 决定订阅实现并清理未选依赖 |
| Thread/Message primitives | ui 自建 ChatScreen、MessageList、MessageBubble、ReasoningBlock、ToolCallBlock | 确定使用 RN primitives，P3 实施 |
| Composer、ActionBar primitives | 自建 Composer、命令菜单、复制和停止动作；实际支持的能力由 capability 决定 | P2 验证输入与平台能力，P3 切换 |
| `@assistant-ui/react-markdown` | 独立 MessageMarkdown 接口；优先验证 `markdown-it` 解析、自建 RN block/inline renderer，并经 RNW 复用到 Web；DOM renderer 可作为 Web 平台实现 | 候选方案，P0 实测后确定 |
| 菜单、折叠块、模型选择器 | 自建 Menu/Disclosure/ModelPicker，使用 RN 组件并按平台拆分交互 | P2 建立基础，P3 接入 |

Markdown 候选参考 Orca 的 `markdown-it`、中文友好/脚注插件、树结构转换和 RN 渲染链路；`remend` 可用于流式未闭合语法处理，代码高亮候选为 `lowlight`。这些库只承担解析或展示，不负责 Run 状态、网络订阅或消息持久化。P0 通过后记录最终依赖及验证结果；不预先承诺直接复制 Orca 的全部 renderer。

### 消息与状态边界

- 定义 `ChatMessage`、`MessagePart`、`MessageStatus`、`ConversationSnapshot`，覆盖 text、reasoning、tool-call、工具结果及错误，并显式保留 runId、seq、appliedEventId 等信息。
- 服务端 DTO、领域模型、UI props 分层转换；本次不要求服务端内容存储格式随前端更名。领域类型不能只是 assistant-ui 类型的 re-export 或强制断言。
- `ChatSession` 负责 messages、revision、activeRunId、发送确认、网络状态、分页和上下文可用性；按账号/服务端/会话隔离实例并提供明确销毁生命周期。
- session 暴露 send/cancel/loadEarlier/refresh；输入草稿和命令浮层属于 UI 状态。默认用 `useSyncExternalStore` 订阅同一 session，单个会话只有一个业务状态源。`app/package.json` 已声明 `zustand`（`^5.0.15`），但当前 `app/src` 与 `backend/src` 均未使用；它仅是可选依赖，不代表现有状态管理实现。P1 记录订阅实现决策；若不采用 zustand，确认 workspace 无其他用途后移除该声明并更新 lockfile。
- 过渡期旧 assistant-ui adapter 消费同一个 session，不再并行维护一套发送和 SSE 逻辑。新旧界面切换时不同时挂载两个 controller。

### 平台能力边界

| 能力 | Web / PWA | Native |
| --- | --- | --- |
| 服务地址与凭据 | 浏览器配置或同源 API；本地开发可连接独立启动的后端 | 发布客户端连接 HTTPS 后端；开发地址需真机可达，不能把手机 127.0.0.1 当成开发电脑；HTTP 例外仅限开发构建 |
| 网络与 SSE | 现有 fetch/stream 行为，经适配层封装 | 在所选 SDK 验证流式 fetch；必要时显式使用 Expo 提供的 fetch |
| 会话/普通配置存储 | 包装现有 localStorage，保持已有 key 和配置可读 | 优先验证 AsyncStorage；启动先完成 hydration 再创建 session |
| Token/API Key 存储 | 延续已有行为并封装 | 优先验证 Expo SecureStore，和普通配置分开 |
| 前后台与网络恢复 | visibilitychange 等浏览器实现 | AppState 与网络状态；回前台恢复订阅并校验权威快照 |
| 复制、链接、文件能力 | 浏览器 API | 对应 native API；仅暴露平台实际支持的能力 |
| 导航 | 暂保留 React Router | 默认 Expo Router；共享页面通过意图回调导航 |

小差异使用 Platform；大差异使用 `.web.tsx` / `.native.tsx`。桌面浏览器和 PWA 都使用 web 实现；iOS/Android 使用 native 实现。

Markdown 使用独立 props 边界，默认先验证上述 RN renderer 能否经 RNW 复用；需要 DOM 的 Web 实现通过平台文件隔离，两端共享内容规范和测试样例。代码块、GFM 表格、链接、长文本选择及流式未闭合语法都要验证。流式补全只作用于展示输入，不改写服务端内容或领域消息；代码块、表格和正文选择应分别验证。Mermaid、富文本编辑等扩展能力按产品需求单列，不因参考项目使用 WebView 就纳入聊天迁移。

新共享组件默认采用 RN `StyleSheet` 与共享 tokens；旧页面的 Tailwind/CSS 在页面切换时再清理。Radix、Base UI、lucide-react 等可暂留 Web 壳，跨平台组件需封装或替换，不能直接假设可在 RN 使用。

## 4. 分阶段实施与验收

### P0：兼容性验证与行为基线

交付：记录目标版本组合、当前行为矩阵，以及最小 RNW 页面和原生验证入口。验证分支可以做实验，合并到主线的依赖升级应独立、可回退。

1. 运行现有 check/test，记录现有失败；先按移动端需求选择 Expo/RN/RNW 组合，以该组合的 peer dependencies 为锚确定 React/React DOM、类型包、TypeScript、Vite 与 Metro 的兼容矩阵。React 升级是目标 RN/RNW 选型的下游结论，当前 React 18 不作为约束；若目标矩阵要求 React 19，必须在共享 RN 组件经 RNW 合入 Web 主线前，独立完成 Web 宿主 React/React DOM 与类型包升级并验证旧 assistant-ui 界面。P0 内完成版本决策和所需升级，不留到 P2/P3 再调整 React 主版本；第 9 节的 Orca 版本仅作参考，实际要求以所选版本的包元数据为准。
2. 在现有 Vite 页面验证 View/Text/Pressable/TextInput、主题、字体、尺寸和 Web/PWA 构建；配置精确的 `react-native` → `react-native-web` alias 及平台文件解析，不对 RN 内部路径做宽泛替换。
3. 提前用同一拟定依赖矩阵验证 native：带鉴权头 SSE、增量到达、中文解码、Abort、断线续传、Token 刷新和前后台恢复。明确生产 HTTPS 后端地址，并在真实移动设备验证 API 与 SSE；README 当前的 HTTP 演示地址不能直接作为原生发布验收地址。若本地开发需要 HTTP，在开发构建中配置必要的 iOS ATS / Android 明文流量例外，并确认发布构建不携带这些例外。除 Expo Go / 开发构建验证外，P0 的 iOS/Android 最小入口也需用独立 Release 构建验证 HTTPS API 与带鉴权头 SSE。
4. 盘点可用功能与占位入口。当前 UI 有重新生成按钮，但自定义 runtime 没有提供 onReload；附件按钮也没有实际动作。确认实际能力后用 capability 控制显隐/禁用，不把占位按钮当作已实现契约。
5. 用固定样例验证 Markdown 候选链路：`markdown-it`、中文强调/脚注、GFM 表格、代码高亮、`remend` 流式补全与 RN/RNW 渲染。对比正文选择、链接处理、流式重解析和长回复开销，决定共享 renderer 与平台实现的范围。
6. 验证原生 FlatList 和 RNW 列表在长会话、历史前插、增量文本、折叠块与软键盘下的行为。允许列表和输入框分别使用平台实现，不以两端组件树完全一致作为验收条件。

验收：版本矩阵可安装、Web/RNW 与 native 最小入口可运行；所需 React/React DOM 与类型包升级已完成并通过旧界面回归，没有新增重复 React；两端流式传输实测通过，iOS/Android 独立 Release 构建均可访问目标 HTTPS 后端的 API 与鉴权 SSE；记录 Markdown、列表和输入的平台差异及最终选型。无需在此阶段迁移全部页面。

### P1：提取聊天领域模型与独立 session

交付：chat-core 与最小 client-runtime；旧界面通过临时 adapter 接入，外观保持现有基线。

1. 从 run-events 和 conversation-store 提取领域消息模型、DTO 映射、事件 reducer、快照合并与命令表。
2. 从 useAntlerRuntime 提取发送、幂等重试、停止、运行恢复、分页、模型绑定和上下文禁用逻辑。adapter 只在展示边界转换消息并桥接 assistant-ui。
3. 迁移现有测试到领域/session 边界，保留模型选择、会话归属和账号隔离断言。
4. 记录 session 订阅实现的选择及原因；若不采用 zustand，确认 workspace 无其他用途后移除未使用依赖并更新 lockfile。
5. 首个共享包落地时同步调整 `backend/Dockerfile`：当前镜像只复制 app/backend，需在 `pnpm install --frozen-lockfile` 前复制所需共享包的 manifest，在构建前复制其源码，并按依赖顺序构建宿主需要的包。以仓库根目录为构建上下文，确保 `workspace:*` 依赖在镜像内可解析；若后端运行时依赖共享包，最终镜像也需包含对应产物及可解析的 workspace 链接。

验收：chat-core/client-runtime 无 assistant-ui 类型泄漏；旧界面完整工作；重复事件不重复追加，低水位快照不擦除 live 内容；发送重试复用同一 clientRequestId 与请求体；Docker 镜像可从包含共享包的源码完成冻结安装与构建，启动后可提供 Web、API 和 SSE。

### P2：平台接口与 RN/RNW 组件基础

交付：platform 与 ui 的最小实现，包含 Button/Input/Menu/Disclosure/MessageRenderer 的接口和 tokens；在现有独立 Web/PWA 与后端构建基础上接入跨平台能力。

1. 注入网络、认证、配置、前后台、UUID、剪贴板和链接能力；统一服务配置读取与异步初始化。
2. 将 document/window/localStorage/import.meta.env 从共享业务层移到宿主或平台实现；同时拆分 conversation changes 与 Run SSE 的传输和解析，保留各自独立游标。
3. 按 P0 选型实现 MessageMarkdown、列表和输入框平台边界；验证 RN/RNW Markdown、中文 IME、Enter/Shift+Enter、命令菜单、焦点、Tab/Escape、复制、输入框自增长和软键盘遮挡。设备能力通过平台接口调用，Web 实现不得直接导入 native 模块。
4. native 复用相同 session 跑通最小聊天闭环，尽早验证存储 hydration、登录和流式回复。
5. 补充原桌面端用户转用 Web/PWA 时的配置迁移说明。浏览器不自动继承旧 WebView 的模型配置和凭据，需说明服务地址、登录方式及重新配置步骤；保留已有后端数据，不因客户端切换删除数据库或服务端文件。本地开发仍可独立启动 Fastify 后端，发布客户端连接统一远程后端。
6. 按会话绑定的 `executionConfig.credentialSource` 处理跨端续聊：`server` 由后端解析凭据，`client` 要求当前设备提供与绑定端点匹配的 API Key；账号登录不代表模型凭据已同步。缺少客户端凭据时仍允许查看历史和恢复运行订阅，但阻止新发送，显示明确提示并提供凭据配置入口；处理后端返回的 `credential_required`。补齐凭据后继续原会话，保留绑定协议、端点和模型，不自动切换本机默认配置或新建会话；不增加服务端凭据同步，也不向其他设备下发 API Key。

验收：共享业务包不访问 DOM；平台注入后 Web/PWA 仍可独立启动、构建并访问后端，知识库链接与 PWA 更新功能通过回归。Web 与 native 能用同一 session 发送并恢复运行；配置未加载时不误发送到默认服务或默认模型；覆盖客户端凭据缺失、配置入口与补齐后继续原会话的行为；旧桌面用户可按说明重新配置 Web/PWA。

### P3：切换聊天视图并彻底移除 assistant-ui（M1）

交付：共享 ChatScreen、MessageList、MessageBubble、Composer、ReasoningBlock、ToolCallBlock、ModelPicker；Web/PWA 默认启用。

1. 用 RN primitives 构建界面；Markdown、菜单和输入框走平台实现。保持欢迎页、等待态、错误态、发送/停止、命令、历史分页及模型切换语义。
2. 显式实现列表自动滚动：用户在底部才跟随增量；向上阅读时保留位置；加载更早消息保留锚点；折叠思考/工具块和软键盘变化不能导致内容跳动。原生优先使用 FlatList，Web 按 P0 结果使用 RNW 列表或独立实现，共享行模型和滚动行为契约。
3. 通过开发开关短暂比较新旧视图，确保一次只挂载一种实现。M1 合并时删除旧视图、adapter 和开关，避免为了回滚继续保留 assistant-ui。
4. 移除两个 package dependency、Provider、primitives、类型导入、测试 mocks 和旧目录；清理相关 aui 样式及 Vite 中绑定旧 runtime 路径的刷新插件，是否保留通用刷新行为按新实现实际需要判断。
5. 更新 lockfile，检查整个 workspace 依赖树和运行构建产物；历史设计文档允许保留对旧实现的描述。

验收：运行代码、类型、测试、manifest 与解析后的依赖图均不依赖 `@assistant-ui/*`；Web/PWA 通过聊天行为回归；native 共用新聊天组件完成发送/停止/恢复冒烟。

### P4：按页面切换其余前端

交付顺序：会话侧栏与导航布局 → 登录/注册/找回密码 → 设置与模型配置 → Agent 列表/详情/编辑 → Skill 与定时任务等剩余页面。

每次只切换一个可验收的页面或功能域；页面使用共享组件，路由和 PWA 更新提示留在对应壳中。复杂编辑或平台专有能力通过平台组件实现，并明确移动端支持范围。

验收：每页通过已有用户行为测试、桌面与窄屏视觉核查、键盘焦点及无障碍核查后删除旧实现。最后清理不再使用的 Radix/Base UI、DOM 图标与样式依赖；Web 专用 renderer 仍需要的依赖按实际用途保留。

### P5：原生产品完善与发布验收（M2）

交付：iOS/Android 入口、导航、登录与配置恢复、完整共享页面、构建和测试流程。

- 完善 safe area、软键盘避让、长按复制、返回导航、横竖屏、长列表性能和系统字体适配。
- 验证登录刷新/退出、密码恢复、深链（如实际采用）、前后台切换和弱网；后台不保证持续接收 SSE，前台必须能从服务端恢复。
- Web/PWA 和移动端发布客户端连接统一 HTTPS 远程后端；分别在 iOS/Android 实际 Release 安装包中验证登录、API、鉴权 SSE、断线重连与前后台恢复，并检查开发 HTTP 例外未进入发布配置。Expo Go 或开发构建通过不能替代发布构建验收。本机目录路径属于后端执行环境，不能映射成手机文件路径。移动端附件上传另列需求。
- 为 mobile 加入 workspace scripts 与 CI；原生构建验证不能只依赖 Web 的 jsdom 测试。

验收：同账号、同服务端在 Web/PWA/iOS/Android 查看和续聊同一会话，生成中切端可恢复；切账号立即停止旧订阅并丢弃迟到响应。跨端续聊分别覆盖以下凭据场景：

| 会话凭据来源 | 新设备前提与验收 |
| --- | --- |
| `server` | 登录同账号后由后端解析模型凭据，无需在新设备填写 API Key 即可续聊 |
| `client`，新设备已有匹配凭据 | 使用会话绑定的协议、端点和模型续聊，验证上下文连续，不以新设备默认配置覆盖绑定配置 |
| `client`，新设备缺少凭据 | 可查看历史和恢复运行订阅；新发送被明确阻止并可进入凭据配置；配置匹配凭据后继续同一会话，无重复 Run、无自动新建会话 |

## 5. 必须保持的行为契约

1. 服务端历史是权威源；revision、changeId 与每个 run 的 appliedEventId 作用独立，不能合并成一个游标。
2. 发送待确认时，重试相同请求；并发发送、revision 冲突和上下文不可恢复时显示明确状态，不偷偷创建重复运行。
3. 切换页面或销毁订阅不会取消服务端 Run，只有显式停止才请求 cancel。
4. 用户正在阅读历史时不强行滚到底部；分页不遗漏、不重复、不丢当前内容。
5. 旧会话使用绑定的执行配置；切换模型按现有规则新建会话，不改变历史会话语义。客户端自带模型凭据不随账号跨设备同步，缺失时明确阻止新发送；补齐匹配凭据后继续原会话，不回退到本机默认模型。
6. 账号/服务端切换清空所属状态和订阅，旧请求、旧 Token 和旧消息不能流入新 session。
7. Markdown、思考内容、工具调用、工具错误与运行终态在历史回放和 live 显示中一致；保留未来未知内容类型的可控降级边界。

## 6. 验证与回退

Tauri 退役时的验证记录（2026-10-31）：`pnpm check`、`pnpm build` 和前端 119 项测试通过。后端在允许回环端口监听的环境中重跑，366/367 项通过；`test/skills/skill-runtime.test.ts` 的并发运行副本准备测试曾报临时目录 `ENOENT`，该文件单独复测 9 项全部通过。该结果作为 P0 的既有失败记录，不将完整后端测试记为全部通过；后续阶段需重新运行并判断是否复现。

每个可合并的实现阶段运行 `pnpm check` 和 `pnpm test`，并运行受影响的构建（完整构建使用 `pnpm build`，前端或后端分别使用 `pnpm build:web`、`pnpm build:server`）；P0/P2/P3/P4 触及界面时做实际页面与响应式视觉核查。P2 验证平台适配后的 Web/PWA 启动、生产构建与独立后端连接；原生入口建立后增加对应类型检查、组件行为测试和设备构建/冒烟。

根目录已有 `lint` 与 `format` scripts：当前 `pnpm lint` 仅调用 `pnpm check`，没有独立静态规则检查，因此运行 check 后无需重复执行同一检查；`pnpm format` 是 Prettier 写入命令，当前只覆盖 app/backend 源码，不作为只读验收命令。首个共享包落地时同步扩展根 check/test/build、lint 和 format 的覆盖范围，确保 `packages/*` 不被现有 filter/glob 漏掉；新增 mobile 时同样接入。若引入独立 lint 规则，阶段验收增加 `pnpm lint`；格式验证使用 Prettier 的 `--check` 模式或对应只读 script，并明确源码及测试的覆盖范围。各阶段均检查依赖图，避免重新引入已退役的 Tauri 依赖。仅修改方案文档时检查 Markdown 结构、引用与 diff，不要求运行代码测试。

首个共享包落地及后续变更 workspace 依赖、包入口或构建产物时，增加 Docker 部署验证：从仓库根目录执行 `docker build -f backend/Dockerfile .` 或部署脚本使用的等价镜像构建，并在测试环境配置数据库后启动镜像，验证 Web 静态资源、API 与鉴权 SSE。根 `pnpm build` 不替代镜像构建验收。

复用并迁移当前 run-events、conversation-store、use-antler-runtime、slash-command-input、chat-model-selection、chat-ownership、auth 等测试。补充测试只覆盖提取/平台切换带来的实际风险，重点是发送幂等、流式分片/重复/重连、快照竞争、账号隔离、IME 和滚动锚点。

建立固定数据集：长会话、长代码块/GFM 表格、连续 thinking/text/tool、空输出等待、403/失败/取消、断网后完成、分页期间仍在生成。记录基线与迁移后的交互表现；性能阈值由 P0 测量确定，不先承诺没有依据的百分比。

按阶段或页面形成独立 PR，schema 和 API 保持兼容。M1 前可用临时开关回到旧视图；M1 删除依赖之后，通过回退完整 PR/发布版本回滚，不保留隐式运行时兜底。PWA 发布还需验证缓存更新和旧客户端与现有 API 的兼容。

## 7. 首批可执行任务

Tauri 退役和独立 Web/后端构建已完成，以下只列剩余迁移任务。

1. P0：以 Expo/RN/RNW 选型确定兼容矩阵，在接入 Web 主线前独立完成所需 React/React DOM 与类型包升级；完成基线测试、RNW/native 流式验证、iOS/Android 独立 Release 构建的 HTTPS API/SSE 验证，以及 Markdown/列表/输入的选型记录。
2. P1a：创建 chat-core，自有消息模型与 reducer/DTO 迁移，旧 UI 通过 adapter 保持可用；同步接入根 scripts 和 Docker 构建，完成镜像构建与启动冒烟。
3. P1b：提取 ChatSession，决定订阅实现并清理未选用的 zustand 依赖，迁移发送、停止、订阅和分页测试。
4. P2：平台接口与配置初始化、RN 基础组件、最小原生聊天验证、跨端缺凭据提示与配置入口及旧桌面用户配置迁移说明。
5. P3a：新聊天视图完成并对比验收。
6. P3b：删除 assistant-ui、旧适配层和依赖，达成 M1。
7. 按 P4 页面顺序交付，再完成 P5 原生产品验收。

首批完成标准是 P0 验证结果和 P1 的可运行提取，不把“换包成功”视为迁移完成。暂不承诺日历工期，P0 后根据 renderer、输入法、流式网络和依赖兼容性的实测工作量估算。

## 8. 技术依据

- [React Native Web 安装与增量接入](https://necolas.github.io/react-native-web/docs/installation/)：支持在现有 React Web 应用中渐进采用。
- [React Native Web 构建配置](https://necolas.github.io/react-native-web/docs/setup/)：说明 react-native alias 和 Web 构建边界。
- [React Native 平台差异](https://reactnative.dev/docs/platform-specific-code)：支持 Platform 与平台文件组织方式。
- [Expo SDK 版本参考](https://docs.expo.dev/versions/latest/)：实施时按 SDK 对齐 React、RN、RNW 和运行环境版本。
- [Expo monorepo 指南](https://docs.expo.dev/guides/monorepos/)：用于配置 workspace、Metro 和依赖去重。
- [Expo 流式 fetch](https://docs.expo.dev/versions/latest/sdk/expo/#fetch)：用于验证原生流式传输方案，最终以选定 SDK 的文档与设备实测为准。
- [React Native 网络限制](https://reactnative.dev/docs/network)：说明 iOS ATS 与 Android 明文 HTTP 的默认限制，用于区分开发例外与发布构建的 HTTPS 验收。

## 9. Orca 移动端源码调研与取舍

调研日期：2026-10-31。来源为本机 `/Users/zhangjunqing/github/orca-main` 源码目录；该目录无 Git 元数据，无法记录对应 commit。以下路径均相对该目录，结论仅代表这份源码快照；未运行 Orca 移动端或验证真机效果。下列版本来自 `mobile/package.json` 的依赖声明，不作为 Antler 已验证的兼容矩阵。

### 实际实现与依据

| 方面 | 调研结论 | 源码位置 |
| --- | --- | --- |
| 应用与依赖 | Expo `^55.0.31`、React `19.2.8`、RN `^0.83.10`、RNW `^0.21.3`、Expo Router；移动端依赖及检查过的聊天代码未使用 assistant-ui | `mobile/package.json`、`mobile/app/_layout.tsx` |
| 当前会话入口 | 原生路由挂载 MobileWebShellScreen；对应 `.web.tsx` 路由挂载 MobileSessionRouteScreen。RN 命名的聊天组件在该入口下实际经 RNW 运行于 WebView | `mobile/app/h/[hostId]/session/[worktreeId].tsx` 及 `.web.tsx`、`mobile/web-entry/index.tsx` |
| 页面构建与宿主 | esbuild 将 react-native 映射至 react-native-web；页面以 React DOM / ExpoRoot 挂载。自定义 Expo 原生模块分别使用 iOS WKWebView 和 Android WebView 承载 | `config/scripts/build-mobile-web-app-bundle.mjs`、`mobile/modules/orca-mobile-web-shell/` |
| 页面资源更新 | 从主机读取 manifest，下载、验证、缓存并激活页面 bundle，包含页面与壳的协议兼容信息 | `mobile/src/mobile-web-shell/mobile-web-shell-session-effects.ts` |
| 聊天模型与状态 | 自有 NativeChatMessage、controller/hooks、消息 merger 与订阅/分页逻辑；部分局部状态通过 useSyncExternalStore 订阅。未将移动端聊天状态交给第三方聊天 UI runtime | `src/shared/native-chat-types.ts`、`mobile/src/session/use-mobile-native-chat-controller.ts`、`mobile/src/session/use-mobile-native-chat-session.ts` |
| 列表与输入 | 自建聊天组件；列表按 Platform.OS 分流，原生使用 FlatList，Web 使用 MobileNativeChatPageList；输入框有独立 `.web.tsx` 版本 | `mobile/src/session/MobileNativeChatView.tsx`、`mobile/src/session/native-chat/transcript/MobileNativeChatRowList.tsx`、`mobile/src/session/native-chat/composer/MobileNativeChatComposerField*` |
| Markdown | markdown-it 加中文友好、脚注插件，转换为树后由自建 RN 组件渲染；remend 参与流式语法补全，依赖中包含 lowlight | `mobile/src/components/mobile-markdown-tree.ts`、`mobile/src/components/MobileMarkdown.tsx`、`mobile/package.json` |
| 网络与设备边界 | 页面使用 BridgeRpcClient，配对凭据和 WebSocket 连接归原生壳；剪贴板、触觉、存储、导航等通过平台文件和 bridge 适配 | `mobile/web-entry/web-overrides.json`、`mobile/src/mobile-web-shell/bridge/`、`mobile/src/transport/direct-rpc-client.ts` |

### Antler 的采用范围

- 采用自有领域模型、session/controller 和自建聊天组件的分层方式；将解析、展示与网络同步解耦，复用 Antler 现有行为与测试。
- 将 Orca 的 Markdown 解析链路、列表平台分流、输入自增长和键盘适配作为 P0/P2 的具体参考；第三方库版本、API 和设备表现仍需在 Antler 的目标矩阵中验证。
- Antler 的默认移动端入口直接渲染 RN 组件并经平台网络适配访问 Fastify API/SSE，Web/PWA 经 Vite 直接运行 RNW。继续沿用服务端会话和 Run 的权威性，不引入 Orca 的主机配对、bridge RPC 或 WebSocket 协议来替代现有协议。
- 原生壳承载 RNW 页面、主机分发页面 bundle、bridge RPC 和自定义 WebView 不列入 M1/M2 默认交付范围。若后续出现页面独立更新或必须复用 DOM 页面的明确需求，再单独评估资源校验、缓存激活、壳/页面版本兼容、设备能力边界及真机性能；局部 WebView 需求不自动扩大为整个应用的渲染方案变更。
