#!/usr/bin/env bash
# 真机开发预览:iPhone 通过 USB 连接 Mac,与 Mac 同一 Wi-Fi。
# 用法(经 package.json 调用):
#   pnpm --filter @antler/mobile ios:device          # 构建安装到真机,完成后自动启动 Metro
#   pnpm --filter @antler/mobile ios:device metro    # app 已装好时,单独启动 Metro(免重新构建)
# 后端另行运行:pnpm dev:server(默认 ANTLER_HOST=0.0.0.0,否则手机连不上)。
#
# 真机预览踩坑记录(2026-11-02):
# - expo prebuild 生成 ios/ 时必须带 ANTLER_MOBILE_ENV=development 等环境变量,
#   否则 Info.plist 烘入生产 ATS 配置(NSAllowsLocalNetworking=false、无局域网声明),
#   app 报 "No script URL provided" / 无法连接服务器。
# - Xcode 工程里 ENABLE_USER_SCRIPT_SANDBOXING 必须为 NO(pbxproj 显式设置,
#   环境变量覆盖不了;prebuild 会重置回 YES,需改回)。
# - 免费个人签名 7 天过期;首次打开 app 需在 设置→通用→VPN与设备管理 里信任开发者。
# - 手机首次连后端/Metro 时 iOS 会弹"本地网络"权限,必须允许。
# 必须带 ANTLER_MOBILE_ENV / EXPO_PUBLIC_ANTLER_SERVER_URL,否则烘入生产地址。
set -euo pipefail

LAN_IP="$(ipconfig getifaddr en0 || true)"
if [ -z "${LAN_IP}" ]; then
  LAN_IP="$(ipconfig getifaddr en1 || true)"
fi
if [ -z "${LAN_IP}" ]; then
  echo "错误:无法获取 Mac 局域网 IP(en0/en1),请确认 Wi-Fi 已连接" >&2
  exit 1
fi

export ANTLER_MOBILE_ENV=development
export EXPO_PUBLIC_ANTLER_SERVER_URL="http://${LAN_IP}:${ANTLER_PORT:-3210}"
export ENABLE_USER_SCRIPT_SANDBOXING=NO

echo "LAN IP: ${LAN_IP}"
echo "后端地址: ${EXPO_PUBLIC_ANTLER_SERVER_URL}"

if [ "${1:-run}" = "metro" ]; then
  shift || true
  exec npx expo start "$@"
else
  # Expo skips provisioning updates when the native project already has a Team.
  # Scope the xcodebuild wrapper to this development build (not Metro-only runs).
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  export PATH="${SCRIPT_DIR}/ios-bin:${PATH}"
  exec npx expo run:ios --device "$@"
fi
