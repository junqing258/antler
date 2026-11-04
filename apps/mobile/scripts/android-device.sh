#!/usr/bin/env bash
# Android 真机开发预览：开启 USB 调试，连接电脑并授权，手机与电脑处于同一局域网。
# 需安装 Android SDK、JDK，并配置好 Android 开发环境。
# 用法：
#   pnpm --filter @antler/mobile android:device
#   pnpm --filter @antler/mobile android:device metro
#   pnpm --filter @antler/mobile android:device --device <设备名或标识>
# 后端另行运行：pnpm dev:server。
set -euo pipefail

if [ -z "${EXPO_PUBLIC_ANTLER_SERVER_URL:-}" ]; then
  LAN_IP=""
  if command -v ipconfig >/dev/null 2>&1; then
    LAN_IP="$(ipconfig getifaddr en0 || true)"
    if [ -z "${LAN_IP}" ]; then
      LAN_IP="$(ipconfig getifaddr en1 || true)"
    fi
  fi
  if [ -z "${LAN_IP}" ]; then
    echo "错误：无法获取局域网 IP，请通过 EXPO_PUBLIC_ANTLER_SERVER_URL 指定手机可访问的后端地址。" >&2
    exit 1
  fi
  export EXPO_PUBLIC_ANTLER_SERVER_URL="http://${LAN_IP}:${ANTLER_PORT:-3210}"
fi

export ANTLER_MOBILE_ENV=development
echo "后端地址: ${EXPO_PUBLIC_ANTLER_SERVER_URL}"

if [ "${1:-run}" = "metro" ]; then
  shift
  exec npx expo start "$@"
else
  device_args=(--device)
  for arg in "$@"; do
    case "$arg" in
      --device|--device=*|-d|-d=*) device_args=(); break ;;
    esac
  done
  exec npx expo run:android ${device_args[@]+"${device_args[@]}"} "$@"
fi
