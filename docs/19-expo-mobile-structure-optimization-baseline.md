# Expo 结构优化：阶段 1 基线与盘点记录

日期：2026-11-01
对应计划：[19-expo-mobile-structure-optimization-plan.md](19-expo-mobile-structure-optimization-plan.md)

## 基线命令结果

| 检查 | 结果 |
| --- | --- |
| `pnpm exec expo install --check`（mobile 包内） | Dependencies are up to date |
| `pnpm dlx expo-doctor` | 19/20 通过；唯一失败项为 "app.json 与 app.config.js 并存" —— 实际 `mobile/app.config.js` 已通过 `...base.expo` 继承 app.json 全部值，属检查误报，记录不处理 |
| `pnpm check`（全仓，含 check:mobile） | 通过 |
| `pnpm test` | 全部通过：app 38 文件/208 用例、server 42 文件/375 用例、platform/chat-core/client-runtime 3 文件/4 用例与 4 文件/21 用例 |
| `pnpm build:mobile` | 通过（web/android/ios 三平台 bundle 导出） |

SDK 基线：`expo ~58.0.21`、React Native 0.88.1、react 19.3.0、react-native-web 0.21.4；Expo 模块：SecureStore、Clipboard、Constants、Crypto、AsyncStorage。依赖一致性无需升级。

## mobile/src 现状盘点（20 文件，3322 行）

### 文件职责与导航

- `index.ts`（入口）：`registerRootComponent(src/app.tsx 的 App)`。
- `app.tsx`（639 行）：启动/认证容器 + 状态导航。持状态：`boot`（配置+代际号）、`authenticated`、`chat`（当前会话 {id, agentId, title, message, cancelAfter}）、`drawerOpen`、`settings`（供应商/知识库双 Tab 模态）、`error`、`provider`。页面切换纯 state：`chat ? NativeChat : HomePage`，设置与抽屉为覆盖层模态。
- `home-page.tsx`：主页；直接拉 `/api/agents` 与 `/api/conversations?limit=50`（未用 conversation-service），共享 `AgentList`。
- `native-chat.tsx`：聊天页；共享 `ChatScreen` + `ChatSession`（client-runtime），平台 `createNativePlatform`。
- `chat-drawer.tsx`：会话抽屉（Modal + Animated），使用共享 `ConversationList`，调用 conversation-service 全量（list/rename/delete/subscribeChanges）。
- `dialogs.tsx`：InputDialog / ConfirmDialog，通用跨页组件。
- `knowledge-settings.tsx`：知识库设置（设置模态内 Tab），使用 rag-config-service。
- `probe.tsx`：P0 流式诊断探针，仅在 `automationEnabled`（开发环境 `ANTLER_MOBILE_AUTOMATION === "true"`）且未进入聊天时显示。
- 服务：`conversation-service.ts`、`rag-config-service.ts`（依赖 `@antler/platform` 的 ClientPlatform）。
- 配置：`app-config.ts`（读 expoConfig.extra）、`native-config.ts`（类型/校验/序列化）。
- 平台：`native-platform.ts`（ClientPlatform 实现：expo/fetch、AppState、Crypto）。
- 存储（平台文件解析）：`native-storage.{native,web}.ts`（AsyncStorage+SecureStore vs localStorage；键 `antler.p0.native.{settings,credentials}.v1` / `antler.p0.web-probe.{settings,credentials}.v1`）、`provider-storage.{native,web}.ts`（供应商配置）。
- 认证：`native-auth.ts`（Supabase 客户端单例 + AsyncStorage 会话持久化，键 `antler.native.supabase.<encodeURIComponent(projectUrl)>`，legacy 清理键 `antler.native.supabase.auth`）。

### 自动化深链（antler://autostart）

- 仅 `automationEnabled` 时生效（生产恒为 false）。两个 Linking 监听按 `authenticated` 互斥：
  - 已登录：解析 `conversationId`（缺省 Crypto.randomUUID）、`agentId`、`message`、`cancelAfter` → setChat。
  - 未登录且 supabase 模式：解析 `email`/`password` 自动登录，成功后 `pendingAutoUrl` 存 URL 待登录后处理。凭据仅存内存 ref，不进持久化。
- 风险点（Router 迁移）：Linking.getInitialURL + addEventListener 已有 pending 处理；Router 接管 scheme 后需避免重复分发。

### 认证生命周期

- 启动 effect（attempt 代际）：disposeNativeAuth → 读 app 配置/后端 auth-config/供应商配置 → local 模式需 legacy token（端点绑定校验）→ supabase 模式 currentAccessToken（刷新会话）→ `/api/agents` 探活（10s 超时）→ 401 时保留 boot 但要求重新登录。
- 代际号 `bootGeneration` 贯穿：getToken / invalidateBoot / isCurrent / onUnauthorized / onNativeSignedOut 均校验代际，防快速切换账号竞态。
- 登录：`Login` 组件用隔离 recovery 客户端（不持久化），主客户端 signInWithPassword；onSignedIn → attempt++ 重启启动流。
- 登出：drawer 确认弹窗 → signOut(local scope) → invalidateBoot → 清 chat/drawer/email → 回登录页。
- 认证失效：onUnauthorized（401）→ supabase 回登录页并清 chat；local 模式直接置 boot=undefined 回错误页。

