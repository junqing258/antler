# Mobile 构建配置

正式构建默认使用 `https://chat.xiaoanai.top`；也可在构建时通过公开的 `EXPO_PUBLIC_ANTLER_SERVER_URL` 注入其他环境地址，例如 `https://antler.example.com`。开发和测试构建须显式注入地址。它是应用唯一的后端地址，不要在其中放凭据或令牌。`ANTLER_MOBILE_ENV` 可为 `development`、`test` 或 `production`，默认为 `production`。正式构建只允许 HTTPS；开发和专用测试构建可使用 HTTP，并在原生配置中为指定主机生成 ATS 例外及 Android 明文策略。修改环境或地址后必须重新生成原生配置并重新构建，检查生成的 iOS Info.plist 和 Android manifest；已有原生工程不会自动应用 app.config.js 的变更；应在干净检出中生成工程，并确认 iOS 安装包的 `CFBundleDisplayName` 为 `Antler`。本机旧的 P0 工程不会因修改 Expo 配置自动更名。

`ANTLER_MOBILE_AUTOMATION=true` 仅在 `development` 或 `test` 构建启用诊断和 `antler://autostart`，正式构建始终关闭。测试构建启动并完成必要登录后，可运行：

```sh
node scripts/mobile-autostart.mjs --platform ios --message '你好'
node scripts/mobile-autostart.mjs --platform android --message '请详细回答' --cancel-after 1500
```

可通过 `--device` 选择模拟器或 Android 设备；iOS 真机须同时指定 `--ios-physical --device <设备标识>`，使用已签名并安装的测试包。`--agent-id` 和 `--conversation-id` 可选择测试目标。深链不接受后端地址和 local 访问令牌，无法覆盖构建地址。Supabase 自动登录仅在测试构建中支持深链的 `email` 和 `password` 参数；测试凭据不要写入仓库或日志。

发版前须用与正式包相同的环境和地址验证两平台实际地址、TLS、服务端认证配置、登录、流式对话和异常恢复，并对正式包本身做冒烟测试。Supabase 配置必须完整；受 local 令牌保护的部署仅支持持有与该地址绑定的旧令牌的升级设备。确认公网部署具备受信任的访问控制；不要为适配新设备而关闭访问控制。Expo Updates 的配置更新和回滚尚未纳入此流程。

## iPhone 真机开发

USB 连接并解锁 iPhone，确认信任电脑并开启开发者模式；在 Xcode Accounts 登录开发者账号，并在本机 iOS 工程的 Signing & Capabilities 中选择 Team、启用 Automatically manage signing。运行：

```sh
pnpm --filter @antler/mobile ios:device
```

真机开发脚本会为 Expo 的 xcodebuild 构建补充 `-allowProvisioningUpdates` 和 `-allowProvisioningDeviceRegistration`，允许 Xcode 创建或续期开发描述文件并注册设备。这样即使工程已经配置 Team，也不会因 Expo 跳过签名初始化而报 `No profiles ... were found`。免费 Personal Team 签名过期后重新执行此命令；如仍失败，检查 Xcode 账号登录状态、Team 和开发证书。`ios:device metro` 仅启动 Metro，不执行签名或构建。

## iPhone 个人自用 Release

使用免费 Personal Team 在自己的 iPhone 上运行 Release 版本，在仓库根目录执行：

```sh
# USB 连接并解锁 iPhone，确认信任电脑、开启开发者模式
# 使用本机 Team，自动选择唯一已连接的 iPhone
pnpm build:ios:device

# 连接多台 iPhone 时指定 UDID
pnpm build:ios:device --device 你的iPhoneUDID

# 复用已有 Release 归档，跳过重新编译
pnpm build:ios:device --archive apps/mobile/dist/ios/<时间>/Antler.xcarchive
```

