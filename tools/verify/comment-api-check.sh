#!/usr/bin/env bash
# 文档点评 / 讨论区 端到端 API 验证（III）：
#   登录用户：建库 → 建文档 → 发帖 → 跟帖 → 列表树 → 设置回读(banned_uids) →
#   锁定后禁言 → 解除 → 禁言某用户(名单回读) → 删帖(软删) → 清空
#   匿名访客：建文档级分享 → 免登录发帖 → 免登录列表(可见 guest_name)
# 全程单会话起停一次后端，使用全新数据目录（AutoMigrate 自动建 comments / comment_settings）。
set -uo pipefail

TMP=${HAIKU_TMP:-/home/macro/.workbuddy/tmp}
PORT=${PORT:-8100}
BASE=http://127.0.0.1:$PORT
BIN=${HAIKU_BIN:-$TMP/haiku-wiki}
OUT=$TMP/comment-api-out-$(date +%s)
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

DATA=$TMP/comment-api-data-$(date +%s); mkdir -p "$DATA"
PORT=$PORT DATA_DIR="$DATA" JWT_SECRET=commentcheck GIN_MODE=release \
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
  -d '{"username":"cmtest","email":"cmtest@example.com","password":"secret123","name":"点评测试"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then
  TOKEN=$(curl -s --noproxy '*' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"account":"cmtest","password":"secret123"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
fi
[ -n "$TOKEN" ] && ok "取得 token" || { echo "❌ 无法认证"; exit 1; }
A=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
jq_() { python3 -c "import sys,json
d=json.load(sys.stdin)
$1" 2>/dev/null; }

# ---- 建库 + 建文档 ----
BOOK=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books" -d '{"name":"点评验证库"}')
BID=$(printf '%s' "$BOOK" | jq_ "print(d.get('data',{}).get('id') or '')")
[ -n "$BID" ] && ok "建库成功 id=$BID" || { echo "建库响应: $BOOK"; exit 1; }

DOC=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books/$BID/docs" -d '{"title":"点评主题文档","doc_type":"markdown"}')
DID=$(printf '%s' "$DOC" | jq_ "print((d.get('data') or {}).get('id') or '')")
[ -n "$DID" ] && ok "建文档成功 id=$DID" || { echo "建文档响应: $DOC"; exit 1; }

# ---- 发根帖 ----
ROOT=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/docs/$DID/comments" \
  -d '{"body":"这是根帖，支持 **Markdown** 与图片 ![x](/uploads/x.png)"}')
echo "$ROOT" > "$OUT/create-root.json"
CID=$(printf '%s' "$ROOT" | jq_ "print((d.get('data') or {}).get('id') or '')")
printf '%s' "$ROOT" | grep -q '"code":0' && [ -n "$CID" ] && ok "发根帖成功 id=$CID" || no "发根帖失败：$ROOT"

# ---- 跟帖 ----
REP=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/docs/$DID/comments" \
  -d "$(python3 -c "import json; print(json.dumps({'body':'这是跟帖','parent_id':$CID}))")")
RCID=$(printf '%s' "$REP" | jq_ "print((d.get('data') or {}).get('id') or '')")
printf '%s' "$REP" | grep -q '"code":0' && [ -n "$RCID" ] && ok "发跟帖成功 id=$RCID（parent=$CID）" || no "发跟帖失败：$REP"

# ---- 列表树 ----
LST=$(curl -s --noproxy '*' "${A[@]}" "$BASE/api/docs/$DID/comments")
echo "$LST" > "$OUT/list.json"
TOP=$(printf '%s' "$LST" | jq_ "print(len((d.get('data') or {}).get('comments') or []))")
CHD=$(printf '%s' "$LST" | jq_ "cs=(d.get('data') or {}).get('comments') or []; print(len(cs[0].get('children') or []) if cs else 0)")
MOD=$(printf '%s' "$LST" | jq_ "print((d.get('data') or {}).get('can_moderate') or False)")
[ "$TOP" = "1" ] && ok "列表顶层 1 帖（树形正确）" || no "列表顶层应为 1，实际 $TOP"
[ "$CHD" = "1" ] && ok "根帖下有 1 条跟帖（树形正确）" || no "跟帖数应为 1，实际 $CHD"
[ "$MOD" = "True" ] && ok "文档所有者具备 can_moderate" || no "所有者应可管理，can_moderate=$MOD"

# ---- 设置回读（验证 banned_uids 现在随配置返回，修复清空禁言名单的 bug）----
SET=$(curl -s --noproxy '*' "${A[@]}" "$BASE/api/docs/$DID/comment-settings")
echo "$SET" > "$OUT/settings.json"
AV=$(printf '%s' "$SET" | jq_ "print((d.get('data') or {}).get('allow_view') or '')")
AP=$(printf '%s' "$SET" | jq_ "print((d.get('data') or {}).get('allow_post') or '')")
BAN=$(printf '%s' "$SET" | jq_ "import json; print(json.dumps((d.get('data') or {}).get('banned_uids') or []))")
[ "$AV" = "all" ] && ok "allow_view=all（默认）" || no "allow_view=$AV"
[ "$AP" = "all" ] && ok "allow_post=all（默认，匿名可发帖）" || no "allow_post=$AP"
echo "$SET" | grep -q 'banned_uids' && ok "配置回读含 banned_uids 字段（修复点）" || no "配置未回传 banned_uids"

# ---- 锁定后禁言 ----
LOCK=$(curl -s --noproxy '*' "${A[@]}" -X PUT "$BASE/api/docs/$DID/comment-settings" -d '{"locked":true}')
printf '%s' "$LOCK" | grep -q '"locked":true' && ok "锁定点评区成功" || no "锁定失败：$LOCK"
POSTLOCK=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/docs/$DID/comments" -d '{"body":"锁定后不应成功"}')
printf '%s' "$POSTLOCK" | grep -q '"code":0' && no "锁定后仍可发帖（应被拒）" || ok "锁定后发帖被拒（403）"
# 解除锁定
UNLOCK=$(curl -s --noproxy '*' "${A[@]}" -X PUT "$BASE/api/docs/$DID/comment-settings" -d '{"locked":false}')
printf '%s' "$UNLOCK" | grep -q '"locked":false' && ok "解除锁定成功" || no "解除锁定失败：$UNLOCK"

# ---- 禁言某用户（名单回读）----
BANR=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/docs/$DID/comments/$CID/ban")
printf '%s' "$BANR" | grep -q '"code":0' && ok "禁言根帖作者成功" || no "禁言失败：$BANR"
SET2=$(curl -s --noproxy '*' "${A[@]}" "$BASE/api/docs/$DID/comment-settings")
BAN2=$(printf '%s' "$SET2" | jq_ "import json; print(json.dumps((d.get('data') or {}).get('banned_uids') or []))")
echo "$SET2" > "$OUT/settings-after-ban.json"
echo "$BAN2" | python3 -c "import sys,json
v=json.loads(sys.stdin.read() or '[]')
sys.exit(0 if isinstance(v,list) and len(v)>=1 else 1)" && ok "禁言后 banned_uids 名单回读正常：$BAN2" || no "禁言名单未回读：$BAN2"

# ---- 删帖（软删）----
DEL=$(curl -s --noproxy '*' "${A[@]}" -X DELETE "$BASE/api/docs/$DID/comments/$CID")
printf '%s' "$DEL" | grep -q '"code":0' && ok "删根帖成功（软删）" || no "删帖失败：$DEL"
LST2=$(curl -s --noproxy '*' "${A[@]}" "$BASE/api/docs/$DID/comments")
ST=$(printf '%s' "$LST2" | jq_ "cs=(d.get('data') or {}).get('comments') or []; print(cs[0].get('status') if cs else '')")
[ "$ST" = "deleted" ] && ok "管理者列表可见被删帖 status=deleted（树结构保留）" || no "软删后状态应为 deleted，实际 '$ST'"

# ---- 清空 ----
CLR=$(curl -s --noproxy '*' "${A[@]}" -X DELETE "$BASE/api/docs/$DID/comments/all")
printf '%s' "$CLR" | grep -q '"code":0' && ok "清空本文所有发帖成功" || no "清空失败：$CLR"
LST3=$(curl -s --noproxy '*' "${A[@]}" "$BASE/api/docs/$DID/comments")
TOP3=$(printf '%s' "$LST3" | jq_ "print(len((d.get('data') or {}).get('comments') or []))")
[ "$TOP3" = "0" ] && ok "清空后列表为空" || no "清空后仍有 $TOP3 帖"

# ---- 匿名访客：建文档级分享 → 免登录发帖 → 免登录列表 ----
SH=$(curl -s --noproxy '*' "${A[@]}" -X PUT "$BASE/api/docs/$DID/share" -d '{"enabled":true}')
SLUG=$(printf '%s' "$SH" | jq_ "print((d.get('data') or {}).get('slug') or '')")
[ -n "$SLUG" ] && ok "建文档级分享成功 slug=$SLUG" || { echo "分享响应: $SH"; no "建分享失败"; }

ANONPOST=$(curl -s --noproxy '*' -X POST "$BASE/api/public/doc-comments" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c "import json; print(json.dumps({'slug':'$SLUG','doc_id':$DID,'body':'我是匿名访客的帖子','guest_name':'路人甲'}))")")
ACID=$(printf '%s' "$ANONPOST" | jq_ "print((d.get('data') or {}).get('id') or '')")
printf '%s' "$ANONPOST" | grep -q '"code":0' && [ -n "$ACID" ] && ok "匿名发帖成功 id=$ACID" || no "匿名发帖失败：$ANONPOST"

ANONLST=$(curl -s --noproxy '*' "$BASE/api/public/doc-comments?slug=$SLUG&doc_id=$DID")
echo "$ANONLST" > "$OUT/anon-list.json"
AGN=$(printf '%s' "$ANONLST" | jq_ "cs=(d.get('data') or {}).get('comments') or []; print(cs[0].get('guest_name') if cs else '')")
ATOP=$(printf '%s' "$ANONLST" | jq_ "print(len((d.get('data') or {}).get('comments') or []))")
[ "$ATOP" = "1" ] && ok "匿名列表可见 1 帖" || no "匿名列表帖数=$ATOP"
[ "$AGN" = "路人甲" ] && ok "匿名帖 guest_name=路人甲（正确署名）" || no "guest_name 应为 路人甲，实际 '$AGN'"

echo
echo "产出目录: $OUT"
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo "COMMENT_API_OK" || echo "COMMENT_API_HAS_FAILURE"
