#!/usr/bin/env bash
# 真机开发预览:iPhone 通过 USB 连接 Mac,与 Mac 同一 Wi-Fi。
# 用法(经 package.json 调用):
#   pnpm --filter @antler/mobile ios:device          # 构建安装到真机,完成后自动启动 Metro
#   pnpm --filter @antler/mobile ios:device metro    # app 已装好时,单独启动 Metro(免重新构建)
# 后端另行运行:pnpm dev:server(默认 ANTLER_PORT=3210)。
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
  exec npx expo run:ios --device "$@"
fi
