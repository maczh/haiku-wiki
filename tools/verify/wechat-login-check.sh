#!/usr/bin/env bash
# 微信扫码登录回归（dev 模式，无需真实微信凭据）：单源生产形态 + curl 端到端。
# 覆盖：生成会话 → 模拟扫码 → 轮询状态 → (无绑定)注册新用户 / (有账号)绑定已有账号 /
# (已绑定)直接登录 / (非法 ticket)拒绝。
set -uo pipefail

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro
export TMPDIR=/home/macro/.workbuddy/tmp
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
mkdir -p "$TMPDIR"

PORT=${PORT:-8185}
TS=$(date +%s)
OUT=/home/macro/.workbuddy/tmp/wx-$TS
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
DATA=$TMPDIR/wx-data-$TS
mkdir -p "$DATA" "$OUT"
cp -r "$HERE/fixtures/e2e-data/." "$DATA/" 2>/dev/null || mkdir -p "$DATA"

BASE=http://127.0.0.1:$PORT
PASS=0; FAIL=0
say()  { printf '\n\033[36m== %s ==\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
ok() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '   \033[32m✅ %s = %s\033[0m\n' "$1" "$2"; else FAIL=$((FAIL+1)); printf '   \033[31m❌ %s = %s (期望 %s)\033[0m\n' "$1" "$2" "$3"; fi; }

# 起服务（fixture 自带 e2e@example.com / secret123）
DATA_DIR="$DATA" PORT="$PORT" JWT_SECRET=e2e-secret-for-verify GIN_MODE=release \
  "$TMPDIR/haiku-wiki" >"$OUT/server.log" 2>&1 &
