#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_ENVIRONMENT="${1:-deploy}"
DEFAULT_TARGET="root@47.100.210.56"
DEFAULT_REMOTE_DIR="/opt/antler"
DEPLOY_SSH_TARGET="${DEPLOY_SSH_TARGET:-}"
DEPLOY_REMOTE_DIR="${DEPLOY_REMOTE_DIR:-}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/.env}"
DEPLOY_ENV_OVERRIDE_FILE="${DEPLOY_ENV_OVERRIDE_FILE:-$ROOT_DIR/.env.${DEPLOY_ENVIRONMENT}}"
DEPLOY_COMPOSE_FILE="${DEPLOY_COMPOSE_FILE:-$ROOT_DIR/scripts/docker-compose.remote.yml}"
DEPLOY_IMAGE_TAG="${DEPLOY_IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
DEPLOY_BACKEND_IMAGE_REPO="${DEPLOY_BACKEND_IMAGE_REPO:-antler/backend}"
DEPLOY_BACKEND_IMAGE_REF="${DEPLOY_BACKEND_IMAGE_REPO}:${DEPLOY_IMAGE_TAG}"
DEPLOY_PLATFORM="${DEPLOY_PLATFORM:-}"
DEPLOY_DEBUG="${DEPLOY_DEBUG:-0}"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<EOF
用法：scripts/deploy-apps-ssh.sh [环境]

在本地构建包含 Antler Web 静态资源的 backend Docker 镜像，经 SSH 传输到远端主机，
上传 Compose 与合并后的环境配置，然后重建容器并等待健康检查通过。

环境默认为 deploy：脚本合并 .env 和可选的 .env.deploy，后者覆盖同名变量。
传入 test 时则要求 .env.test 存在。

首次使用前可执行：ssh-copy-id ${DEFAULT_TARGET}

可覆盖环境变量：
  DEPLOY_SSH_TARGET         SSH 目标；默认读取 DEFAULT_TARGET，兜底 ${DEFAULT_TARGET}
  DEPLOY_REMOTE_DIR         远端目录；默认读取 DEPLOY_REMOTE_DIR，兜底 ${DEFAULT_REMOTE_DIR}
  DEPLOY_ENV_FILE           基础环境文件；默认 .env
  DEPLOY_ENV_OVERRIDE_FILE  环境覆盖文件；默认 .env.<环境>
  DEPLOY_COMPOSE_FILE       Compose 模板；默认 scripts/docker-compose.remote.yml
  DEPLOY_IMAGE_TAG          镜像标签；默认当前 Git 短 SHA
  DEPLOY_BACKEND_IMAGE_REPO backend 镜像名；默认 antler/backend
  DEPLOY_PLATFORM           目标平台；为空时从远端 uname 自动识别
  DEPLOY_DEBUG              设为 1 输出调试命令

示例：
  cp .env.deploy.example .env.deploy
  scripts/deploy-apps-ssh.sh
  DEPLOY_SSH_TARGET=root@example.com scripts/deploy-apps-ssh.sh production
EOF
  exit 0
fi

if [[ "$DEPLOY_DEBUG" == "1" ]]; then
  set -x
fi

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "缺少必需命令：$cmd" >&2
    exit 1
  fi
}

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "缺少必需文件：$path" >&2
    exit 1
  fi
}

log_step() {
  printf '%s\n' "==> $1"
}

quote_for_remote_sh() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

remote_sh() {
  local cmd="$1"
  ssh "$DEPLOY_SSH_TARGET" "sh -lc $(quote_for_remote_sh "$cmd")"
}

read_env_file_value() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    return 1
  fi

  local line
  local value
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi

  value="${line#*=}"
  value="${value%$'\r'}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

read_deploy_env_value() {
  local key="$1"
  if [[ -f "$DEPLOY_ENV_OVERRIDE_FILE" ]]; then
    read_env_file_value "$DEPLOY_ENV_OVERRIDE_FILE" "$key" && return 0
  fi
  read_env_file_value "$DEPLOY_ENV_FILE" "$key"
}

merge_env_files() {
  awk '
    /^[A-Za-z_][A-Za-z0-9_]*=/ {
      key = $0
      sub(/=.*/, "", key)
      if (seen[key]) lines[seen[key]] = ""
      seen[key] = NR
    }
    { lines[NR] = $0 }
    END { for (i = 1; i <= NR; i++) if (lines[i] != "") print lines[i] }
  ' "$@"
}

