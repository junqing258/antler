# Expo 与移动端目录优化计划

日期：2026-11-01  
状态：阶段 1-4 已实施（见文末实施记录与[基线盘点](19-expo-mobile-structure-optimization-baseline.md)）；设备侧验收与共享逻辑抽取待后续。

## 目标与边界

减少 Web 与移动端重复开发，让移动端页面、组件和服务的归属与 `apps/web/src` 尽量一致；引入 Expo Router 和 `@expo/ui`，以现有 Expo SDK 为基础逐步使用官方能力。以现有功能不回退为前提，优先复用业务逻辑和已存在的共享组件，不以目录完全相同或所有控件共用为目标。

本计划覆盖移动端工程组织、导航和适合替换的基础控件。Web 继续使用现有 Vite 和 React Router；不在本次将 Web 迁入 Expo Router，也不重写后端。现有 [移动端 Web 对齐计划](18-mobile-app-web-alignment-plan.md) 的设备交互验收仍需完成，本计划不能把构建通过视为其替代。

## 当前基线

- `mobile` 已是 pnpm workspace 成员，使用 `expo ~58.0.21`、React Native 0.88.1，以及 SecureStore、Clipboard、Constants、Crypto 等 Expo 模块；无需重复引入 SDK。先通过 Expo 版本检查确定现有依赖一致性，升级 SDK 不是此计划的前置条件。
- 移动端入口 `apps/mobile/index.ts` 注册 `src/app.tsx`；后者同时管理启动、认证、首页、聊天、设置、抽屉及自动化深链，页面切换主要由状态控制。移动端源码目前大多平铺。
- Web 使用 `views/`、`components/`、`lib/`、`styles/` 等目录；已有 `@antler/platform`、`@antler/chat-core`、`@antler/client-runtime` 和 `@antler/ui`，移动端和 Web 已共同使用其中部分能力。`@antler/ui` 已通过平台文件区分部分实现。
- 移动端测试目前主要位于 `apps/web/test/native-*.test.ts(x)`，根 `pnpm test` 通过 app 测试脚本运行；`mobile` 自身暂无线下独立 test 脚本。`pnpm check` 和 `pnpm build:mobile` 已覆盖移动端类型检查及 Expo 导出。

## 目标结构与职责

```text
apps/mobile/src/
  apps/web/                    # Expo Router 路由入口和布局，保持薄层
    _layout.tsx
    index.tsx
    chat/[id].tsx
  views/                  # 页面及页面级状态，与 Web 对应的功能尽量同名
    home/
    chat/
    settings/
  components/             # 移动端可复用组件和基础控件适配
    ui/
  lib/                    # 服务、认证、配置、平台及存储适配
    platform/
  styles/                 # 移动端共享主题和样式；不照搬 Web CSS
  experiments/            # 仅保留确有用途的探针
```

`src/app/` 是 Expo Router 的路由目录，不能把普通组件、服务放入其中；与 Web 的 `views/` 一致是功能组织上的一致，不要求路由文件位置相同。`src/app.tsx` 应在创建 `src/app/` 前拆分或重命名，避免路径含义和解析歧义。路由仅解析参数并组装页面；页面状态、服务和平台能力各归其位。按实际页面粒度调整子目录，不预建空目录。配置 `@/*` 指向各自包内的 `src/*`，同时检查 TypeScript、Metro、测试解析和平台扩展名解析。

初步迁移映射（实施时按职责拆分）：

| 现有文件 | 目标归属 |
| --- | --- |
| `app.tsx` | 启动与认证容器拆到 `apps/web/_layout.tsx` 和 `lib/`；首页、聊天、设置状态分别归对应 `views/` 或组件 |
| `home-page.tsx`、`native-chat.tsx` | `views/home/`、`views/chat/` |
| `chat-drawer.tsx`、`dialogs.tsx`、`knowledge-settings.tsx` | 按页面专属或跨页面复用分别归 `views/` 或 `components/` |
| `native-auth.ts`、`native-platform.ts`、`*-service.ts`、`*-config.ts`、`*storage*` | `lib/`，平台实现保留 `.native.ts` / `.web.ts` 解析及现有存储键 |
| `probe.tsx` | 确认自动化用途后归 `experiments/`，保留现有启用条件 |

## 技术方案

### Expo SDK 和共享边界

以 SDK 58 为基线，在 `mobile` 包内用 Expo 安装器选择与 SDK 匹配的依赖，执行 `pnpm exec expo install --check` 和 `pnpm dlx expo-doctor`；若发现不兼容，先记录并单独修复。需要升级时按 SDK 主版本逐级升级，核对发布说明和原生构建配置，不把无关升级混入路由迁移。

