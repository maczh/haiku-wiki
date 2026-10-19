#!/usr/bin/env bash
# 「我的网盘」用户间隔离回归（单源生产形态，不触网）：
#   双用户（A=fixture 账号 / B=新注册）→ 同名连接隔离 → 横向越权全灭 →
#   任务越权 → 预览 token 绑连接 → 未登录 401 → 清理。
# 连接 host 一律 127.0.0.1:1（必然拒连）：任何「越权放行」都会以 42002 暴露，
# 而不是被伪装成不存在。
set -uo pipefail

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro
export TMPDIR=/home/macro/.workbuddy/tmp
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
mkdir -p "$TMPDIR"

PORT=${PORT:-8196}
TS=$(date +%s)
OUT=/home/macro/.workbuddy/tmp/ndiso-$TS
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
DATA=$TMPDIR/ndiso-data-$TS
mkdir -p "$DATA" "$OUT"
cp -r "$HERE/fixtures/e2e-data/." "$DATA/" 2>/dev/null || mkdir -p "$DATA"

BIN=$TMPDIR/haiku-wiki
if [ ! -x "$BIN" ]; then
  echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh（run-all.sh 由 embed-prod-check 预构建）"
  exit 2
fi

BASE=http://127.0.0.1:$PORT
PASS=0; FAIL=0
say()  { printf '\n\033[36m== %s ==\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
ok() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '   \033[32m✅ %s = %s\033[0m\n' "$1" "$2"; else FAIL=$((FAIL+1)); printf '   \033[31m❌ %s = %s (期望 %s)\033[0m\n' "$1" "$2" "$3"; fi; }

# 起服务（fixture 自带 e2e@example.com / secret123）
DATA_DIR="$DATA" PORT="$PORT" JWT_SECRET=e2e-secret-for-verify GIN_MODE=release \
  "$BIN" >"$OUT/server.log" 2>&1 &
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

# ---------- 工具 ----------