detect_platform() {
  case "$1" in
    x86_64|amd64) echo "linux/amd64" ;;
    aarch64|arm64) echo "linux/arm64" ;;
    *) echo "" ;;
  esac
}

require_command docker
require_command ssh
require_command scp
require_command gzip
require_file "$DEPLOY_ENV_FILE"
require_file "$DEPLOY_COMPOSE_FILE"
if [[ "$DEPLOY_ENVIRONMENT" != "deploy" ]]; then
  require_file "$DEPLOY_ENV_OVERRIDE_FILE"
fi
if ! docker buildx version >/dev/null 2>&1; then
  echo "构建目标平台镜像需要 docker buildx" >&2
  exit 1
fi

if [[ -z "$DEPLOY_SSH_TARGET" ]]; then
  DEPLOY_SSH_TARGET="$(read_deploy_env_value DEFAULT_TARGET || printf '%s' "$DEFAULT_TARGET")"
fi
if [[ -z "$DEPLOY_REMOTE_DIR" ]]; then
  DEPLOY_REMOTE_DIR="$(read_deploy_env_value DEPLOY_REMOTE_DIR || printf '%s' "$DEFAULT_REMOTE_DIR")"
fi

tmp_env_file="$(mktemp)"
cleanup() {
  rm -f "$tmp_env_file"
}
trap cleanup EXIT

env_sources=("$DEPLOY_ENV_FILE")
if [[ -f "$DEPLOY_ENV_OVERRIDE_FILE" ]]; then
  env_sources+=("$DEPLOY_ENV_OVERRIDE_FILE")
fi
merge_env_files "${env_sources[@]}" \
  | grep -Ev '^ANTLER_BACKEND_IMAGE=' > "$tmp_env_file" || true
printf '\nANTLER_BACKEND_IMAGE=%s\n' "$DEPLOY_BACKEND_IMAGE_REF" >> "$tmp_env_file"

log_step "检查远端 Docker Compose：$DEPLOY_SSH_TARGET"
remote_sh "docker compose version >/dev/null && docker image load --help >/dev/null"

if [[ -z "$DEPLOY_PLATFORM" ]]; then
  remote_arch="$(remote_sh "uname -m")"
  DEPLOY_PLATFORM="$(detect_platform "$remote_arch")"
  if [[ -z "$DEPLOY_PLATFORM" ]]; then
    echo "不支持的远端架构：$remote_arch；请手动设置 DEPLOY_PLATFORM" >&2
    exit 1
  fi
  log_step "远端架构：$remote_arch -> $DEPLOY_PLATFORM"
else
  log_step "目标平台：$DEPLOY_PLATFORM"
fi

log_step "构建 backend 镜像：$DEPLOY_BACKEND_IMAGE_REF"
docker buildx build --load --platform "$DEPLOY_PLATFORM" \
  --file "$ROOT_DIR/backend/Dockerfile" \
  --tag "$DEPLOY_BACKEND_IMAGE_REF" "$ROOT_DIR"

log_step "创建远端目录并上传部署文件"
remote_sh "mkdir -p $(quote_for_remote_sh "$DEPLOY_REMOTE_DIR")/workspace"
scp "$DEPLOY_COMPOSE_FILE" "$DEPLOY_SSH_TARGET:$DEPLOY_REMOTE_DIR/docker-compose.remote.yml"
scp "$tmp_env_file" "$DEPLOY_SSH_TARGET:$DEPLOY_REMOTE_DIR/.env"

log_step "传输镜像"
docker save "$DEPLOY_BACKEND_IMAGE_REF" | gzip | remote_sh "gunzip | docker load"

log_step "启动服务、移除旧 Web 容器并等待健康检查"
remote_sh "cd $(quote_for_remote_sh "$DEPLOY_REMOTE_DIR") && docker compose -f docker-compose.remote.yml --env-file .env up -d --force-recreate --remove-orphans --wait --wait-timeout 180"

log_step "远端服务状态"
remote_sh "cd $(quote_for_remote_sh "$DEPLOY_REMOTE_DIR") && docker compose -f docker-compose.remote.yml --env-file .env ps"

remote_host="${DEPLOY_SSH_TARGET##*@}"
web_port="$(read_deploy_env_value ANTLER_WEB_PORT || printf '3210')"
printf '%s\n' "部署完成：backend=${DEPLOY_BACKEND_IMAGE_REF}（包含 Web）"
printf '%s\n' "访问地址：http://${remote_host}:${web_port}/"
