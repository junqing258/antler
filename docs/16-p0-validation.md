# React Native 迁移 P0 验证记录

日期：2026-10-31。此记录仅覆盖已执行的检查，P0 尚未通过验收。

## 候选版本

以 Expo SDK 58 为候选，官方版本表对应 React Native 0.88、React 19.3.0、React Native Web 0.21.0，Node.js 最低 22.13.x；iOS 最低 16.4、Xcode 最低 26.4。来源：[Expo SDK 版本参考](https://docs.expo.dev/versions/latest/)。实际包版本、Metro 和 TypeScript 兼容性仍须在最小 Expo 项目中验证，不能把候选矩阵当成已验收组合。

Web 宿主已升级 React/React DOM 及类型包至 19.3，现有 assistant-ui 界面仍保留。升级前 `pnpm check` 通过，前端测试 119/119、后端测试 367/367 通过。升级后 `pnpm check` 和前端测试 119/119 通过；依赖树检查显示 app 的 React 引用解析为 19.3.0。自动化测试不能替代浏览器视觉和交互核查。

## 待完成

- Expo 原生实际运行、完整依赖去重以及旧聊天界面的浏览器回归。
- 带鉴权 SSE 的真机与 iOS/Android 独立 Release 验证，以及可用于发布验收的 HTTPS 后端。
- Markdown、列表、输入法和软键盘的固定样例及性能评估。
- 平台接口、共享聊天界面及其余页面迁移，以及 P1 尚未完成的跨平台集成验证。

本机可调用 Xcode 和 iOS 模拟器；Docker CLI 可用；首次检查时 daemon 未运行，后续已连接并开始镜像验证。模拟器不替代计划要求的真机与 Release 验收。

## 验证入口与已测结果

- `pnpm dev:web` 启动后访问 `/rnw-probe.html`；`pnpm build:probe` 单独构建到 `app/dist-p0`，不将诊断页面纳入正常 PWA 构建。Vite 将精确的 `react-native` 导入解析到 RNW，并去重 React。
- `pnpm dev:mobile` 启动 Expo 实验入口；`pnpm build:mobile` 导出 iOS、Android 和 Web bundle。入口包含实验性聊天和原始 SSE 探针。探针中的令牌仅保存在页面内存中；聊天配置的保存方式见下文。
- Expo 安装检查通过，当前锁定的实际组合为 Expo 58、React 19.3.0、React Native 0.88.1、RNW 0.21.4、移动端 TypeScript 6.0.x。`expo export` 已分别生成 iOS、Android 和 Web bundle；这只验证 Metro 打包，不代表原生应用构建或设备运行通过。
- 在本机浏览器通过带鉴权校验的模拟 SSE 验证指定游标、跨 UTF-8 字节边界的中文、增量显示和中止；检查了桌面与 390px 窄屏布局。此结果不代表真实服务端、原生网络或 HTTPS Release 验收。
- 原生发布构建的聊天入口拒绝非 HTTPS；开发构建允许输入 HTTP 地址。真机访问开发电脑时不能使用手机的 `127.0.0.1`。
- Docker 构建需安装 mobile workspace 以供 Web 的诊断源码类型检查；镜像构建与启动结果需单独记录。

本轮完整后端测试在并行高负载时有两项超时（365/367）；`test/routes/config.test.ts` 和 `test/scheduler/shutdown.test.ts` 单独复跑 25/25 通过。

尝试 iOS 模拟器构建时，Expo prebuild 完成；CocoaPods 下载和安装依赖期间发现磁盘仅余约 1.5 GiB，因此中止安装，未进行 Xcode 构建。生成的 `mobile/ios` 已移入废纸篓，仍占用磁盘空间，清空废纸篓后才会释放；已下载的 React Native 构建缓存也保留。Android 未连接设备，现有模拟器尚未运行验证。

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
