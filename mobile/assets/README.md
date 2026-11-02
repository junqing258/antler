# 移动端图标

- `icon.png`：从 `web/public/antler-logo.svg` 导出的 1024×1024 白底 RGB 图标，用于 iOS 和 Android 旧版启动器。
- `adaptive-icon.png`：同一 Logo 缩放至原画布的 60% 并居中，透明底，用于 Android 自适应图标前景；白色背景由 `app.json` 指定，留白避免鹿角被启动器遮罩裁切。
- `antler-logo.png`：应用内 Logo，不用于打包图标。

图标通过 `mobile/app.json` 配置。新建原生工程时 Expo prebuild 会自动生成平台资源；已有 `ios/`、`android/` 时，修改图标后需要重新运行 prebuild，再构建并安装 App。Metro 热更新和 `expo export` 不会更新桌面图标。

在 `mobile/` 下执行 `pnpm exec expo prebuild --no-install`，使用与目标构建一致的 `ANTLER_MOBILE_ENV` 和 `EXPO_PUBLIC_ANTLER_SERVER_URL`。真机开发需使用 development 环境及可访问的局域网后端地址；iOS 本地构建还需保留工程中的 `ENABLE_USER_SCRIPT_SANDBOXING=NO` 设置，详见 `scripts/ios-device.sh`。
