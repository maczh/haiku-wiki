#!/usr/bin/env bash
# 国内网络 / 代理环境下构建 haiku-wiki 镜像的封装入口。
#
# 背景：本项目 Dockerfile 第一行是 `# syntax=docker/dockerfile:1`，
# 这个「BuildKit Dockerfile 前端镜像」由 buildkitd 自己联网去 Docker Hub 拉，
# 不走 `docker pull` 那条链路。国内直连 registry-1.docker.io 超时时会报：
#
#   failed to solve: failed to resolve source metadata for docker.io/docker/dockerfile:1
#
# 三条解法的分工（别配错位置，配错位置完全不生效）：
#
#   1) 本机构建 —— 先在宿主机 npm ci + npm run build，再把前端嵌入宿主机构建的 Go
#      二进制，最后仅把二进制 COPY 进运行镜像；Docker build 不再编译前后端。
#   2) 代理 —— 必须写进 `~/.docker/config.json` 的 `proxies` 字段。
#      /etc/docker/daemon.json 的 proxies 只管 `dockerd` 自己 pull，
#      对 buildkit 前端拉取无效。本脚本 `--write-proxy-config` 可直接写入。
#   3) 国内镜像源 —— daemon.json 的 `registry-mirrors`（`docker pull` 加速，
#      对基础镜像 alpine / golang 有效；前端依赖由宿主机的 --npm-mirror 负责）。
#   4) 绕开前端 —— `--classic` 让 compose 退回 classic builder，压根不需要拉 syntax 前端。
#
# 用法：
#   ./docker-build-cn.sh --proxy http://127.0.0.1:7890 --write-proxy-config
#   ./docker-build-cn.sh --apk-mirror https://mirrors.tuna.tsinghua.edu.cn/alpine
#   ./docker-build-cn.sh --classic            # 兜底：不用 buildkit
#   ./docker-build-cn.sh --skip-build --classic # 复用已有本机构建产物，只重建镜像
#   ./docker-build-cn.sh --dry-run            # 只打印将要执行的命令

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# 本机 shell 有时没有 HOME（见项目约定），写 ~/.docker 前兜底一下
HOME="${HOME:-/root}"

PROXY=""
APK_MIRROR=""
NPM_MIRROR=""
CLASSIC=0
SKIP_BUILD=0
WRITE_PROXY=0
DRY=0
EXTRA=()

usage() {
  cat <<'EOF'
用法: ./docker-build-cn.sh [选项]

构建参数：
  --apk-mirror <URL>    Alpine 软件源镜像，如 https://mirrors.tuna.tsinghua.edu.cn/alpine
  --npm-mirror <URL>    宿主机构建前端时使用的 npm registry，如 https://registry.npmmirror.com

网络选项：
  --proxy <URL>         HTTP 代理，如 http://127.0.0.1:7890（buildkit 前端拉取走它）
  --write-proxy-config  顺手把代理写进 ~/.docker/config.json 的 proxies（会先备份原文件）
                        仅 --proxy 非空时生效；这是唯一能让 buildkit 前端走代理的方式
  --classic             用 classic builder（DOCKER_BUILDKIT=0）绕开 syntax 前端拉取，最稳的兜底
  --skip-build          跳过宿主机前端与后端编译，复用已有 build/haiku-wiki 直接构建 Docker 镜像

其他：
  --dry-run             只打印将要执行的命令，不真跑
  -h, --help            显示本帮助

提示：同时用 --proxy 和 --apk-mirror 通常最快；若只想先验证镜像能编出来，
      直接 --classic 一条命令搞定。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --proxy)           PROXY="${2:-}";           shift 2 ;;
    --apk-mirror)      APK_MIRROR="${2:-}";      shift 2 ;;
    --npm-mirror)      NPM_MIRROR="${2:-}";      shift 2 ;;
    --classic)         CLASSIC=1;      shift ;;
    --skip-build)      SKIP_BUILD=1;   shift ;;
    --write-proxy-config) WRITE_PROXY=1; shift ;;
    --dry-run)         DRY=1;          shift ;;
    -h|--help)         usage; exit 0 ;;
    --)                shift; EXTRA+=("$@"); break ;;
    *)                 EXTRA+=("$1"); shift ;;
  esac
