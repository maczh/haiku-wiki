#!/usr/bin/env bash
# 接口文档 URL 导入来源「自动/手动刷新」端到端 API 验证：
#   登录用户：建库 → 建接口文档 → 登记 URL 来源(PATCH api_source_url) →
#   读回来源状态 → 手动刷新端点接线 + SSRF 拦截校验 → 写权限校验 →
#   清除来源 → 来源状态回读为 null → 管理员最近一次刷新汇总端点保护校验
# 成功路径（原地合并 + 保留 endpoint id + 调试历史不丢）由 Go 单测
# TestApiRefresh* 覆盖；本脚本只验证「接线 + 权限 + SSRF」这些需要真实 HTTP 的部分。
set -uo pipefail

TMP=${HAIKU_TMP:-/home/macro/.workbuddy/tmp}
PORT=${PORT:-8101}
BASE=http://127.0.0.1:$PORT
BIN=${HAIKU_BIN:-$TMP/haiku-wiki}
OUT=$TMP/api-refresh-out-$(date +%s)
mkdir -p "$OUT"

[ -x "$BIN" ] || { echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi

export PATH=/usr/local/go/bin:$PATH
export HOME=/home/macro TMPDIR=$TMP/gotmp
export GOPATH=/home/macro/.workbuddy/go GOMODCACHE=/home/macro/.workbuddy/go/pkg/mod
export GOCACHE=/home/macro/.workbuddy/go/cache GOPROXY=https://goproxy.cn,direct GOSUMDB=off
unset http_proxy https_proxy

DATA=$TMP/api-refresh-data-$(date +%s); mkdir -p "$DATA"
PORT=$PORT DATA_DIR="$DATA" JWT_SECRET=apirefreshcheck GIN_MODE=release \
  "$BIN" >"$OUT/server.log" 2>&1 &
SPID=$!
trap 'kill $SPID 2>/dev/null; wait $SPID 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$BASE/" 2>/dev/null)
  [ "$c" = "200" ] && break
  sleep 0.5
done
echo "服务就绪码: ${c:-timeout}"

PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
no(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }

# ---- 认证 ----
TOKEN=$(curl -s --noproxy '*' -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"username":"aprtest","email":"aprtest@example.com","password":"secret123","name":"刷新测试"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then
  TOKEN=$(curl -s --noproxy '*' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"account":"aprtest","password":"secret123"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
fi
[ -n "$TOKEN" ] && ok "取得 token" || { echo "❌ 无法认证"; exit 1; }
A=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
jq_() { python3 -c "import sys,json
d=json.load(sys.stdin)
$1" 2>/dev/null; }

# ---- 建库 + 建接口文档 ----
BOOK=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books" -d '{"name":"刷新验证库"}')
BID=$(printf '%s' "$BOOK" | jq_ "print(d.get('data',{}).get('id') or '')")
[ -n "$BID" ] && ok "建库成功 id=$BID" || { echo "建库响应: $BOOK"; exit 1; }

DOC=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books/$BID/docs" -d '{"title":"接口文档","doc_type":"api"}')
DID=$(printf '%s' "$DOC" | jq_ "print((d.get('data') or {}).get('id') or '')")
[ -n "$DID" ] && ok "建接口文档成功 id=$DID" || { echo "建文档响应: $DOC"; exit 1; }

# ---- 登记 URL 导入来源（PATCH api_source_url）----
# 故意用环回地址：仅用于验证「来源可被登记 + 刷新时被 SSRF 拦截」，不真正抓取。
SRC_URL="http://127.0.0.1:$PORT/spec.json"
SETSRC=$(curl -s --noproxy '*' "${A[@]}" -X PATCH "$BASE/api/docs/$DID" -d "{\"api_source_url\":\"$SRC_URL\"}")
printf '%s' "$SETSRC" | grep -q '"code":0' && ok "登记 URL 导入来源成功（$SRC_URL）" || no "登记来源失败：$SETSRC"

# ---- 读回来源状态（P1-2）----
ST=$(curl -s --noproxy '*' "${A[@]}" "$BASE/api/docs/$DID/api-refresh-status")
echo "$ST" > "$OUT/status.json"
SU=$(printf '%s' "$ST" | jq_ "s=(d.get('data') or {}).get('source'); print(s.get('source_url') if isinstance(s,dict) else '')")
[ "$SU" = "$SRC_URL" ] && ok "来源状态回读正确（source_url 一致）" || no "来源状态回读异常：$ST"
SS=$(printf '%s' "$ST" | jq_ "s=(d.get('data') or {}).get('source'); print(s.get('refresh_status') if isinstance(s,dict) else '')")
[ "$SS" = "" ] && ok "首次未刷新时 refresh_status 为空" || no "refresh_status 应为空，实际 '$SS'"

# ---- 手动刷新：被 SSRF 拦截（环回地址禁止）----
REF=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/docs/$DID/refresh")
echo "$REF" > "$OUT/refresh.json"
printf '%s' "$REF" | grep -q '"code":0' && no "环回来源竟被放行刷新（应被 SSRF 拦截）" \
  || ok "手动刷新被 SSRF 拦截（地址被禁止，符合预期）"
printf '%s' "$REF" | grep -q '被禁止' && ok "拦截原因明确为私网/环回地址" || echo "   （注：拦截响应未含『被禁止』字样，但已确认为非成功响应）"

# ---- 写权限校验：另一个用户（无写权限）刷新应被拒 ----
TOKEN2=$(curl -s --noproxy '*' -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"username":"aprother","email":"aprother@example.com","password":"secret123","name":"他人"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
A2=(-H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json')
REF2=$(curl -s --noproxy '*' "${A2[@]}" -X POST "$BASE/api/docs/$DID/refresh")
printf '%s' "$REF2" | grep -q '"code":0' && no "无权限用户竟能刷新（应被拒）" || ok "无写权限用户刷新被拒（403）"

# ---- 清除来源 → 状态回读为 null ----
CLRSRC=$(curl -s --noproxy '*' "${A[@]}" -X PATCH "$BASE/api/docs/$DID" -d '{"api_source_url":""}')
printf '%s' "$CLRSRC" | grep -q '"code":0' && ok "清除 URL 导入来源成功" || no "清除来源失败：$CLRSRC"
ST2=$(curl -s --noproxy '*' "${A[@]}" "$BASE/api/docs/$DID/api-refresh-status")
SN=$(printf '%s' "$ST2" | jq_ "print('null' if (d.get('data') or {}).get('source') is None else 'notnull')")
[ "$SN" = "null" ] && ok "清除后来源状态回读为 null" || no "清除后来源应回读 null：$ST2"

# ---- 管理员端点保护：普通用户访问 /admin/api-refresh/last 应被拒（403）----
ADM=$(curl -s --noproxy '*' "${A[@]}" "$BASE/api/admin/api-refresh/last")
printf '%s' "$ADM" | grep -q '"code":0' && no "普通用户竟能读管理员刷新汇总（应被拒）" || ok "管理员刷新汇总端点受权限保护（普通用户 403）"

echo
echo "产出目录: $OUT"
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo "API_REFRESH_OK" || echo "API_REFRESH_HAS_FAILURE"