BPID=$!
cleanup() { kill "$BPID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

code=000
for _ in $(seq 1 60); do
  code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books" 2>/dev/null)
  [ "$code" != "000" ] && [ -n "$code" ] && break
  sleep 0.3
done
info "后端就绪：HTTP $code"

# 登录已有账号（e2e@example.com）拿 token（处理 AutoMigrate 异步竞态）
E2E_TOKEN=""
for i in $(seq 1 40); do
  E2E_TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
  if [ -n "$E2E_TOKEN" ] && [ "$E2E_TOKEN" != "null" ] && [ "${#E2E_TOKEN}" -gt 20 ]; then break; fi
  sleep 0.5
done
ok "已有账号可登录(拿到token)" "${#E2E_TOKEN}" "$([ "${#E2E_TOKEN}" -gt 20 ] && echo "${#E2E_TOKEN}" || echo 0)"

# 工具：取字段（响应统一包在 .data 下）
jfield() { echo "$1" | jq -r ".data.$2 // empty"; }

say "A) 生成扫码会话（dev 模式）"
QR=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/wechat/qrcode" -H 'Content-Type: application/json' -d '{}')
TICKET=$(jfield "$QR" ticket)
DEV=$(jfield "$QR" dev_mode)
ok "返回 ticket" "${#TICKET}" "$([ "${#TICKET}" -gt 8 ] && echo "${#TICKET}" || echo 0)"
ok "dev_mode=true（未配置微信应用）" "$DEV" "true"

say "B) 无绑定微信身份 → 注册新用户"
UNION_A="dev-union-A-$TS"
curl --noproxy '*' -s -X POST "$BASE/api/auth/wechat/dev-complete" -H 'Content-Type: application/json' \
  -d "{\"ticket\":\"$TICKET\",\"union_id\":\"$UNION_A\",\"open_id\":\"dev-open-A\",\"nickname\":\"微信小张\",\"avatar\":\"http://x/a.png\"}" >/dev/null
ST=$(curl --noproxy '*' -s "$BASE/api/auth/wechat/status?ticket=$TICKET")
ok "状态=needs_profile" "$(jfield "$ST" state)" "needs_profile"
LINK=$(jfield "$ST" link_token)
ok "返回 link_token" "${#LINK}" "$([ "${#LINK}" -gt 8 ] && echo "${#LINK}" || echo 0)"

NEW_USER="wxuser_$TS"
REG=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/wechat/bind" -H 'Content-Type: application/json' \
  -d "{\"link_token\":\"$LINK\",\"mode\":\"register\",\"username\":\"$NEW_USER\",\"email\":\"$NEW_USER@ex.com\",\"password\":\"secret123\",\"name\":\"微信小张\"}")
REG_TOKEN=$(jfield "$REG" token)
ok "注册后返回 token" "${#REG_TOKEN}" "$([ "${#REG_TOKEN}" -gt 20 ] && echo "${#REG_TOKEN}" || echo 0)"
# 用 token 取用户
ME=$(curl --noproxy '*' -s "$BASE/api/auth/me" -H "Authorization: Bearer $REG_TOKEN")
ok "新用户 username 正确" "$(jfield "$ME" username)" "$NEW_USER"
ok "新用户角色=member" "$(jfield "$ME" role)" "member"

say "C) 已有账号 → 绑定"
QR2=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/wechat/qrcode" -H 'Content-Type: application/json' -d '{}')
T2=$(jfield "$QR2" ticket)
curl --noproxy '*' -s -X POST "$BASE/api/auth/wechat/dev-complete" -H 'Content-Type: application/json' \
  -d "{\"ticket\":\"$T2\",\"union_id\":\"dev-union-B-$TS\",\"open_id\":\"dev-open-B\",\"nickname\":\"微信老李\"}" >/dev/null
ST2=$(curl --noproxy '*' -s "$BASE/api/auth/wechat/status?ticket=$T2")
LINK2=$(jfield "$ST2" link_token)
BIND=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/wechat/bind" -H 'Content-Type: application/json' \
  -d "{\"link_token\":\"$LINK2\",\"mode\":\"bind\",\"account\":\"e2e@example.com\",\"password\":\"secret123\"}")
BIND_TOKEN=$(jfield "$BIND" token)
ok "绑定后返回 token" "${#BIND_TOKEN}" "$([ "${#BIND_TOKEN}" -gt 20 ] && echo "${#BIND_TOKEN}" || echo 0)"
ME2=$(curl --noproxy '*' -s "$BASE/api/auth/me" -H "Authorization: Bearer $BIND_TOKEN")
ok "绑定到已有账号 e2e@example.com" "$(jfield "$ME2" email)" "e2e@example.com"

say "D) 已绑定微信身份 → 直接登录（authorized）"
QR3=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/wechat/qrcode" -H 'Content-Type: application/json' -d '{}')
T3=$(jfield "$QR3" ticket)
curl --noproxy '*' -s -X POST "$BASE/api/auth/wechat/dev-complete" -H 'Content-Type: application/json' \
  -d "{\"ticket\":\"$T3\",\"union_id\":\"$UNION_A\",\"open_id\":\"dev-open-A\",\"nickname\":\"微信小张\"}" >/dev/null
ST3=$(curl --noproxy '*' -s "$BASE/api/auth/wechat/status?ticket=$T3")
ok "已绑定 → 状态=authorized" "$(jfield "$ST3" state)" "authorized"
ST3_TOKEN=$(jfield "$ST3" token)
ok "直接返回 token" "${#ST3_TOKEN}" "$([ "${#ST3_TOKEN}" -gt 20 ] && echo "${#ST3_TOKEN}" || echo 0)"

say "E) 非法 ticket → 拒绝"
BAD=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/wechat/dev-complete" \
  -H 'Content-Type: application/json' -d '{"ticket":"nonexistent","union_id":"x","open_id":"y"}')
ok "非法 ticket 被拒(非2xx)" "$([ "$BAD" -ge 400 ] && echo "$BAD" || echo 000)" "$([ "$BAD" -ge 400 ] && echo "$BAD" || echo 400)"

echo
echo "================ 汇总 ================"
printf '✅ 通过 %s 项 / ❌ 失败 %s 项\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