### 存储键汇总

| 键 | 内容 | 实现 |
| --- | --- | --- |
| `antler.p0.native.settings.v1` | 设置（无凭据） | AsyncStorage |
| `antler.p0.native.credentials.v1` | 凭据（端点绑定） | SecureStore |
| `antler.p0.web-probe.settings.v1` / `.credentials.v1` | Web 导出用 | localStorage |
| `antler.native.supabase.<enc(projectUrl)>` | Supabase 会话 | AsyncStorage |
| `antler.native.supabase.auth`（legacy） | 旧会话键，读取后清理 | AsyncStorage |
| 供应商配置（provider-storage，键见实现） | 供应商协议/模型/Key | SecureStore / localStorage |

### Web/移动端重复点（抽取候选评估）

| 职责 | Web | 移动端 | 评估 |
| --- | --- | --- | --- |
| 会话列表/重命名/删除/变更订阅 | app/src/lib/conversation-store.ts | mobile conversation-service.ts | 接口相近但平台请求层不同；client-runtime 已有 subscribeChangeStream 共享。仅在接口稳定时抽取 |
| RAG 配置读写 | app/src/lib（platform 目录） | mobile rag-config-service.ts | 同上 |
| 服务器地址校验 | 后端/app 各有 validate 类逻辑 | native-config.ts validateServerUrl | 保留平台层 |
| 认证 | app/src/lib/auth.ts | native-auth.ts | Supabase 存储适配不同（AsyncStorage vs 浏览器）；保留平台层 |
| UI | @antler/ui 已共享 AgentList、ChatScreen、AuthForm、ProviderConfigForm、ConversationList | 同左 | 已复用，无需新抽取 |

结论：现有共享包已覆盖主要复用面；阶段 4 仅在有确证重复时小步抽取，不预设。

## 测试收集现状

- mobile 相关测试 10 个位于 `app/test/native-*.test.ts(x)`、`app/test/mobile-*.test.ts`，以相对路径 `../../mobile/src/...` 直接引用 mobile 源码（含 .native.ts 平台文件；app 侧 vitest 解析按普通 ts）。
- `mobile` 包自身无 test 脚本；根 `pnpm test` 经 `@antler/app` 的 vitest 收集。目录移动需同步更新这些 import。
- 根 `pnpm check` 已含 `check:mobile`；`build:mobile` 为 `expo export --platform all`。

### 别名约束（阶段 2 实测）

- `mobile/tsconfig.json` 已配置 `paths: {"@/*": ["./src/*"]}`（TS 6 弃用 baseUrl，paths 相对 tsconfig 解析）。
- 但 mobile 源码内部**保持相对导入**：app 包 vite/vitest 把 `@` 解析到 `app/src`，且 `app/test/native-*` 经组件树传递性导入全部 mobile 源码，mobile 内使用 `@/` 会在 app 测试中错解析到 app/src。别名仅供未来 app 测试不再传递导入 mobile 源码后启用。

## 阶段 4 试点记录：@expo/ui Switch（清除密钥）

- 安装 `@expo/ui ~58.0.26`（expo install 匹配 SDK 58）；universal API 三端可用（web 走 `createWebComponent` DOM 实现，iOS/Android 走 SwiftUI/Compose + `Host`）。
- 试点控件：知识库设置"清除密钥"（原为 Pressable 文字切换），替换为 `components/ui/toggle.tsx` 封装的 `<Host matchContents><Switch value onValueChange label/></Host>`；接口仅 value/onChange/label/disabled。
- 验证：`pnpm check` 通过；jsdom 测试渲染为 `role="switch"`（可访问名"清除密钥/取消清除密钥"）且交互断言全部通过；`pnpm build:mobile` 三平台导出通过（web bundle 含 @expo/ui DOM 实现）。
- **未验证**：iOS/Android 原生 Switch 的实际渲染、尺寸、动态字体与 VoiceOver/TalkBack（本机无 Simulator GUI，延续 doc 18 设备验证受阻记录）。
- 维护代码对比：删除 Pressable+Text 约 10 行，新增封装 20 行 + 一个依赖（约 21 个包）。此规模下**无代码净减少**，收益是原生平台控件与统一主题入口（Host colorScheme/seedColor）。
- 结论：试点可用、予以保留；其余控件（对话框、输入、消息列表）已有共享实现且更复杂，**暂不推广**替换，待设备验收确认原生表现后再评估逐个收益。

## 旧计划（doc 18）未完成的设备验证（不因本计划视为完成）
- iOS：聊天页/抽屉交互验证受阻（本机 Xcode 无 Simulator.app GUI，无法注入点击）；深链确认弹窗未能点按。
- Android：APK 构建成功；交互验收按用户指示暂停。
- 键盘、安全区、动态字体、横屏、VoiceOver/TalkBack、弱网、跨账号、真机 Release + HTTPS 后端登录/SSE/后台恢复：均未验证。