jfield() { echo "$1" | jq -r ".data.$2 // empty"; }   # 响应统一包在 .data 下
jcode() { echo "$1" | jq -r '.code // empty'; }
jmsg()  { echo "$1" | jq -r '.message // empty'; }
split_resp() { # $1=curl -w '\n%{http_code}' 的输出；回填 CODE / BODY 两个全局变量
  CODE=${1##*$'\n'}
  BODY=${1%$'\n'}
}

# login_token <account> <password>：轮询重试，规避 AutoMigrate 异步竞态
login_token() {
  local out="" i
  for i in $(seq 1 40); do
    out=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" \
      -H 'Content-Type: application/json' \
      -d "{\"account\":\"$1\",\"password\":\"$2\"}" | jq -r '.data.token // empty')
    if [ -n "$out" ] && [ "${#out}" -gt 20 ]; then echo "$out"; return 0; fi
    sleep 0.5
  done
  echo ""
}

# notfound <名称> <HTTP码> <响应体>：必须 4xx 且是「不存在」语义
# （业务码 40401，或文案含「不存在」——TaskBlob 用 42011+「任务不存在」），
# 绝不允许 403（能探测存在性）或 500（内部错误）。
notfound() {
  local name=$1 code=$2 body=$3 bc bm
  bc=$(jcode "$body"); bm=$(jmsg "$body")
  if [ "$code" -ge 400 ] 2>/dev/null && [ "$code" -lt 500 ] 2>/dev/null \
     && { [ "$bc" = "40401" ] || [[ "$bm" == *不存在* ]]; }; then
    PASS=$((PASS+1)); printf '   \033[32m✅ %s = HTTP %s code=%s（不存在语义）\033[0m\n' "$name" "$code" "${bc:-无body}"
  else
    FAIL=$((FAIL+1)); printf '   \033[31m❌ %s = HTTP %s code=%s msg=%s body=%s\033[0m\n' "$name" "$code" "${bc:-无}" "${bm:-无}" "$body"
  fi
}

# probe <名称> <token> <方法> <路径> [额外 curl 参数...]：带指定 token 打接口并断「不存在」语义
probe() {
  local name=$1 token=$2 method=$3 path=$4; shift 4
  local out
  out=$(curl --noproxy '*' -s -w '\n%{http_code}' -X "$method" "$BASE$path" \
    -H "Authorization: Bearer $token" "$@")
  split_resp "$out"
  notfound "$name" "$CODE" "$BODY"
}

# ---------- A) 双用户登录态 ----------

say "A) 双用户登录态（A=fixture 账号，B=新注册；规避注册限频：只注册一次）"
TOKEN_A=$(login_token "e2e@example.com" "secret123")
ok "A(fixture) 登录拿到 token" "${#TOKEN_A}" "$([ "${#TOKEN_A}" -gt 20 ] && echo "${#TOKEN_A}" || echo 0)"

USER_B="ndiso-b-$TS"
TOKEN_B=""
for _ in $(seq 1 5); do
  REG=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER_B\",\"name\":\"B\",\"email\":\"$USER_B@ex.com\",\"phone\":\"\",\"department\":\"\",\"password\":\"secret123\"}")
  TOKEN_B=$(jfield "$REG" token)
  [ -n "$TOKEN_B" ] && [ "${#TOKEN_B}" -gt 20 ] && break
  sleep 1
done
ok "B 注册拿到 token" "${#TOKEN_B}" "$([ "${#TOKEN_B}" -gt 20 ] && echo "${#TOKEN_B}" || echo 0)"
# 再走一遍登录（registerReq 必填字段已覆盖：username/email/password）
TOKEN_B=$(login_token "$USER_B" "secret123")
ok "B 登录拿到 token" "${#TOKEN_B}" "$([ "${#TOKEN_B}" -gt 20 ] && echo "${#TOKEN_B}" || echo 0)"

# ---------- B) 同名连接隔离 ----------

say "B) 两用户建同名 SMB 连接（唯一索引 (user_id,name) → 必须都建成）"
CONN_A=$(curl --noproxy '*' -s -X POST "$BASE/api/netdisks" \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"name":"A的NAS","kind":"smb","host":"127.0.0.1","port":1,"share":"x","username":"u","password":"p"}' | jq -r '.data.id // empty')
ok "A 建连接拿到 id" "${#CONN_A}" "$([ "${#CONN_A}" -gt 0 ] && echo "${#CONN_A}" || echo 0)"
CONN_B=$(curl --noproxy '*' -s -X POST "$BASE/api/netdisks" \
  -H "Authorization: Bearer $TOKEN_B" -H 'Content-Type: application/json' \
  -d '{"name":"A的NAS","kind":"smb","host":"127.0.0.1","port":1,"share":"x","username":"u","password":"p"}' | jq -r '.data.id // empty')
ok "B 建同名连接也成功（跨用户同名必须允许）" "${#CONN_B}" "$([ "${#CONN_B}" -gt 0 ] && echo "${#CONN_B}" || echo 0)"
ok "两连接 ID 不同（确实是两条记录）" "$([ -n "$CONN_A" ] && [ -n "$CONN_B" ] && [ "$CONN_A" != "$CONN_B" ] && echo diff || echo same)" "diff"

NA=$(curl --noproxy '*' -s "$BASE/api/netdisks" -H "Authorization: Bearer $TOKEN_A" | jq '.data | length')
ok "A 的列表只返回自己的 1 条" "$NA" "1"
NB=$(curl --noproxy '*' -s "$BASE/api/netdisks" -H "Authorization: Bearer $TOKEN_B" | jq '.data | length')
ok "B 的列表只返回自己的 1 条" "$NB" "1"
ANAME=$(curl --noproxy '*' -s "$BASE/api/netdisks" -H "Authorization: Bearer $TOKEN_A" | jq -r '.data[0].name')
ok "A 列表首条就是自己建的" "$ANAME" "A的NAS"
BNAME=$(curl --noproxy '*' -s "$BASE/api/netdisks" -H "Authorization: Bearer $TOKEN_B" | jq -r '.data[0].name')
ok "B 列表首条就是自己建的" "$BNAME" "A的NAS"

# ---------- C) 横向越权全灭 ----------

say "C) 横向越权全灭（A 的 token 打 B 的连接 id，全部必须 4xx+不存在语义）"
probe "GET /netdisks/:id"        "$TOKEN_A" GET    "/api/netdisks/$CONN_B"
probe "PUT /netdisks/:id"        "$TOKEN_A" PUT    "/api/netdisks/$CONN_B" \
  -H 'Content-Type: application/json' -d '{"name":"改个名","kind":"smb","host":"127.0.0.1","port":1,"share":"x"}'
probe "DELETE /netdisks/:id"     "$TOKEN_A" DELETE "/api/netdisks/$CONN_B"
probe "POST /:id/test"           "$TOKEN_A" POST   "/api/netdisks/$CONN_B/test" -H 'Content-Type: application/json' -d '{}'
probe "POST /:id/refresh"        "$TOKEN_A" POST   "/api/netdisks/$CONN_B/refresh" -H 'Content-Type: application/json' -d '{}'
probe "GET /:id/dirs"            "$TOKEN_A" GET    "/api/netdisks/$CONN_B/dirs?path=/"
probe "POST /:id/dirs"           "$TOKEN_A" POST   "/api/netdisks/$CONN_B/dirs" \
  -H 'Content-Type: application/json' -d '{"path":"/","name":"d"}'
probe "POST /:id/rename"         "$TOKEN_A" POST   "/api/netdisks/$CONN_B/rename" \
  -H 'Content-Type: application/json' -d '{"path":"/x","name":"y"}'
probe "POST /:id/move"           "$TOKEN_A" POST   "/api/netdisks/$CONN_B/move" \
  -H 'Content-Type: application/json' -d '{"path":"/x","target_dir":"/"}'
probe "DELETE /:id/items"        "$TOKEN_A" DELETE "/api/netdisks/$CONN_B/items?path=/x"
echo "small-ndiso-$TS" > "$OUT/small.txt"
probe "POST /:id/upload(带文件)"  "$TOKEN_A" POST   "/api/netdisks/$CONN_B/upload?path=/" -F "file=@$OUT/small.txt"
probe "POST /:id/import"         "$TOKEN_A" POST   "/api/netdisks/$CONN_B/import" \
  -H 'Content-Type: application/json' -d '{"path":"/x.txt","book_id":1,"parent_id":0}'
probe "GET /:id/preview-token"   "$TOKEN_A" GET    "/api/netdisks/$CONN_B/preview-token?path=/x.txt"

# ---------- D) 任务横向越权 ----------

say "D) 任务横向越权（A 给自己的连接建导入任务；B 的 token 打它）"
IMP=$(curl --noproxy '*' -s -X POST "$BASE/api/netdisks/$CONN_A/import" \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"path":"/x.txt","book_id":1,"parent_id":0}')
TASK_A=$(jfield "$IMP" id)
ok "A 给自己的连接建导入任务成功" "${#TASK_A}" "$([ "${#TASK_A}" -gt 0 ] && echo "${#TASK_A}" || echo 0)"
probe "GET /netdisk-tasks/:id"    "$TOKEN_B" GET    "/api/netdisk-tasks/$TASK_A"
probe "POST /:id/retry"           "$TOKEN_B" POST   "/api/netdisk-tasks/$TASK_A/retry"
probe "DELETE /netdisk-tasks/:id" "$TOKEN_B" DELETE "/api/netdisk-tasks/$TASK_A"
probe "GET /:id/blob"             "$TOKEN_B" GET    "/api/netdisk-tasks/$TASK_A/blob"

# ---------- E) 预览 token 绑连接 ----------

say "E) 预览 token 与「连接+路径+用户」绑定（不带 Authorization，纯 query token）"
PT=$(curl --noproxy '*' -s "$BASE/api/netdisks/$CONN_A/preview-token?path=/x.txt" \
  -H "Authorization: Bearer $TOKEN_A" | jq -r '.data.token // empty')
ok "A 给自己的连接拿到预览 token" "${#PT}" "$([ "${#PT}" -gt 10 ] && echo "${#PT}" || echo 0)"

# pv <名称> <连接id> <path> <token> <期望HTTP> <期望code>：不带 Authorization 头
pv() {
  local out
  out=$(curl --noproxy '*' -s -w '\n%{http_code}' "$BASE/api/netdisks/$2/preview?path=$3&token=$4")
  split_resp "$out"
  ok "$1（HTTP）" "$CODE" "$5"
  ok "$1（业务码）" "$(jcode "$BODY")" "$6"
}
pv "A 的 token 打 B 的连接"  "$CONN_B" "/x.txt" "$PT" "401" "42012"
pv "A 的 token 换一个路径"   "$CONN_A" "/y.txt" "$PT" "401" "42012"
# 正向对照：token 与自己的连接+路径完全匹配 → 通过 token 校验、走到真实建连才失败（42002）
pv "A 的 token 打自己的连接（token 有效→建连失败）" "$CONN_A" "/x.txt" "$PT" "502" "42002"

# ---------- F) 未登录 ----------

say "F) 未登录打 /api/netdisks → 401"
out=$(curl --noproxy '*' -s -w '\n%{http_code}' "$BASE/api/netdisks")
split_resp "$out"
ok "未登录列表 HTTP" "$CODE" "401"
ok "未登录列表业务码" "$(jcode "$BODY")" "40101"

# ---------- G) 收尾清理 ----------

say "G) 收尾清理（各自删自己的连接；删完列表为空）"
DA=$(curl --noproxy '*' -s -X DELETE "$BASE/api/netdisks/$CONN_A" -H "Authorization: Bearer $TOKEN_A")
ok "A 删自己的连接" "$(jfield "$DA" deleted)" "true"
DB=$(curl --noproxy '*' -s -X DELETE "$BASE/api/netdisks/$CONN_B" -H "Authorization: Bearer $TOKEN_B")
ok "B 删自己的连接" "$(jfield "$DB" deleted)" "true"
ok "A 的列表已空" "$(curl --noproxy '*' -s "$BASE/api/netdisks" -H "Authorization: Bearer $TOKEN_A" | jq '.data | length')" "0"
ok "B 的列表已空" "$(curl --noproxy '*' -s "$BASE/api/netdisks" -H "Authorization: Bearer $TOKEN_B" | jq '.data | length')" "0"

echo
echo "================ 汇总 ================"
printf '✅ 通过 %s 项 / ❌ 失败 %s 项\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
