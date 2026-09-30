#!/usr/bin/env bash
# 思维导图 H5 划屏平移验收：CDP Input.dispatchTouchEvent 派发真实触摸序列，
# 断言单指上下左右划屏都能平移画布（view tx/ty 双向变化）、页面不随划屏滚动、
# touch-action=none（手势全接管）。单源生产形态 + e2e 夹具库。默认端口 8193。
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$HERE/../.."
export HOME=/home/macro TMPDIR=/home/macro/.workbuddy/tmp
export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export XDG_RUNTIME_DIR=/home/macro/.workbuddy/tmp/xdg
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"

BIN=${MM_BIN:-/home/macro/.workbuddy/tmp/haiku-wiki}
PORT=${PORT:-8193}
BASE="http://127.0.0.1:$PORT"

DATA=$(mktemp -d /home/macro/.workbuddy/tmp/mm-h5-pan.XXXXXX)
cp -r tools/verify/fixtures/e2e-data/. "$DATA"/
cleanup() { fuser -k $PORT/tcp >/dev/null 2>&1; }
trap cleanup EXIT

PORT=$PORT DATA_DIR="$DATA" JWT_SECRET=mmh5pan nohup "$BIN" >"$DATA/server.log" 2>&1 &
TOKEN=""
for i in $(seq 1 40); do
  TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token' 2>/dev/null)
  [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && [ "${#TOKEN}" -gt 20 ] && break
  sleep 0.5
done
if [ "${#TOKEN}" -le 20 ]; then echo "mm-h5-pan: 登录失败"; tail -5 "$DATA/server.log"; exit 1; fi

timeout 120 node "$HERE/mm-h5-pan.mjs" "$BASE" "$TOKEN"