优先把无平台依赖的会话、配置校验、请求和状态转换放到已有共享包的合理边界；只有两端确实存在同一职责且接口稳定时才抽取。认证持久化、系统链接、键盘、安全区和 UI 宿主留在平台适配层；凭据继续使用原有安全存储与 endpoint 绑定规则。Web 的 DOM、CSS 和移动端原生 API 不相互渗透。抽取前列出两端现有实现和调用者，抽取后删除重复实现并以行为测试证明等价；不因共享而新增多余抽象。

### Expo Router

参考官方现有项目安装指南，在 `mobile` 安装匹配 SDK 的 `expo-router` 及其依赖，配置入口、插件、现有 `antler` scheme 和必要的 TypeScript 类型。保留已有 `expo-secure-store` 插件和应用标识；若入口仍需初始化副作用，使用自定义入口并最后导入 `expo-router/entry`。检查 Metro、pnpm workspace 和 iOS/Android/Web 导出。

根布局承载启动、认证和共享依赖生命周期；未就绪展示加载/错误，未认证进入登录流程，认证失效清理当前账号状态。首页对应 `/`，会话使用 `/chat/[id]`；设置和抽屉优先保持现有模态语义，只有需要可恢复或可深链的页面才加入路由。会话 ID 可放路径，Agent 等非敏感参数按需传递并校验；草稿、运行时对象和凭据不放 URL。返回、切换和删除当前会话时明确 push/replace/back 语义，保持订阅清理与服务端运行恢复行为。

现有 `antler://autostart` 自动化入口含会话参数，部分场景还含登录信息：迁移前记录冷启动、热启动、未登录和登录后行为，设计专门的链接分发/兼容处理，确保仅在现有自动化开关开启时生效、敏感值不进入持久路由历史或日志，避免 Router 与现有 Linking 监听重复处理；不可简单把它当作普通页面路由。验证原有链接、认证回调及 Web 刷新/直达，明确不受信任链接的处理。先保留旧导航实现作为可回退基线，再逐页面切换并删除失效路径。

### `@expo/ui` 试点

在 `mobile` 内通过 `pnpm exec expo install @expo/ui` 安装 SDK 匹配版本。先选设置页中一个基础控件或对话框试点，使用官方 universal API 和 `Host`，核对 SDK 58 实际可用组件、平台支持、尺寸布局、主题、受控状态、无障碍、键盘与 Web 导出。需要 SwiftUI/Compose 专有能力时才用平台实现并保留明确的另一平台替代。

对比现有 React Native 控件和共享 `@antler/ui`：仅在减少自维护代码且满足交互和视觉要求时替换；聊天消息、输入、复杂抽屉等已有共享能力不做全量重写。先在 `apps/mobile/src/components/ui/` 封装项目需要的最小接口；只有验证 Web 宿主的 Vite、React Native Web、依赖和测试均兼容、且两端确有共同需求时，才考虑将该封装移入共享包。Expo UI 的 Web 实现不能直接假定可无改动替换当前 Web 组件。试点不满足要求则保留现有控件并记录原因，不阻塞目录重组和路由迁移。

## 实施顺序与交付门槛

1. **基线与盘点**：记录当前 SDK 检查、`pnpm check`、`pnpm test`、`pnpm build:mobile` 结果；列出现有页面跳转、自动化链接、认证生命周期、存储键及 Web/移动端重复点。把旧计划未完成的设备验证单独记录。
2. **目录整理**：先做可审查的文件移动及导入调整，建立别名和测试解析；不改变行为，检查原生/Web 平台文件选择和既有测试收集。此阶段可独立回退。
3. **Router 迁移**：建立入口、根布局和认证边界，逐步接入首页及聊天，兼容深链和返回行为；将原 `App` 中生命周期拆出并覆盖竞态。设置和抽屉维持现有交互，验证后移除旧状态导航。作为独立变更回退。
4. **Expo UI 试点及去重**：完成一处控件的双平台验证，记录替换前后维护代码及限制；按收益逐个推广。共享逻辑仅按已识别重复点分批提取，并回归两端。
5. **收尾**：更新工程结构、开发/构建及路由文档，记录已完成和未验证项。清除旧入口和无调用代码，确认测试仍被根命令收集。

## 验证与验收