此命令使用 `production` 配置和正式 HTTPS 后端，创建 Apple Development 签名的 Release 归档，直接将归档中的 `.app` 安装到手机并启动，不执行 App Store IPA 导出，也不依赖 Metro。安装会更新手机上相同 Bundle ID 的应用。默认只自动选择已连接的真实 iPhone；找不到设备或连接多台时会提示处理。若已安装但启动被系统拒绝，请解锁手机并在设置中确认开发者信任后手动打开 Antler。

Personal Team 不需要开通 App Store 分发会员即可执行上述个人安装，但开发签名有有效期，过期后需要重新运行构建安装命令。后端仍需可通过网络访问。需要 App Store / TestFlight 分发时，使用下方的 `pnpm build:ios` 流程。

## iOS 正式包

在 macOS 上安装完整 Xcode、CocoaPods 和工作区依赖，并在 Xcode 的 Accounts 中登录有发布权限的 Apple 开发者账号。App Store Connect / TestFlight 导出需要 Apple Developer Program 分发身份及匹配的 App ID。当前 Bundle ID 为 `com.antler.p0probe`，由 `apps/mobile/app.json` 决定；首次上架前确定最终标识，已有上架记录则保持一致。

在仓库根目录执行：

```sh
# 使用本机 iOS 工程的 Team，生成 Release 归档和 IPA；不会上传
pnpm build:ios

# 显式指定其他 Team
pnpm build:ios --team ABCDE12345

# 也可通过环境变量提供 Apple Team ID
APPLE_TEAM_ID=ABCDE12345 pnpm build:ios

# 指定正式 HTTPS 后端与产物目录（相对路径从执行命令的目录计算）
pnpm build:ios --team ABCDE12345 --server-url https://antler.example.com --output apps/mobile/dist/ios/release-001

# 仅归档，随后在 Xcode Organizer 中手动分发
pnpm build:ios --team ABCDE12345 --archive-only

# 使用 Xcode 导出的签名配置，例如指定设备的分发配置
pnpm build:ios --team ABCDE12345 --export-options /absolute/path/ExportOptions.plist

pnpm build:ios --help
```

默认产物位于 `apps/mobile/dist/ios/<时间>/`：`Antler.xcarchive` 为签名归档，`ipa/*.ipa` 为导出的安装包，`ExportOptions.plist` 记录默认导出配置。脚本不会覆盖已有归档或 IPA 目录。App Store 分发包通过 TestFlight 或 App Store 安装；直接分发给已注册设备时，需提供相应的导出配置及描述文件。上传新构建前更新 `app.json` 中的 `expo.version` 和 `expo.ios.buildNumber`，避免重复构建号。

脚本强制 `production` 环境、关闭自动化和 dotenv 加载，后端地址依次取 `--server-url`、`EXPO_PUBLIC_ANTLER_SERVER_URL`、默认 `https://www.xiaoanai.top`，并拒绝 HTTP、凭据和查询参数。源码会复制到 `apps/mobile/dist/` 下的临时工程，复用已安装的 node_modules，通过当前 Node 直接调用已安装的 Expo CLI（不在临时目录执行 pnpm exec 或重新安装 JS 依赖），重新生成 iOS 工程并安装 Pods，然后执行 `xcodebuild archive` 与 `-exportArchive`；结束后清理临时工程，现有 `apps/mobile/ios/` 不会被修改。需要保留的原生定制必须通过 Expo 配置或 config plugin 提供。Team ID 按 `--team`、`APPLE_TEAM_ID`、本机 `apps/mobile/ios/*.xcodeproj/project.pbxproj` 中的 `DEVELOPMENT_TEAM` 顺序读取；本机只检测到一个 Team 时自动使用，检测到多个或未配置时要求显式指定。签名使用选定的 Team ID 和自动签名，允许 Xcode 更新描述文件；脚本不会自动上传到 App Store Connect。

