# Mobile 构建配置

正式构建默认使用 `https://www.xiaoanai.top`；也可在构建时通过公开的 `EXPO_PUBLIC_ANTLER_SERVER_URL` 注入其他环境地址，例如 `https://antler.example.com`。开发和测试构建须显式注入地址。它是应用唯一的后端地址，不要在其中放凭据或令牌。`ANTLER_MOBILE_ENV` 可为 `development`、`test` 或 `production`，默认为 `production`。正式构建只允许 HTTPS；开发和专用测试构建可使用 HTTP，并在原生配置中为指定主机生成 ATS 例外及 Android 明文策略。修改环境或地址后必须重新生成原生配置并重新构建，检查生成的 iOS Info.plist 和 Android manifest；已有原生工程不会自动应用 app.config.js 的变更；应在干净检出中生成工程，并确认 iOS 安装包的 `CFBundleDisplayName` 为 `Antler`。本机旧的 P0 工程不会因修改 Expo 配置自动更名。

`ANTLER_MOBILE_AUTOMATION=true` 仅在 `development` 或 `test` 构建启用诊断和 `antler://autostart`，正式构建始终关闭。测试构建启动并完成必要登录后，可运行：

```sh
node scripts/mobile-autostart.mjs --platform ios --message '你好'
node scripts/mobile-autostart.mjs --platform android --message '请详细回答' --cancel-after 1500
```

可通过 `--device` 选择模拟器或 Android 设备；iOS 真机须同时指定 `--ios-physical --device <设备标识>`，使用已签名并安装的测试包。`--agent-id` 和 `--conversation-id` 可选择测试目标。深链不接受后端地址和 local 访问令牌，无法覆盖构建地址。Supabase 自动登录仅在测试构建中支持深链的 `email` 和 `password` 参数；测试凭据不要写入仓库或日志。

发版前须用与正式包相同的环境和地址验证两平台实际地址、TLS、服务端认证配置、登录、流式对话和异常恢复，并对正式包本身做冒烟测试。Supabase 配置必须完整；受 local 令牌保护的部署仅支持持有与该地址绑定的旧令牌的升级设备。确认公网部署具备受信任的访问控制；不要为适配新设备而关闭访问控制。Expo Updates 的配置更新和回滚尚未纳入此流程。

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
EXPO_PUBLIC_ANTLER_SERVER_URL=https://www.xiaoanai.top pnpm --filter @antler/mobile android:device
```

这是开发调试构建。首次运行时 Expo 会生成 Android 工程；已有工程若需要同步环境或原生配置，先在 `mobile/` 中使用相同环境变量执行 `pnpm exec expo prebuild --platform android`，再重新运行脚本。

## 当前验证记录

2026-11-01 从开发机访问 `https://www.xiaoanai.top`：TLS 校验通过，`/health` 和 Supabase 健康接口返回 200，公开认证配置声明 Supabase，未登录请求受保护 API 返回 401。使用该地址和 `production` 配置构建的 iOS 模拟器 Release 包中，地址、禁用自动化及禁用明文例外均已核对。同一配置的未签名 iPhone 架构 Release 构建也已通过，包内地址和 ATS 策略已核对；该构建使用本机旧 P0 原生工程，其安装名仍需按上文重新生成。在隔离目录执行干净的 Expo prebuild 后，已确认生成的安装名为 Antler、包标识保留 `com.antler.p0probe`，且 ATS 不含开发例外。使用正式地址和模拟器专用临时签名启动后，已观察到 Supabase 登录页面正常显示；未执行登录或聊天。这些检查不替代正式签名包在 iPhone 上的登录、流式聊天、重启恢复和异常恢复验证；当前机器尚无可用签名身份。

同日使用干净生成的 iOS 工程和当前源码完成未签名 iPhone Release 构建；检查构建产物确认显示名为 Antler、包标识为 `com.antler.p0probe`、地址为 `https://www.xiaoanai.top`，自动化和 HTTP 均关闭，ATS 不允许任意或本地网络例外。该产物尚未签名或安装到真机。

随后使用 Apple Development 证书完成同一生产配置的 iPhone Release 构建，签名检查通过，设备包含在开发描述文件中，应用已成功安装。首次启动被 iOS 以安全原因拒绝，系统提示签名、权限或开发者信任可能存在问题；尚待在设备上确认开发者信任并重试。该开发签名构建并非 App Store 分发签名，尚未完成真机冒烟验证。

设备上确认信任后，应用已成功启动，设备进程列表中可见 Antler。

之后用户在 iPhone 上完成登录，真机界面显示对话及回复；用户确认重启后可以加载历史会话，回复逐步显示，断网恢复后可以重新发送并收到回复。以上真机验证使用 Release 配置及 Apple Development 签名，尚未验证 App Store 分发签名包。