- 每阶段执行相关测试与 `pnpm check`；Router 和共享代码变化执行 `pnpm test`、`pnpm build:mobile`，涉及共享 UI 时额外执行 `pnpm build:web`。补充回归测试：冷/热深链只处理一次、未登录后继续、非法参数、认证失效与快速切换账号、返回/切换会话、删除当前会话、运行中切换、持久化兼容及请求竞态。保证现有 `apps/web/test/native-*` 继续运行；若迁至 mobile，先配置测试脚本和根命令并验证收集数量。
- iOS 和 Android 模拟器分别验证启动、登录/退出、首页、会话、返回、抽屉、设置、键盘、安全区、深链和后台恢复；Expo UI 试点增加动态字体与 VoiceOver/TalkBack 检查。验证移动端 Web 导出、刷新和直达；共享改动验证既有 Web 页面。记录设备、命令、结果与无法执行的项。
- 用真实 HTTPS 后端及适当测试账号进行独立构建的登录、流式消息和恢复验证；环境不可用明确标记未验证。现有自动化深链中的敏感参数仅使用测试凭据，不写入记录。
- 验收标准：两端主要流程与旧行为一致；路由入口与页面实现分离；平台存储及旧数据可读；根测试命令未漏收；试点有明确的代码减少和平台验证结论，未达标则保留原实现并说明。

## 风险与回退

Router 接管链接可能造成重复分发、认证绕过或历史栈变化；以链接回归和认证门禁为发布条件。Expo UI 的平台组件覆盖和布局行为可能不同，按控件小步试点。目录移动可能破坏平台文件、别名及测试解析，先进行纯移动并验证。共享包变更可能影响 Web，保持独立提交并双端验证。每个阶段独立提交：异常时回退该阶段提交及其锁文件、入口和配置，保留已验证阶段；不要更改存储键和应用标识作为回退手段。

## 参考

- [Expo Router 现有项目安装](https://docs.expo.dev/router/installation/)、[src 目录](https://docs.expo.dev/router/reference/src-directory/)
- [Expo UI](https://docs.expo.dev/versions/latest/sdk/ui/)、[Universal 组件](https://docs.expo.dev/versions/latest/sdk/ui/universal/)
- [Expo SDK 升级指南](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)

## 实施记录（2026-11-01）

每阶段独立提交：阶段 1-2 `b665611`、阶段 3 `ca480c0`、阶段 4 `570303c`。

- **阶段 1-2（目录整理）**：`apps/mobile/src` 重组为 `web/`（阶段 3 起为路由）、`views/{home,chat,settings,root}`、`components/{,ui/}`、`lib/`、`experiments/`；平台存储文件（`.native.ts`/`.web.ts`）与存储键全部原样保留。`@/*` 别名已配置于 `apps/mobile/tsconfig.json`，但 mobile 源码保持相对导入——app 侧 vite/vitest 把 `@` 解析到 `apps/web/src`，且 app 测试传递性导入全部 mobile 源码（约束记录于基线文档）。基线与盘点见 [19-expo-mobile-structure-optimization-baseline.md](19-expo-mobile-structure-optimization-baseline.md)。
- **阶段 3（Expo Router）**：入口 `expo-router/entry`（旧 `index.ts` 已删），`expo-router ~58.0.29` 及匹配依赖。根容器收敛到 `views/root/app-container.tsx`（启动、认证门禁、`antler://autostart` 唯一分发、全局设置模态）；路由文件仅解析参数并组装页面，参数与导航动作经 `RootContext` 提供，路由文件零 Router 依赖（也让 app 测试可用假 Router 驱动全部逻辑）。导航语义：主页→会话 `push`；抽屉切换/新建/删除当前会话/自动化 `replace`；认证失效与登出清 `pendingAuto` 并回 `/`。`[...unmatched]` 兜底页挂载即回主页。自动化 `message`/`cancelAfter` 只走内存上下文，不进路由参数（有回归测试）；旧实现中未登录时无凭据的 autostart 链接被丢弃的行为保持不变。
- **阶段 4（@expo/ui 试点）**：见基线文档"阶段 4 试点记录"——知识库设置"清除密钥"换为 `Switch`（web 验证通过），无代码净减少，暂不推广。
- **验证情况**：每阶段 `pnpm check`、`pnpm test`（app 209 用例、server 375 用例等全部通过）、`pnpm build:mobile`（web/android/ios 导出，web 已按路由分包）通过；根测试命令收集数量与基线一致（迁移的路径引用全部更新）。
- **未验证（需设备，延续 doc 18 受阻记录）**：iOS/Android 模拟器的启动、登录、抽屉、键盘、安全区、深链（`antler://autostart` 冷/热启动经 Router 后的实际表现）、后台恢复、返回手势；@expo/ui Switch 的原生渲染与无障碍；真机 Release + HTTPS 后端的登录/流式/恢复。验收时重点关注：Router 接管链接后 autostart 是否只分发一次（代码层已防重）、返回行为与历史栈、`[...unmatched]` 兜底是否干扰冷启动深链。
- **未实施（按计划留待后续）**：共享逻辑分批抽取（盘点结论：现有 `@antler/ui`/`client-runtime` 已覆盖主要复用面，无确证重复点）；Expo UI 其余控件替换。
