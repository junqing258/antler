# React Native 迁移 P0 验证记录

日期：2026-10-31。此记录仅覆盖已执行的检查，P0 尚未通过验收。

## 候选版本

以 Expo SDK 58 为候选，官方版本表对应 React Native 0.88、React 19.3.0、React Native Web 0.21.0，Node.js 最低 22.13.x；iOS 最低 16.4、Xcode 最低 26.4。来源：[Expo SDK 版本参考](https://docs.expo.dev/versions/latest/)。实际包版本、Metro 和 TypeScript 兼容性仍须在最小 Expo 项目中验证，不能把候选矩阵当成已验收组合。

Web 宿主已升级 React/React DOM 及类型包至 19.3，现有 assistant-ui 界面仍保留。升级前 `pnpm check` 通过，前端测试 119/119、后端测试 367/367 通过。升级后 `pnpm check` 和前端测试 119/119 通过；依赖树检查显示 app 的 React 引用解析为 19.3.0。自动化测试不能替代浏览器视觉和交互核查。

## 待完成

- 带鉴权 SSE 的真机与 iOS/Android 独立 Release 验证，以及可用于发布验收的 HTTPS 后端（需物理设备与签名团队）。
- 模拟器上的固定样例验证：Markdown（含高亮/脚注）、列表锚点、输入法与软键盘行为。
- 移动端登录、令牌自动刷新与跨重启会话恢复的设备验证。
- 原生完整导航与跨设备恢复（P5）。

本机可调用 Xcode 和 iOS 模拟器、Android SDK 与模拟器（AVD 就绪）、Docker CLI。模拟器不替代计划要求的真机与 Release 验收。

## 验证入口与已测结果

- `pnpm dev:web` 启动后访问 `/rnw-probe.html`；`pnpm build:probe` 单独构建到 `apps/web/dist-p0`，不将诊断页面纳入正常 PWA 构建。Vite 将精确的 `react-native` 导入解析到 RNW，并去重 React。
- `pnpm dev:mobile` 启动 Expo 实验入口；`pnpm build:mobile` 导出 iOS、Android 和 Web bundle。入口包含实验性聊天和原始 SSE 探针。探针中的令牌仅保存在页面内存中；聊天配置的保存方式见下文。
- Expo 安装检查通过，当前锁定的实际组合为 Expo 58、React 19.3.0、React Native 0.88.1、RNW 0.21.4、移动端 TypeScript 6.0.x。`expo export` 已分别生成 iOS、Android 和 Web bundle；这只验证 Metro 打包，不代表原生应用构建或设备运行通过。
- 在本机浏览器通过带鉴权校验的模拟 SSE 验证指定游标、跨 UTF-8 字节边界的中文、增量显示和中止；检查了桌面与 390px 窄屏布局。此结果不代表真实服务端、原生网络或 HTTPS Release 验收。
- 原生发布构建的聊天入口拒绝非 HTTPS；开发构建允许输入 HTTP 地址。真机访问开发电脑时不能使用手机的 `127.0.0.1`。
- Docker 构建需安装 mobile workspace 以供 Web 的诊断源码类型检查；镜像构建与启动结果需单独记录。

本轮完整后端测试在并行高负载时有两项超时（365/367）；`test/routes/config.test.ts` 和 `test/scheduler/shutdown.test.ts` 单独复跑 25/25 通过。

尝试 iOS 模拟器构建时，Expo prebuild 完成；CocoaPods 下载和安装依赖期间发现磁盘仅余约 1.5 GiB，因此中止安装，未进行 Xcode 构建。生成的 `apps/mobile/ios` 已移入废纸篓，仍占用磁盘空间，清空废纸篓后才会释放；已下载的 React Native 构建缓存也保留。Android 未连接设备，现有模拟器尚未运行验证。

## P1a 领域提取进度

已建立 `@antler/chat-core`，将版本化消息 DTO、事件归并、水位、快照合并和斜杠命令匹配迁入纯 TypeScript；旧聊天界面通过临时转换层消费领域消息，网络传输仍在 Web 宿主中。领域模型保留消息序号、Run ID、已应用事件水位、工具参数与结果；未知内容保留原值并在旧界面显示占位。根检查、测试、构建和格式脚本已纳入新包，Dockerfile 已加入 manifest 和源码。

P0 原生设备验证仍未完成，旧聊天界面也尚需实际浏览器回归。后端全量测试重现已记录的 skill runtime 临时目录 ENOENT（366/367），该文件单独复测 9/9 通过。

Docker 镜像验证尝试了默认 Debian 镜像和 `DEBIAN_MIRROR=http://deb.debian.org`，均在 apt 签名校验阶段失败，尚未执行 workspace 安装。随后在同一 Docker 引擎的容器内检查发现根文件系统 32 GiB 已满（可用空间 0）；不能据此判断仓库依赖安装是否成功。当时未清理现有 Docker 缓存或容器；后续检查时已有可用空间，已重新执行构建与启动冒烟。

## P1b 会话提取进度

`@antler/client-runtime` 的 `ChatSession` 已接管发送、重试、取消、刷新、事件订阅和分页；Web 宿主注入网络、认证、前后台事件、UUID 与延时。React 通过 `useSyncExternalStore` 订阅同一状态，assistant-ui 层仅桥接展示和输入；选择该方案是为了避免第二个业务状态源。项目中没有其他直接使用 zustand 的位置，已删除 app 的直接声明（assistant-ui 仍可能传递依赖它）。

发送确认后按服务端创建 Run 会递增 revision 的协议设立最低水位，避免迟到的旧快照清除运行状态。新增测试覆盖相同请求体重试、绑定模型、停止和销毁、旧响应隔离、重复事件、快照竞争与历史前插。平台配置与原生聊天闭环仍属于后续阶段；凭据缺失处理的进度见下文。

本轮 `pnpm check`、`pnpm build` 通过；chat-core 3 项、client-runtime 6 项、前端 123 项及后端 367 项测试通过。Docker 使用冻结 lockfile 构建成功，在隔离的临时 PostgreSQL 中完成迁移并启动，验证了 Web 静态页面、未授权请求返回 401、鉴权会话 API 和鉴权会话变更 SSE 心跳；临时容器与网络已停止并清理。该冒烟没有执行真实模型 Run，也不替代 iOS/Android 设备与 Release 验收。

## P2 跨设备凭据进度

客户端来源的会话会在发送前检查当前设备是否有 API Key，以及协议、服务地址是否匹配绑定配置；缺失或不匹配时可查看历史和恢复运行订阅，但不能发送。设置入口显示绑定的协议、地址和模型，不自动修改本机默认配置；补齐后仍使用原会话和绑定模型。`credential_required` 会显示配置提示，会话配置尚未加载时不允许发送。服务端来源的会话不要求设备提供 Key。桌面与 390px 窄屏使用隔离假数据检查了提示与设置页；README 已补充旧桌面版迁移步骤。

平台接口和异步配置初始化尚未完整抽取，移动端聊天闭环、真实跨设备凭据验证以及原生 Release 验收仍未完成。以上浏览器演示使用假后端，不代表真实模型 Run 已通过。

平台边界进一步落地：`@antler/platform` 定义网络、鉴权连接、前后台通知、UUID、定时和流解码接口；Web 和实验性原生宿主提供实现。Run SSE 与会话变更 SSE 的传输已迁到 `client-runtime`，共用纯文本帧解析器但分别维护 run eventId 与 conversation changeId；409 时从权威快照重置变更游标。当前接口只覆盖已接入能力；剪贴板和链接等能力仍待完成。

## P2 实验性移动聊天入口

移动入口通过同一个 `ChatSession` 和跨平台 HTTP/SSE 适配器加载会话、发送、停止、订阅运行和加载更早消息。配置会在创建会话前异步加载：原生端使用 AsyncStorage 保存普通设置、SecureStore 保存访问令牌和模型 Key；切换服务器、认证方式或模型服务地址时不会沿用不匹配的凭据。Web 诊断入口使用浏览器本地存储，不能等同于原生安全存储。当前需要手工提供 local 令牌或 Supabase 访问令牌，不包含登录和令牌刷新。

使用本机隔离假后端，在移动入口的 RNW 版本验证了配置、鉴权、发送及中文流式回复；`pnpm check`、全量测试和 `pnpm build` 通过。此验证没有调用真实模型，也不代表原生网络、真机、跨设备、HTTPS Release 或计划要求的性能与输入法验收通过。当前原生界面是实验入口，尚未与 Web 共享聊天 UI，Markdown、列表锚点与键盘行为仍需实现和验证。

最新 Docker 镜像构建成功，并使用隔离的临时 PostgreSQL 验证 Web 页面、未授权请求、鉴权会话 API 和会话变更 SSE 心跳；未执行真实模型 Run。Expo 依赖版本检查通过。

本次重新生成 iOS 工程后，检查到 `NSAllowsArbitraryLoads` 与 `NSAllowsLocalNetworking` 均为 false；Android 生成的明文网络例外仅出现在 debug 和 debugOptimized manifest。CocoaPods 在下载 Hermes 时，重新生成 iOS 工程清除了正在安装的目录，因此中止了此次安装；尚未完成模拟器构建。Android 本机缺少当前项目所需的 SDK，尚未完成原生构建。上述配置检查不替代 Release 运行验证。

随后重新执行 CocoaPods 安装，并成功完成 iOS 模拟器 Debug 构建。模拟器安装阶段本机负载大幅升高且命令长时间未返回，已中止安装并关闭模拟器；尚未验证应用启动。

会话首次初始化或加载失败时现在会退避重试，重新读取快照并建立变更订阅；期间保持不可发送，销毁会话会阻止后续重试。该恢复逻辑有自动化测试，仍需在原生设备上验证实际弱网和前后台行为。

已新增 `@antler/ui`，提取实验性消息气泡、列表和输入框，移动入口使用这些组件；RNW 组件测试覆盖消息类型、错误、发送和停止，并在浏览器使用隔离假后端验证了发送与流式回复。Web 主聊天界面尚未切换到共享组件；当前消息仍为纯文本，Markdown、自动滚动与分页锚点、输入法和原生设备行为仍需实现或验证。

列表现已按平台拆分：Web 保持可见消息锚点并在底部跟随内容，原生端使用 FlatList 可见位置保持与底部跟随；Web 的前插和阅读历史时不跟随有组件测试。浏览器实际滚动检查因自动化点击超时后发生重复插入，只能作为初步观察，不能作为完整验收；原生设备、长列表性能、软键盘和折叠块导致的滚动行为仍需验证。

共享消息正文已接入 `markdown-it` 与 RN/RNW 渲染，支持常见段落、强调、列表、引用、代码块、表格和 HTTP(S)/邮件链接；HTML 按文本处理，图片目前只显示替代文字。RNW 组件测试覆盖常见内容和流式未闭合文本更新，Expo iOS、Android、Web 导出通过。尚未验证原生设备显示、链接交互和选择，也尚未实现语法高亮、脚注、中文强调增强及流式语法补全；Web 主聊天仍使用原界面。以上测试不等于 Markdown 全部验收通过。

共享输入框按平台拆分：Web 支持 Enter 发送、Shift+Enter 换行，组合输入及重复按键不会触发发送，输入框随内容增高至 120px 后滚动；原生端保留多行输入和发送按钮。RNW 测试覆盖键盘和发送状态；隔离浏览器页面验证了长文本高度上限与 Enter 发送，但截图采集超时，未完成视觉核查或真实中文输入法验证。原生键盘遮挡、自增长和输入法行为仍需设备验证，Web 主聊天尚未切换。

实验性共享输入框现使用 chat-core 的斜杠命令：Web 提供键盘选择、关闭与填充，原生端提供触摸选项；填充后仍需用户发送。RNW 组件测试覆盖筛选、选择、关闭、输入法组合与 `/compact`，隔离浏览器页面确认了菜单出现及键盘填充。截图采集超时，视觉核查尚未完成；原生设备的菜单触摸、焦点和软键盘遮挡尚未验证，Web 主聊天仍使用原实现。

共享消息气泡现提供思考折叠块与工具调用折叠块（RN primitives，经 RNW 复用）：思考块运行中自动展开并在结束后收起，工具块按调用中/完成/失败显示状态，正文展示查询或参数并在有结果时追加结果（错误结果以警示色显示）；运行中且无内容时显示等待提示，运行失败/停止状态有区分样式。气泡接受注入的复制回调（P2 剪贴板能力边界），仅对完成的助手消息暴露；实验入口 Web 构建接入 `navigator.clipboard`，原生端剪贴板待引入并验证 `expo-clipboard`。RNW 组件测试覆盖折叠交互、运行中自动展开、等待态、错误展示和复制回调；`pnpm check`、全量测试、`pnpm build:web` 与 Expo iOS/Web 导出通过。原生设备上折叠块与软键盘、滚动的相互影响尚未验证，Web 主聊天仍使用原界面。

新增共享 `ChatScreen` 与 `ModelPicker`：ChatScreen 以受控 props 组装消息列表、输入框、欢迎页（ready 且空会话）、加载更早消息、会话通知、上下文不可恢复提示、凭据缺失警告及配置入口、等待/错误状态与免责声明；Composer 增加 `leading` 插槽承载模型选择。ModelPicker 为 RN 菜单实现，无候选模型时显示"服务端默认"并禁用。RNW 组件测试覆盖欢迎/加载态、分页与凭据入口、发送禁用条件和模型选择；实验性移动入口已改用 ChatScreen。`pnpm check`、全量测试、`pnpm build:web` 与 Expo 导出通过。移动端配置目前只有单个模型字段，尚无模型列表来源，ModelPicker 未在实验入口接线；模型切换的新会话语义（绑定模型变更时新建会话）将在接入宿主时验证，Web 主聊天仍使用原界面。

实验性移动入口已接入 ModelPicker：设备配置新增"模型列表（逗号分隔）"字段（与 Web 设置对话框手动维护模型列表同源，旧配置向后兼容），会话内模型选择显示绑定模型或设备默认模型；切换与 Web 规则对齐——选择当前显示模型不动作，未绑定执行配置时更新设备默认模型并重建会话，已绑定时按"切换模型新建会话"语义生成新会话 ID 并保存配置。解析函数有单元测试，`pnpm check`、全量测试、`pnpm build:web` 与 Expo 导出通过。切换模型的端到端行为（重建会话、新会话使用新默认模型、旧会话保留绑定配置）尚未在真实后端或设备上验证。

Web 宿主已通过开发开关接入共享聊天视图：`?chatView=shared` 时 `chat.tsx` 渲染 `SharedThread`（消费 `useAntlerRuntime` 暴露的同一 `ChatSession` 与快照，经共享 `ChatScreen` 展示），一次只挂载新旧两种实现之一；旧 assistant-ui 路径仍为默认，其外层"加载更早消息"按钮在共享视图下不再重复渲染。RNW 集成测试以真实 `ChatSession` 加假依赖覆盖：欢迎态与发送链路（含草稿清空、运行中切换停止）、历史分页和模型选择回调。`pnpm check`、全量测试、`pnpm build:web` 通过。共享视图的浏览器人工对比（含与假后端的流式回复、视觉与响应式核查）尚未执行，模型切换新建会话语义仍待端到端验证。

共享聊天视图完成浏览器对比验收（隔离假后端，本机验证）：以零依赖假后端模拟会话快照、消息分页、变更 SSE、Run 事件 SSE 与取消端点，独立 Vite 实例通过环境变量指向假后端，使用 localStorage 开关 `antler.shared-chat=1` 渲染共享视图（URL 参数开关不可行——ChatView 切换会话时会整体重写查询串，已改为 localStorage）。实测通过：历史消息与 Markdown（标题/加粗/代码块/表格/列表）渲染；中文消息发送与逐段流式回复；思考折叠块（完成后收起、可展开回看）与工具折叠块（查询与结果）；回复完成后出现复制按钮；模型选择显示服务端默认模型且无供应商配置时正确禁用；390px 窄屏无横向溢出，宽窄屏截图核查通过。验证脚本位于仓库外的临时目录（零依赖 Node 假后端，契约对齐 conversation-store 与 client-runtime 的 SSE 帧格式），验证后已停止并清理其进程，不影响原有 dev 环境。宽屏下气泡占满内容宽度、与旧视图 max-w-3xl 居中样式不同，属预期差异，P3b 切换时统一调整。滚动跟随、历史前插锚点的手工核查与真实后端验证仍待完成。

## M1：assistant-ui 移除（P3b 完成）

Web 主聊天已默认渲染共享 ChatScreen（`SharedThread` 经 `useChatSession` 消费唯一 ChatSession），旧 assistant-ui 实现彻底移除：删除 `apps/web/src/components/assistant-ui/`（thread/slash-command-input/use-antler-runtime）、localStorage 开关与 `AssistantRuntimeProvider`，旧外层通知条与"加载更早消息"按钮由 ChatScreen 内建实现替代（凭据警告在欢迎页同样显示）；会话头部（标题与移动端抽屉触发）保留在 `chat.tsx`。`useAntlerRuntime` 重命名为 `useChatSession` 并移至 `apps/web/src/views/chat/`，仅返回 session/state 与派生值。依赖移除 `@assistant-ui/react`、`@assistant-ui/react-markdown` 及随之无用的 `remark-gfm`（lockfile 中 assistant-ui 与 zustand 均已消失）；Vite 删除绑定旧 runtime 的整页刷新插件；删除 `styles/chat.css` 的全部 aui-* 旧样式。测试迁移：模型选择/凭据配置断言改经真实 SharedThread 与共享 ModelPicker；session hook 行为测试（幂等重试、会话重置、旧快照拒绝、凭据门控、StrictMode 释放、live 内容不被旧快照擦除）迁至 `use-chat-session.test.ts`；旧组件测试删除；conversation fixture 换用自有消息类型。验证：`pnpm check` 0 错误；全量测试 platform 4 / chat-core 19 / app 138 / backend 367 通过；`pnpm build`（Web/后端/Expo 导出）通过；Docker 镜像以冻结 lockfile 构建，在隔离 PostgreSQL 容器中验证 Web 页面 200、未授权 API 401、鉴权 API 200，产物 bundle 含共享 UI 且不含 assistant-ui。视觉上共享视图气泡为全宽布局，与旧版居中窄栏不同，按共享 tokens 后续统一。旧视图已不可回退，回滚需完整回退本次发布。

## P4 第一域：会话列表

新增共享 `ConversationList`（RN primitives 经 RNW 复用）：会话标题按钮（当前会话加粗、无障碍标签）、空态文案、可选重命名/删除意图回调和"加载更多会话"分页入口。Web 聊天侧栏的会话历史区块已替换为该组件，宿主把意图回调映射回完整 Conversation 对象（重命名/删除对话框逻辑留在 Web 壳）。组件测试覆盖选中高亮、选择回调、空态、重命名/删除/分页；既有抽屉导航、会话归属测试通过（抽屉内会话按钮语义保持 button 角色）。`pnpm check`、全量测试、`pnpm build` 通过；浏览器以隔离假后端核查宽屏侧栏（条目、当前会话加粗、操作按钮）并截图；重建 Docker 镜像并经隔离 PostgreSQL 冒烟（Web 200、401/200、产物含共享侧栏）。与旧实现的视觉差异：操作按钮常显（旧版悬停显示），重命名/删除仍走 Web 对话框。侧栏其余区块（logo、新建、知识库入口、个人资料）仍为 Web 专属，待后续域迁移。

P2 剩余能力两项落地：实验入口接入 `expo-clipboard` 实现原生复制（替代此前仅 Web 可用的 `navigator.clipboard`，类型检查与 Expo 导出通过，真机复制行为待设备验证）；共享 Markdown 引入 `remend` 流式补全——MessageMarkdown 新增 `streaming` 输入（仅由 running/live 消息传入），流式中未闭合的加粗/斜体/行内代码/删除线等语法在展示层自动补全，领域消息文本不被改写（live 标记移除后按原文重新解析，有组件测试覆盖）。链接补全产物 `streamdown:` 协议在共享渲染器中按纯文本处理，不会成为可点击外链。`pnpm check`、全量测试、`pnpm build` 通过。语法高亮与脚注/中文强调增强仍未实现。

移动端登录与令牌获取（P2 认证缺口）已实现：新增 `native-auth` 模块——从后端 `/api/auth-config` 读取认证模式（后端不可达或非 supabase 时降级 local，与 Web 宿主语义一致，该降级由测试先行暴露后修复）、创建使用 AsyncStorage 持久会话与自动刷新的 Supabase 客户端、邮箱密码登录/退出、读取持久会话访问令牌。实验入口在 Supabase 模式下提供登录表单（密码错误翻译为可读文案），连接时从登录会话取最新令牌而不再手输；local 模式保持手输令牌。类型检查、apps/mobile/Web 导出与全量测试（app 143 项含新增 native-auth 测试）通过。登录界面、令牌自动刷新、会话持久化与跨重启恢复的真机行为仍待设备验证；密码找回等完整认证流程不属于本阶段范围。

## P4 第二域：登录/注册/找回密码

完整认证表单状态机已下沉为共享 `AuthForm`（`packages/ui`）：登录、注册验证码、找回密码验证码、重置密码四种流程的字段渲染、倒计时限流、错误/通知面板与模式切换全部组件化；认证协议经 `AuthFormActions` 回调注入（错误码翻译 friendlyAuthError 一并共享），Supabase 调用与 SiteFiling、背景壳留在 Web 宿主（`login-view.tsx` 变为薄适配层）。既有 12 项 auth 行为测试全部保持通过（邮箱不可编辑改为断言 readonly——RNW `editable=false` 的等价表达，语义不变）；浏览器以假后端 supabase 模式核查登录/注册/找回视图渲染与模式切换、390px 窄屏无横向溢出并截图；重建 Docker 镜像冒烟通过（产物含共享登录表单）。Supabase 网络调用行为与旧实现一致（同一 lib/auth），注册/找回的真实邮件流程未在本环境验证。与旧版视觉差异：输入框/按钮为共享 tokens 样式，布局结构一致。

## P4 第三域：设置与模型配置

供应商配置表单已下沉为共享 `ProviderConfigForm`（`packages/ui`）：名称、协议（分段单选，`aria-checked` 标注当前选择）、Base URL、API Key、模型列表增删与默认模型单选、绑定凭据提示、提交前与旧版一致的归一化（trim/去重/默认模型回退/名称回退"自定义供应商"）、可选恢复默认按钮。Web 设置对话框的供应商页已替换为该组件（dialog 框架、profile/about 页留 Web 壳），归一化与状态逻辑从 dialog 删除。既有 settings 测试适配后通过（协议断言改 radio `aria-checked`——RNW 对 `accessibilityState.checked` 不映射，组件直接传 `aria-checked`）；新增 3 项共享表单测试覆盖模型增删与默认回退、归一化、绑定提示与协议切换。`pnpm check`、全量测试（app 146 项）、`pnpm build:web`、Docker 镜像重建与隔离 PostgreSQL 冒烟通过。profile/about 页与 dialog 框架仍为 Web 专属，待后续域评估是否共享。

## P4 第四域：Agent 列表

Agent 列表展示已下沉为共享 `AgentList`（`packages/ui`）：分组（我的/已发布）、卡片（图标位、名称、发布状态、描述、技能数与作者尾注）、空态；导航经 `renderLink` 插槽注入（Web 用 react-router Link 保留 link 角色与 href 语义，原生用路由导航），图标渲染经 `renderIcon` 注入（Web 传 lucide 版 AgentIcon，原生后续自实现）。Web `agent-list.tsx` 改为数据映射 + 薄适配层，仅在加载完成且无错误时渲染（共享空态替代旧空态，避免加载闪现）。12 项 platform 行为测试全部保持通过（分组标题、编辑/开始对话链接的 href、内置 Agent 无编辑入口等断言未变）。`pnpm check`、全量测试、`pnpm build:web` 通过。Agent 编辑页（图标生成/上传、技能绑定、工作区填充）属平台专有能力较重的复杂编辑，按计划通过平台组件实现，尚未共享化。

## P4 第五域：技能库

平台技能列表已下沉为共享 `SkillList`（`packages/ui`）：条目（名称、状态与不可绑定原因、描述、文件数/体积/时间）、空态与删除意图回调；ZIP 上传是平台能力，覆盖更新入口经 `renderUpload` 插槽注入（Web 传文件选择元素，删除确认留在 Web 宿主）。Web `skill-library.tsx` 保留上传表单与上传/删除流程（平台能力），列表区替换为共享组件。14 项 platform/agent-chat 测试通过（技能页仅断言空列表）。`pnpm check`、全量测试、`pnpm build:web`、Docker 镜像重建与冒烟通过。

## P4 收尾状态与明确范围决策

可共享的页面内容组件均已下沉 `packages/ui` 并接入 Web：ConversationList（会话侧栏）、AuthForm（登录/注册/找回）、ProviderConfigForm（供应商配置）、AgentList（Agent 列表）、SkillList（技能库）；共享 ChatScreen 已是 Web 默认（M1）。两项按计划"复杂编辑/平台专有能力"标准明确保留在 Web 壳：定时任务对话框（546 行 CRUD，涉及 Web DOM 与确认流程，移动端支持范围在 P5 前单列决策）与 Agent 编辑页（图标生成/上传、技能绑定、工作区自动填充为平台能力密集的复杂编辑）。profile/about 为 Web 壳性质的小页面（版本/运行环境信息、PWA 备案），不迁移。每域均通过既有行为测试 + `pnpm check`/`pnpm test`/`pnpm build:web` + Docker 镜像冒烟；共享组件的桌面与窄屏视觉核查在共享 ChatScreen/登录页/侧栏已完成截图核查，其余共享组件随 Web 壳布局工作。剩余：P0/P5 的真机与双平台 Release 验收（需签名团队、真实设备与目标 HTTPS 后端，本机环境不具备），以及 scheduler/agent-edit 的移动端范围决策后的实施。

## P4 收尾决策：移动端支持范围（scheduler / agent-edit）

按计划"复杂编辑或平台专有能力通过平台组件实现，并明确移动端支持范围"的授权，明确 M2 移动端首版支持范围：**移动端包含**聊天（共享 ChatScreen）、会话切换、登录与凭据配置（`AuthForm`/`ProviderConfigForm`）、Agent 查看与对话（`AgentList`）；**移动端显式不含**定时任务管理（scheduler-dialog，546 行 CRUD，Web DOM 密集）与 Agent 编辑（图标生成/上传、技能绑定、工作区自动填充为平台能力密集的复杂编辑）——两者在 Web 壳保留现有实现，移动端入口不暴露。该决策替代"决策后实施"的待办；若产品后续要求移动端编辑能力，按共享表单状态机 + 平台上传/推断能力插槽的既有模式单独立项。

## P2 增强：语法高亮、脚注与 CJK 强调

共享 Markdown 三项能力落地（此前记录的缺口全部关闭）：`lowlight`（highlight.js common 子集）为围栏代码按语言分段着色渲染（hljs 类名到颜色的简化映射，未知语言或解析失败回退纯文本，高亮仅作用于展示层）；`markdown-it-footnote` 支持脚注引用（上标 [n]）与文末脚注块；`markdown-it-cjk-friendly` 使 **加粗** 等强调与中日韩文字相邻时正常解析。`markdown-it-footnote` 未随包发布类型，经本地桥接模块集中 `@ts-expect-error`。组件测试覆盖 CJK 强调、脚注渲染、高亮分段、未知语言回退；既有 Markdown 测试（HTML 转义、表格、流式重解析）适配高亮分段后通过。`pnpm check`、全量测试（app 148 项）、`pnpm build`、Expo 导出通过。

## P0 设备基线推进：iOS 模拟器构建与启动验证

本机 Android SDK 环境现已就绪（ANDROID_HOME 指向 SDK，build-tools/emulator/platform-tools/NDK 27/JDK 24，AVD Nexus_S_API_28 与 Pixel_3_API_29 可用），此前记录的"缺少 SDK"状态已解除。正在重新构建 iOS 模拟器 Debug 应用（此前产物被清理）并计划完成安装与启动验证，随后执行 Android 模拟器同类检查。模拟器验证仍不替代真机与独立 Release 的 HTTPS 验收。

iOS 模拟器 Debug 构建重新完成（`expo run:ios`，BUILD SUCCEEDED）：应用 AntlerP0Probe 已安装至 iPhone 17 Pro 模拟器（iOS 18.x）、`simctl launch` 成功（进程 28693），截图确认「原生聊天验证」配置页完整渲染（后端地址、认证方式、会话 ID、模型协议/列表/Key 等字段与操作按钮），本次会话新增的「模型列表（逗号分隔）」字段已出现在真机配置表单。模拟器 Debug 运行不替代真机与 Release 验收。Android 侧：本机 SDK 就绪但旧 AVD 的 x86 镜像不可用（Apple Silicon），本地仅有空的 android-32 arm64 镜像骨架，正在补装系统镜像后创建 AVD 并执行同类安装/启动检查。

Android 模拟器验证完成：补装 arm64 系统镜像（android-32，4.2GB）与 NDK 27.1.12297006（本地目录此前为空骨架，缺 source.properties 导致首次构建失败，重装后解决；gradle 依赖解析需系统代理，经用户级 `~/.gradle/gradle.properties` 配置 127.0.0.1:7897 解决 dl.google.com/plugins.gradle.org 的 TLS 握手失败——代理配置在本机用户目录，不进仓库）。`assembleDebug` BUILD SUCCESSFUL（5m8s），APK 经 Streamed Install 成功装入 Antler_API32 模拟器（emulator-5554），MainActivity 前台运行，截图确认配置页与 iOS 模拟器一致渲染。双平台模拟器 Debug 基线（构建、安装、启动、UI 渲染）至此完整通过；带鉴权 SSE、断线恢复与 Release 验收仍需真机与目标 HTTPS 后端。

## P0 模拟器验收：鉴权 API、流式 SSE、取消、断线与前后台

为支撑模拟器自动化验证，实验入口增加深链验证钩子：`com.antler.p0probe://autostart?serverUrl=...&accessToken=...&conversationId=...&message=...&cancelAfter=...` 预填配置、自动连接、自动发送与定时取消——仅由 `simctl openurl` 触发，正常启动与手动使用不受影响；mobile 类型检查通过。iOS 模拟器（Debug 构建 + Metro）实测以下各项并留有截图：

1. **鉴权 API**：无令牌请求被 401 拒绝（假后端），带 `x-antler-token` 的会话快照、消息分页、变更 SSE 均通过。
2. **带鉴权头中文流式 SSE**：自动发送中文消息后，逐段增量到达并渲染——思考折叠块、工具折叠块、Markdown 标题/加粗/表格/列表与高亮代码块全部正确显示（POC 脚本含中文 delta 与工具事件）。
3. **断线续传**：杀掉后端后重启，应用自动重连会话变更 SSE 并从上次已消费游标（afterChangeId=3）续传，符合"从最后已消费游标重连"协议。
4. **前后台恢复**：切至系统设置再返回后，onForeground 触发 session.refresh()（后端收到第二次会话快照请求），符合"回前台校验权威快照"。
5. **取消（Abort）**：模拟器端到端取消未稳定复现——假后端脚本事件流的时序竞态（cancel 请求到达后端但 run.completed 先于 run.cancelled 被消费，或晚于流结束）。取消逻辑本身由 client-runtime 会话测试（显式停止、取消后订阅停止、旧响应隔离）覆盖；端到端取消待真机验收。
6. **HTTPS**：mkcert 自签 CA 仅能装入用户级钥匙链（无 sudo 安装系统信任），iOS 模拟器不采信用户级信任导致 TLS 失败；按 Apple 文档 ATS 不适用于 loopback，改用 HTTP 本机后端完成上述验证——HTTP 属计划允许的开发例外，且此前已验证生成配置中 ATS 例外（NSAllowsArbitraryLoads/NSAllowsLocalNetworking）均为 false，明文例外不会进入发布构建。

iOS/Android 独立 Release 构建进行中。Android Release 因明文例外仅存在于 debug manifest（此前已验证）且模拟器无法信任自签 CA，无法连接本机后端完成 SSE 验收——该约束即计划"Release 验收需要目标 HTTPS 后端"的实质，真机 + 真实 HTTPS 后端验收不可在本机替代。

双平台独立 Release 构建完成并验证：iOS Release（`expo run:ios --configuration Release`，嵌入 JS bundle、无 Metro）与 Android Release（`assembleRelease`，68.8MB APK）均构建成功；iOS Release 在模拟器安装、启动、渲染配置页，并正确读取 SecureStore/AsyncStorage 持久化配置（地址、令牌掩码、会话 ID 全部恢复）。**Release 构建在运行时强制拒绝明文地址**（`__DEV__=false` 时 `validateServerUrl` 要求 HTTPS，错误提示"服务地址必须为 HTTPS 地址"）——从运行时行为佐证了"发布构建不携带明文例外"的 P0 检查项。Release 的鉴权 SSE 端到端验收因此需要系统信任 CA 的 HTTPS 后端：自签 CA 无法装入模拟器 iOS 信任链（无 sudo 安装系统级信任，用户级钥匙链不被采信），该验收需真机 + 真实 HTTPS 后端，本机不可替代（Android Release 同理且更严格）。模拟器可执行的全部 P0 验收至此完成：鉴权 API（401/通过）、中文增量流式 SSE、思考/工具/Markdown 渲染、断线续传（游标重连）、前后台恢复、双平台 Release 构建安装启动与 HTTPS 强制。未完成项：真机 Release 的 HTTPS SSE、断线重连与前后台恢复验收，端到端取消（模拟器假流式时序竞态，逻辑已由测试覆盖），以及真实 Supabase 会话的 Token 刷新。

## P0 模拟器验收补充：取消与 Token 刷新闭环

两项此前的未决项已在模拟器完成端到端验证：

1. **取消（Abort）**：假后端修正取消保真度（真实后端取消后不再产生内容事件——收到取消即跳过剩余内容直接终止于 run.cancelled）。模拟器实测：深链 `cancelAfter=2500` → 应用发出 `POST /api/runs/run-3/cancel` → 回复在工具调用块后截断、无正文事件、UI 恢复非运行态——与真实后端取消行为一致。
2. **Supabase 登录与 Token 刷新**：假后端新增 GoTrue 协议模拟（password grant / refresh_token grant / logout）。模拟器实测完整链路：深链登录 → `POST /auth/v1/token?grant_type=password` 成功 → 会话以签发令牌（st- 前缀）通过鉴权加载并发送流式回复 → `expires_in=5` 秒后 `autoRefreshToken` 自动触发 `POST /auth/v1/token?grant_type=refresh_token`（后端计数确认刷新发生）→ 刷新后继续正常通信。移动端登录、持久会话与自动刷新的端到端行为至此验证；真实 Supabase 项目的协议一致性仍属后续真实后端验证范围。

P0 模拟器可执行验收至此全部闭环：鉴权 API（401/通过）、中文增量流式 SSE、思考/工具/Markdown 渲染、断线续传（游标重连）、前后台恢复、取消（Abort）、Supabase 登录与 Token 自动刷新、双平台 Release 构建安装启动与 HTTPS 运行时强制。剩余 P0/P5 项均为物理设备约束：真机 Release 的 HTTPS SSE/断线重连/前后台恢复验收、真实 Supabase 协议一致性、跨设备凭据场景（P5 表格）。

## P0 验收推进：iOS 独立 Release 的公网 HTTPS API 与鉴权 SSE

通过公网隧道（localhost.run，公信 CA 签发证书，模拟器信任链天然信任）将本机假后端暴露为 HTTPS 地址，完成了此前判定需真实 HTTPS 后端的验收项——证明该缺口并非不可达成：

1. **iOS 独立 Release 构建连接公网 HTTPS**：Release（嵌入 bundle、无 Metro、运行时强制 HTTPS）经 `autostart` 深链配置 `https://<隧道域名>`，TLS 握手经公信证书通过，鉴权头通过，会话快照与消息分页加载成功。
2. **Release 构建的鉴权流式 SSE**：自动发送中文消息 → `POST /api/runs` → 增量中文回复渲染（思考折叠块、工具折叠块、Markdown 标题与加粗）——Release 构建的完整 HTTPS 传输链路验收通过（截图留档）。
3. 中途一次隧道被服务端回收后，应用表现为持续的 HTTPS 重试（"无法加载会话，正在重试"），与新隧道建立后即恢复——与断线重连协议一致。

为使 Android Release 具备同样的深链自动化能力，`app.json` 增加 `"scheme": "antler"`（发布应用标准配置，P5 深链亦需要），Android Release 正在重建。至此 P0 中原判定需"系统信任 CA 的真实 HTTPS 后端"的验收已在模拟器上通过公信证书达成；与真机验收的剩余差异仅为签名安装与物理设备本身。

## P0 验收闭环：Android 独立 Release 的公网 HTTPS API 与鉴权 SSE

Android Release（含 `antler://` scheme 的 manifest，经 prebuild 重建）安装至模拟器后，经 `adb` 深链配置公网 HTTPS 隧道地址完成同类验收：公信 CA 证书 TLS 握手通过、鉴权头通过、会话快照与消息分页加载、`POST /api/runs` 创建运行、中文增量回复经 SSE 渲染（思考折叠块、工具折叠块、Markdown）——双平台独立 Release 构建的 HTTPS API 与带鉴权头 SSE 验收至此在模拟器上完整闭环（截图留档）。过程中 localhost.run 免费隧道两次被服务端回收，应用每次均按协议进入持续重试并在隧道恢复后立即恢复——断线重连行为再次得到验证。记录 adb 深链的引号转义注意事项（`&` 需在 shell 层保护，否则参数被截断）。

## P0/P5 本机验收最终状态

模拟器上可执行的 P0/P5 验收已全部完成：双平台 Debug/Release 构建、安装、启动、UI 渲染；鉴权 API（401/通过）；中文增量流式 SSE 与完整消息渲染；断线续传（游标重连，多次实证）；前后台恢复；取消（Abort）；Supabase 登录与 Token 自动刷新；iOS/Android 独立 Release 经公信 HTTPS 的 API 与鉴权 SSE；发布构建的 HTTPS 运行时强制。剩余项均为物理设备固有约束：真机安装/签名（Apple 开发者账号与 Android 签名配置）、真机网络栈与性能表现、P5 跨设备凭据场景（需两台物理客户端）、真实 Supabase 项目的协议一致性。这些项的实现基础（深链自动化钩子、假后端协议模拟、隧道验收方法）已全部就位，可在设备到位后直接复用。

## P5 推进：移动端完整导航（共享组件组装）

移动端入口从单页实验形态扩展为多页面导航：新增主页（`home-page.tsx`）——「直接开始对话」、服务与凭据配置入口、经共享 `AgentList`（意图回调导航 + 图标占位注入）展示从 `/api/agents` 加载的 Agent 分组列表与空态；聊天/配置视图复用现有 `NativeChatProbe`（内含共享 `ChatScreen`），顶部提供「← 主页」返回。autostart 深链监听提升至 App 层（getInitialURL + url 事件统一收集，经 prop 传入聊天视图），冷启动深链直接进入聊天并自动连接。`app.json` 增加 `"scheme": "antler"`（Android 深链）。iOS 模拟器实测：冷启动渲染主页（标题、入口、空态）、深链切换至聊天视图并完成会话加载与历史渲染（截图留档）；选择 Agent 进入聊天时 `initialAgentId` 经 connect 合并生效（逻辑同模型切换路径）。返回按钮的点击行为与 Agent 条目点击进入对应会话需 UI 自动化（simctl 无点击能力），以主页渲染与深链切换证据为准。`pnpm check`、全量测试通过。P5 的「完整共享页面导航」代码侧与模拟器渲染验证至此完成；完整导航栈（Expo Router 文件路由、会话侧栏在移动端的呈现）按计划属产品形态决策，当前导航已满足共享页面组装与跨页面流转的验收基础。

## P5 导航栈形态决策（依据实测）

按计划"默认 Expo Router"的选型进行了实施尝试：安装 expo-router 并建立文件路由（apps/web/_layout.tsx、index、chat、autostart 路由，深链 antler://autostart 经路由参数转发）。实测发现 SDK 58 的版本矩阵问题：registry 上的 expo-router 6.0.24 与 react-native-screens 4.30.1 存在 iOS 编译不兼容（LinkPreviewNativeNavigation.mm 引用不存在的 RNSBottomTabsScreenComponentView）；SDK 对齐版本 58.0.28 编译通过但运行时出现 React 渲染错误（hooks dispatcher 未初始化，疑似 screens/router 组合的副本或时序问题）。依据计划"最终以选定版本的包元数据与设备实测为准"，**决策：移动端导航栈当前采用已验证的状态驱动导航（主页 ⇄ 聊天/配置，共享 AgentList 组装），Expo Router 待 SDK 58 版本矩阵修复（screens/router 补丁）后引入**；文件路由结构已在本次尝试中验证可行（深链→路由参数→聊天自动连接的接线方式已跑通），重新引入时按既有组件直接映射。回退后 `pnpm check`、全量测试通过。
