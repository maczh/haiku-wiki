#!/usr/bin/env bash
# 本地快速测试：Go API + Vite 热更新；从任意工作目录调用均可。
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
usage() {
  cat <<'HELP'
用法：./dev.sh [--check | --help]

默认启动 Go API 和 Vite，Ctrl+C 同时停止。修改前端自动热更新；修改 Go 后重跑。
首次运行会安装缺失的 npm 依赖并准备前端静态资源，需要网络。

可选环境变量：
  DEV_API_PORT=8080         后端端口
  DEV_WEB_PORT=5173         前端端口
  DEV_HOST=127.0.0.1        前端监听地址（手机测试可设为 0.0.0.0）
  DEV_DATA_DIR=...          测试数据目录（默认 <仓库>/.local-dev/data）
  GO_BIN=...               指定 Go 可执行文件
  NODE_BIN=...             指定 Node 可执行文件（Node 22+）

--check  仅检查工具链和端口，不安装依赖、不启动服务
--help   显示此帮助

不读取项目根目录的 Docker .env；后端使用独立配置、SQLite 和本地文件存储。
日志：<仓库>/.local-dev/logs/{backend,frontend}.log
HELP
}
case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --check|'') ;;
  *) usage >&2; exit 2 ;;
esac
if (( $# > 1 )); then usage >&2; exit 2; fi

fail() { printf '\n错误：%s\n' "$*" >&2; exit 1; }

# 优先使用明确指定/当前 PATH 中的工具；兼容常见 Go 和 nvm 安装位置。
GO_BIN=${GO_BIN:-$(command -v go || true)}
if [[ -z "$GO_BIN" && -x /usr/local/go/bin/go ]]; then GO_BIN=/usr/local/go/bin/go; fi
[[ -n "$GO_BIN" && -x "$GO_BIN" ]] || fail '未找到 Go，请安装 Go 1.25+ 或设置 GO_BIN。'
NODE_EXPLICIT=${NODE_BIN:+1}
NODE_BIN=${NODE_BIN:-$(command -v node || true)}
if [[ -z "$NODE_BIN" ]] || ! "$NODE_BIN" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  [[ -z "$NODE_EXPLICIT" ]] || fail "NODE_BIN 必须指向可运行的 Node 22+：$NODE_BIN"
  # nvm 在非交互 shell 中通常不自动加入 PATH。
  for candidate in "${NVM_DIR:-${HOME:-}/.nvm}"/versions/node/v*/bin/node "${HOME:-}/.config/nvm"/versions/node/v*/bin/node; do
    if [[ -x "$candidate" ]] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
      NODE_BIN=$candidate
    fi
  done
fi
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || fail '未找到 Node，请安装 Node 22+ 或设置 NODE_BIN。'
"$NODE_BIN" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail '需要 Node 22+。'
export PATH="$(dirname "$NODE_BIN"):$(dirname "$GO_BIN"):$PATH"
command -v npm >/dev/null || fail '未找到 npm，请安装包含 npm 的 Node 发行版。'
command -v curl >/dev/null || fail '未找到 curl。'
GO_VERSION=$(GOTOOLCHAIN=local "$GO_BIN" env GOVERSION)
if [[ ! "$GO_VERSION" =~ ^go([0-9]+)\.([0-9]+) ]] || (( BASH_REMATCH[1] < 1 || (BASH_REMATCH[1] == 1 && BASH_REMATCH[2] < 25) )); then
  fail "需要 Go 1.25+，当前为 $GO_VERSION。"
fi

DEV_API_PORT=${DEV_API_PORT:-8080}
DEV_WEB_PORT=${DEV_WEB_PORT:-5173}
DEV_HOST=${DEV_HOST:-127.0.0.1}
for port in "$DEV_API_PORT" "$DEV_WEB_PORT"; do
  [[ "$port" =~ ^[0-9]{1,5}$ ]] || fail "端口无效：$port"
  (( 10#$port >= 1 && 10#$port <= 65535 )) || fail "端口须在 1–65535 之间：$port"
done
(( 10#$DEV_API_PORT != 10#$DEV_WEB_PORT )) || fail '前端和后端不能使用同一端口。'
# Go 监听所有接口，因此检查通配地址；Vite 使用 strictPort，不会偷偷换端口。
"$NODE_BIN" --input-type=module - "$DEV_API_PORT" "$DEV_WEB_PORT" "$DEV_HOST" <<'JS'
import net from 'node:net'
const [api, web, host] = process.argv.slice(2)
for (const [port, address] of [[api, '0.0.0.0'], [web, host]]) {
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', error => reject(new Error(`无法监听 ${address}:${port}：${error.code}。请停止占用进程或设置 DEV_API_PORT / DEV_WEB_PORT。`)))
    server.listen(Number(port), address, () => server.close(resolve))
  }).catch(error => { console.error(error.message); process.exit(1) })
}
JS
printf '工具链检查通过：%s / Node %s\n' "$GO_VERSION" "$("$NODE_BIN" --version)"
if [[ "${1:-}" == --check ]]; then printf '端口检查通过：API %s / Web %s\n' "$DEV_API_PORT" "$DEV_WEB_PORT"; exit 0; fi

RUN_DIR="$REPO_DIR/.local-dev"
LOG_DIR="$RUN_DIR/logs"
mkdir -p "$LOG_DIR" "$RUN_DIR/conf"
LOCK_DIR="$RUN_DIR/run.lock"
mkdir "$LOCK_DIR" 2>/dev/null || fail "已有启动任务或残留锁：$LOCK_DIR。确认之前的 dev.sh 已停止后可删除此空目录。"
API_PID=''
WEB_PID=''
cleanup() {
  local pid
  trap '' INT TERM
  for pid in "$WEB_PID" "$API_PID"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  done
  for pid in "$WEB_PID" "$API_PID"; do
    if [[ -n "$pid" ]]; then wait "$pid" 2>/dev/null || true; fi
  done
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$REPO_DIR/web"
if [[ ! -d node_modules || ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
  printf '\n安装前端依赖…\n'
  npm ci --no-audit --no-fund
fi
printf '\n准备前端静态资源…\n'
npm run predev
printf '\n编译本地后端（使用 Go 缓存，跳过前端资源嵌入）…\n'
(cd "$REPO_DIR/server" && "$GO_BIN" build -tags localdev -o "$RUN_DIR/haiku-wiki" ./cmd/server)

# 显式覆盖数据库配置，确保不会意外沿用生产 MySQL 或 Docker 的路径。
DATA_DIR=${DEV_DATA_DIR:-$RUN_DIR/data}
mkdir -p "$DATA_DIR"
DATA_DIR=$(cd "$DATA_DIR" && pwd)
export DATA_DIR DB_DRIVER=sqlite DB_DSN="$DATA_DIR/haiku.db" STORAGE_TYPE=local
export CONF_DIR="$RUN_DIR/conf" PORT="$DEV_API_PORT" GIN_MODE=debug
export JWT_SECRET=${DEV_JWT_SECRET:-haiku-local-development-only}
export HAIKU_DEV_API_TARGET="http://127.0.0.1:$DEV_API_PORT"
export NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=4096}

(cd "$REPO_DIR" && exec "$RUN_DIR/haiku-wiki") >"$LOG_DIR/backend.log" 2>&1 &
API_PID=$!
wait_ready() {
  local pid=$1 url=$2 log=$3 attempt
  for ((attempt=0; attempt<120; attempt++)); do
    if ! kill -0 "$pid" 2>/dev/null; then tail -n 40 "$log" >&2; fail "服务启动失败，日志：$log"; fi
    if curl --silent --max-time 1 --output /dev/null "$url"; then return; fi
    sleep 1
  done
  tail -n 40 "$log" >&2
  fail "启动超时，日志：$log"
}
wait_ready "$API_PID" "http://127.0.0.1:$DEV_API_PORT/api/auth/me" "$LOG_DIR/backend.log"
# predev 已执行，直接运行 Vite，以便精确管理进程并在退出时清理。
(cd "$REPO_DIR/web" && exec "$NODE_BIN" node_modules/vite/bin/vite.js --host "$DEV_HOST" --port "$DEV_WEB_PORT" --strictPort) >"$LOG_DIR/frontend.log" 2>&1 &
WEB_PID=$!
WEB_PROBE_HOST=$DEV_HOST
if [[ "$DEV_HOST" == '0.0.0.0' ]]; then WEB_PROBE_HOST=127.0.0.1; fi
wait_ready "$WEB_PID" "http://$WEB_PROBE_HOST:$DEV_WEB_PORT/" "$LOG_DIR/frontend.log"
printf '\n启动完成\n前端：http://%s:%s\n后端：http://127.0.0.1:%s\n数据：%s\n日志：%s\n首次登录：admin / Jihai2026\n前端修改自动热更新；Go 修改后 Ctrl+C 并重跑 ./dev.sh。\nCtrl+C 同时停止前后端。\n\n' "$DEV_HOST" "$DEV_WEB_PORT" "$DEV_API_PORT" "$DATA_DIR" "$LOG_DIR"
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do sleep 1; done
tail -n 20 "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log" >&2
fail '前端或后端意外退出，另一服务已停止。'