done

log()  { printf '\033[36m[build-cn]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[build-cn][warn]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[31m[build-cn][err]\033[0m %s\n' "$*" >&2; }

# 纯 TCP 连通探测：能握手就认为代理可用（不依赖 curl，容器/裸机都能跑）
probe_proxy_with() {
  local p="$1"
  local rest="${p#*://}"
  local host="${rest%%:*}"
  local port="${rest##*:}"
  [[ "$host" == "$rest" ]] && port=80
  (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null
}

# ---------- 代理探测 ----------
if [[ -n "$PROXY" ]]; then
  if probe_proxy_with "$PROXY"; then
    log "代理可用：$PROXY"
  else
    warn "代理 $PROXY 连不上，buildkit 前端拉取仍可能超时（继续构建，失败可加 --classic）"
  fi
elif [[ "$CLASSIC" == "0" ]]; then
  # 没显式传 --proxy 时，帮用户探一下最常见的 7890 出口
  if probe_proxy_with "http://127.0.0.1:7890"; then
    log "检测到本机 http://127.0.0.1:7890 可用；建议加 --proxy http://127.0.0.1:7890 --write-proxy-config"
  fi
fi

# ---------- 写 ~/.docker/config.json 的 proxies ----------
# 必须保留原有的 auths（登录凭据）等字段，所以走 python3 合并而不是整文件覆盖。
write_proxy_config() {
  [[ "$WRITE_PROXY" == "1" && -n "$PROXY" ]] || return 0
  local cfg="$HOME/.docker/config.json"
  local backup="${cfg}.bak.$(date +%Y%m%d%H%M%S)"
  mkdir -p "$HOME/.docker" 2>/dev/null || { warn "无法创建 $HOME/.docker，跳过写入代理配置"; return 0; }

  if [[ -f "$cfg" ]]; then
    cp "$cfg" "$backup"
    log "已备份原配置：$backup"
  fi

  if command -v python3 >/dev/null 2>&1; then
    local proxy="$PROXY"
    local rest="${proxy#*://}"
    NO_PROXY="${NO_PROXY:-127.0.0.1,localhost}"
    python3 - "$cfg" "$proxy" "$NO_PROXY" <<'PY'
import json, sys
path, proxy, no_proxy = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = {}
try:
    with open(path, encoding="utf-8") as f:
        raw = f.read().strip()
    if raw:
        cfg = json.loads(raw)
except Exception:
    cfg = {}
if not isinstance(cfg.get("proxies"), dict):
    cfg["proxies"] = {}
cfg["proxies"].update({
    "http-proxy": proxy,
    "https-proxy": proxy,
    "no-proxy": no_proxy,
})
with open(path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
    log "已写入 $cfg 的 proxies 字段（buildkit 前端拉取将走代理）"
  else
    warn "未找到 python3，无法安全合并配置；请手动写入 $cfg："
    cat <<'EOF'
{
  "proxies": {
    "http-proxy": "PROXY_HERE",
    "https-proxy": "PROXY_HERE",
    "no-proxy": "127.0.0.1,localhost"
  }
}
EOF
    return 0
  fi
}

# ---------- 组装 build args ----------
ARGS=()
[[ -n "$APK_MIRROR" ]] && ARGS+=(--build-arg "APK_MIRROR=$APK_MIRROR")

if [[ "$DRY" == "1" ]]; then
  quote() { local out="" a; for a in "$@"; do out="$out $(printf '%q' "$a")"; done; printf '%s' "$out"; }
  log "[dry-run] 将执行："
  printf '  %s docker compose build%s%s\n' \
    "$([[ "$CLASSIC" == "1" ]] && echo "DOCKER_BUILDKIT=0")" \
    "$(quote ${ARGS[@]+"${ARGS[@]}"})" \
    "$(quote ${EXTRA[@]+"${EXTRA[@]}"})"
  exit 0
fi

# ---------- 宿主机构建前端与后端 ----------
# Dockerfile 只接收 build/haiku-wiki，不再在容器内安装 npm/Go 依赖或编译。
if [[ "$SKIP_BUILD" == "1" ]]; then
  log "跳过宿主机构建，复用已有 build/haiku-wiki"
  [[ -x "$REPO_ROOT/build/haiku-wiki" ]] || {
    err "--skip-build 要求已有可执行文件 $REPO_ROOT/build/haiku-wiki，请先去掉 --skip-build 完成本机构建"
    exit 1
  }
else
  command -v node >/dev/null 2>&1 || { err "找不到 node 命令，请先在宿主机安装 Node.js 22+"; exit 1; }
  command -v npm >/dev/null 2>&1 || { err "找不到 npm 命令，请先在宿主机安装 npm"; exit 1; }
  if ! command -v go >/dev/null 2>&1 && [[ -x /usr/local/go/bin/go ]]; then
    export PATH="/usr/local/go/bin:$PATH"
  fi
  command -v go >/dev/null 2>&1 || { err "找不到 go 命令，请先在宿主机安装 Go 1.25+"; exit 1; }
  [[ -f web/package-lock.json ]] || { err "缺少 web/package-lock.json，无法执行 npm ci"; exit 1; }

  log "在宿主机构建前端 web/dist"
  pushd web >/dev/null
  NPM_CI_ARGS=(ci --no-audit --no-fund)
  [[ -n "$NPM_MIRROR" ]] && NPM_CI_ARGS+=(--registry "$NPM_MIRROR")
  npm "${NPM_CI_ARGS[@]}"
  npm run build
  popd >/dev/null

  [[ -f web/dist/index.html ]] || { err "前端构建完成但未生成 web/dist/index.html"; exit 1; }

  log "在宿主机构建后端并嵌入 web/dist"
  EMBED_DIST="server/internal/static/dist"
  mkdir -p "$EMBED_DIST"
  # 清理旧的嵌入文件，保留 Git 占位文件，避免旧前端资源进入本次二进制。
  find "$EMBED_DIST" -mindepth 1 -maxdepth 1 ! -name .gitkeep -exec rm -rf -- {} +
  cp -a web/dist/. "$EMBED_DIST/"

  BUILD_DIR="$REPO_ROOT/build"
  mkdir -p "$BUILD_DIR"
  pushd server >/dev/null
  rm -f "$BUILD_DIR/haiku-wiki"
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    GOPROXY="${GOPROXY:-https://goproxy.cn,direct}" \
    go build -trimpath -ldflags "-s -w" -o "$BUILD_DIR/haiku-wiki" ./cmd/server
  upx "$BUILD_DIR/haiku-wiki"
  popd >/dev/null
  [[ -x "$BUILD_DIR/haiku-wiki" ]] || { err "后端编译完成但未生成 $BUILD_DIR/haiku-wiki"; exit 1; }
fi

write_proxy_config

# 真要跑构建才检查 docker 可用（--help / --dry-run 允许在没有 docker 的机器上用）
command -v docker >/dev/null 2>&1 || { err "找不到 docker 命令"; exit 1; }
docker compose version >/dev/null 2>&1 || { err "docker compose 插件不可用（需要 docker compose v2）"; exit 1; }

if [[ "$CLASSIC" == "1" ]]; then
  log "使用 classic builder（DOCKER_BUILDKIT=0），不再拉取 syntax 前端镜像"
  export DOCKER_BUILDKIT=0
else
  log "使用 buildkit(默认)；如仍报 dockerfile:1 拉不动，改跑：./docker-build-cn.sh --classic"
fi

# 空数组兼容写法（bash 4.3 及以下在 set -u 下 "${arr[@]}" 会炸）
docker compose build ${ARGS[@]+"${ARGS[@]}"} ${EXTRA[@]+"${EXTRA[@]}"}