如果 Release 归档成功而 IPA 导出失败，脚本会保留 `.xcarchive` 并显示路径。可用 `open /absolute/path/Antler.xcarchive` 在 Xcode Organizer 中重新分发，无需重新编译。若日志提示 Team 不具备所需会员资格、找不到 Distribution 证书或 App Store 描述文件，需要先在 Xcode Accounts 中配置具备分发资格的 Apple Developer Program Team 及相应签名身份；自动读取本机 Team ID 不代表该 Team 具备 App Store 分发资格。

`pnpm build:mobile` 仍只导出 JS 和资源，不生成 IPA。原生归档/导出需要实际可用的签名证书和描述文件，不能用 JS 导出成功替代正式包验证。

## Android 真机开发

安装 Android SDK 和 JDK，配置好 Android 开发环境；手机开启 USB 调试，连接电脑并授权，与电脑处于同一局域网。在仓库根目录运行：

```sh
pnpm dev:server
# 另开终端，构建、安装并启动应用及 Metro：
pnpm --filter @antler/mobile android:device
# 应用已安装时，仅启动 Metro：
pnpm --filter @antler/mobile android:device metro
# 指定设备：
pnpm --filter @antler/mobile android:device --device <设备名或标识>
```

脚本固定使用 `development` 环境，在 macOS 上自动从 en0/en1 获取局域网 IP，后端端口默认为 3210（可用 `ANTLER_PORT` 覆盖）。其他系统或需要连接指定后端时，显式设置地址：

```sh
EXPO_PUBLIC_ANTLER_SERVER_URL=https://chat.xiaoanai.top pnpm --filter @antler/mobile android:device
```

这是开发调试构建。首次运行时 Expo 会生成 Android 工程；已有工程若需要同步环境或原生配置，先在 `apps/mobile/` 中使用相同环境变量执行 `pnpm exec expo prebuild --platform android`，再重新运行脚本。

## 当前验证记录

2026-11-01 从开发机访问 `https://www.xiaoanai.top`：TLS 校验通过，`/health` 和 Supabase 健康接口返回 200，公开认证配置声明 Supabase，未登录请求受保护 API 返回 401。使用该地址和 `production` 配置构建的 iOS 模拟器 Release 包中，地址、禁用自动化及禁用明文例外均已核对。同一配置的未签名 iPhone 架构 Release 构建也已通过，包内地址和 ATS 策略已核对；该构建使用本机旧 P0 原生工程，其安装名仍需按上文重新生成。在隔离目录执行干净的 Expo prebuild 后，已确认生成的安装名为 Antler、包标识保留 `com.antler.p0probe`，且 ATS 不含开发例外。使用正式地址和模拟器专用临时签名启动后，已观察到 Supabase 登录页面正常显示；未执行登录或聊天。这些检查不替代正式签名包在 iPhone 上的登录、流式聊天、重启恢复和异常恢复验证；当前机器尚无可用签名身份。

同日使用干净生成的 iOS 工程和当前源码完成未签名 iPhone Release 构建；检查构建产物确认显示名为 Antler、包标识为 `com.antler.p0probe`、地址为 `https://www.xiaoanai.top`，自动化和 HTTP 均关闭，ATS 不允许任意或本地网络例外。该产物尚未签名或安装到真机。

随后使用 Apple Development 证书完成同一生产配置的 iPhone Release 构建，签名检查通过，设备包含在开发描述文件中，应用已成功安装。首次启动被 iOS 以安全原因拒绝，系统提示签名、权限或开发者信任可能存在问题；尚待在设备上确认开发者信任并重试。该开发签名构建并非 App Store 分发签名，尚未完成真机冒烟验证。

设备上确认信任后，应用已成功启动，设备进程列表中可见 Antler。

之后用户在 iPhone 上完成登录，真机界面显示对话及回复；用户确认重启后可以加载历史会话，回复逐步显示，断网恢复后可以重新发送并收到回复。以上真机验证使用 Release 配置及 Apple Development 签名，尚未验证 App Store 分发签名包。
