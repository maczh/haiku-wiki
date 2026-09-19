#!/usr/bin/env bash
# 甘特图（doc_type=gantt）端到端 API 验证：
#   建库 → 建甘特图文档（断言类型未被静默降级）→ PATCH 正文 → GET 回读 → 导出 md/xlsx
# 全程单会话起停一次后端。
set -uo pipefail

TMP=${HAIKU_TMP:-/home/macro/.workbuddy/tmp}
PORT=${PORT:-8098}
BASE=http://127.0.0.1:$PORT
BIN=${HAIKU_BIN:-$TMP/haiku-wiki}
OUT=$TMP/gantt-api-out-$(date +%s)
mkdir -p "$OUT"

# 前置检查（README「已知坑」第 5 条）：二进制存在 + 端口空闲，避免连上幽灵实例。
[ -x "$BIN" ] || { echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi

export PATH=/usr/local/go/bin:$PATH
export HOME=/home/macro TMPDIR=$TMP/gotmp
export GOPATH=/home/macro/.workbuddy/go GOMODCACHE=/home/macro/.workbuddy/go/pkg/mod
export GOCACHE=/home/macro/.workbuddy/go/cache GOPROXY=https://goproxy.cn,direct GOSUMDB=off
unset http_proxy https_proxy

DATA=$TMP/gantt-api-data-$(date +%s); mkdir -p "$DATA"
PORT=$PORT DATA_DIR="$DATA" JWT_SECRET=ganttcheck GIN_MODE=release \
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
  -d '{"username":"gantt","email":"gantt@example.com","password":"secret123","name":"gantt"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then
  TOKEN=$(curl -s --noproxy '*' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"account":"gantt","password":"secret123"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
fi
[ -n "$TOKEN" ] && ok "取得 token" || { echo "❌ 无法认证"; exit 1; }
A=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
jq_() { python3 -c "import sys,json;
d=json.load(sys.stdin)
$1" 2>/dev/null; }

# ---- 建库 ----
BOOK=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books" -d '{"name":"甘特图验证库"}')
BID=$(printf '%s' "$BOOK" | jq_ "print(d.get('data',{}).get('id') or d.get('data',{}).get('ID') or '')")
[ -n "$BID" ] && ok "建库成功 id=$BID" || { echo "建库响应: $BOOK"; exit 1; }

# ---- 建甘特图文档 ----
DOC=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books/$BID/docs" \
  -d '{"title":"项目排期","doc_type":"gantt"}')
DID=$(printf '%s' "$DOC" | jq_ "print((d.get('data') or {}).get('id') or '')")
DT=$(printf '%s' "$DOC" | jq_ "print((d.get('data') or {}).get('doc_type') or '')")
echo "$DOC" > "$OUT/create-doc.json"
[ -n "$DID" ] && ok "建文档成功 id=$DID" || { echo "建文档响应: $DOC"; exit 1; }
if [ "$DT" = "gantt" ]; then ok "doc_type 保留为 gantt（未被 validDocTypes 静默降级）"; else no "doc_type 实际为 '$DT'，期望 gantt"; fi

# ---- 对照：未知类型应降级为 markdown（证明上面的断言有效）----
BAD=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books/$BID/docs" \
  -d '{"title":"对照","doc_type":"vxe-gantt"}')
BDT=$(printf '%s' "$BAD" | jq_ "print((d.get('data') or {}).get('doc_type') or '')")
[ "$BDT" = "markdown" ] && ok "对照组：未知类型 vxe-gantt → 降级为 markdown（$BDT）" || no "对照组异常：$BDT"

# ---- 写正文 ----
CONTENT='{"version":1,"tasks":[{"id":1,"text":"需求评审","start":"2026-09-01","duration":3,"progress":100,"type":"task","parent":0},{"id":2,"text":"开发","start":"2026-09-04","duration":10,"progress":40,"type":"summary","parent":0},{"id":3,"text":"前端","start":"2026-09-04","duration":6,"progress":55,"type":"task","parent":2},{"id":4,"text":"后端","start":"2026-09-10","duration":4,"progress":20,"type":"task","parent":2},{"id":5,"text":"上线","start":"2026-09-16","duration":0,"progress":0,"type":"milestone","parent":0}],"links":[{"id":1,"source":1,"target":2,"type":"e2s"},{"id":2,"source":4,"target":5,"type":"e2s"}]}'
PATCH=$(curl -s --noproxy '*' "${A[@]}" -X PATCH "$BASE/api/docs/$DID" \
  -d "$(python3 -c "import json,sys; print(json.dumps({'content': sys.argv[1], 'source':'manual'}))" "$CONTENT")")
echo "$PATCH" > "$OUT/patch.json"
printf '%s' "$PATCH" | grep -q '"code":0' && ok "PATCH /api/docs/$DID 成功" || { no "PATCH 失败：$PATCH"; }

# ---- 回读 ----
GOT=$(curl -s --noproxy '*' "${A[@]}" "$BASE/api/docs/$DID")
echo "$GOT" > "$OUT/get-doc.json"
# 注意：content 是「JSON 字符串」字段，不能再 json.dumps，否则双重转义
GOTC=$(printf '%s' "$GOT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(((d.get('data') or {}).get('doc') or {}).get('content') or '')" 2>/dev/null)
if [ "$GOTC" = "$CONTENT" ]; then
  ok "GET 回读正文与写入完全一致（${#GOTC} 字节，数据已落库）"
else
  no "回读不一致：写入 ${#CONTENT} / 读回 ${#GOTC}"
  echo "    写入: $CONTENT"; echo "    读回: $GOTC"
fi
# 关键字段回读校验
for k in '"text":"后端"' '"progress":55' '"type":"milestone"' '"type":"e2s"'; do
  printf '%s' "$GOTC" | grep -q "$k" && ok "回读含 $k" || no "回读缺 $k"
done
GDT=$(printf '%s' "$GOT" | python3 -c "
import sys,json; d=json.load(sys.stdin); print(((d.get('data') or {}).get('doc') or {}).get('doc_type') or '')" 2>/dev/null)
[ "$GDT" = "gantt" ] && ok "GET 的 doc_type 仍为 gantt" || no "GET doc_type=$GDT"

# ---- 导出格式清单 ----
FMT=$(curl -s --noproxy '*' "${A[@]}" "$BASE/api/export/docs/$DID/formats")
echo "$FMT" > "$OUT/formats.json"
FL=$(printf '%s' "$FMT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
fs=(d.get('data') or {}).get('formats') or d.get('data') or []
print(','.join(sorted(str(f.get('format') or f) for f in fs)))" 2>/dev/null)
echo "    导出格式清单: $FL"
printf '%s' "$FL" | grep -q 'xlsx' && ok "格式清单含 xlsx" || no "格式清单缺 xlsx"
printf '%s' "$FL" | grep -q 'md' && ok "格式清单含 md" || no "格式清单缺 md"
printf '%s' "$FL" | grep -q 'json' && ok "格式清单含 json" || no "格式清单缺 json"

# ---- 实际导出 ----
curl -s --noproxy '*' "${A[@]}" "$BASE/api/export/docs/$DID?format=md" -o "$OUT/gantt.md"
curl -s --noproxy '*' "${A[@]}" "$BASE/api/export/docs/$DID?format=xlsx" -o "$OUT/gantt.xlsx"
MDL=$(wc -c < "$OUT/gantt.md"); XLL=$(wc -c < "$OUT/gantt.xlsx")
[ "$MDL" -gt 100 ] && ok "导出 md（$MDL 字节）" || no "导出 md 过小（$MDL）"
[ "$XLL" -gt 1000 ] && ok "导出 xlsx（$XLL 字节）" || no "导出 xlsx 过小（$XLL）"
head -20 "$OUT/gantt.md"
grep -q '需求评审' "$OUT/gantt.md" && ok "md 含任务名" || no "md 缺任务名"
grep -q '里程碑\|上线' "$OUT/gantt.md" && ok "md 含里程碑行" || no "md 缺里程碑行"
python3 -c "
import zipfile,sys
z=zipfile.ZipFile('$OUT/gantt.xlsx')
print('    xlsx 条目:', z.namelist()[:8])
" && ok "xlsx 是可打开的 zip 包" || no "xlsx 结构异常"

# ---- 版本快照（PATCH 应产生版本）----
VER=$(curl -s --noproxy '*' "${A[@]}" "$BASE/api/docs/$DID/versions")
echo "$VER" > "$OUT/versions.json"
VC=$(printf '%s' "$VER" | python3 -c "
import sys,json; d=json.load(sys.stdin); v=d.get('data') or []; print(len(v) if isinstance(v,list) else 0)" 2>/dev/null)
[ "$VC" -ge 1 ] && ok "PATCH 产生了 $VC 条版本快照" || no "版本快照数 $VC"

echo
echo "产出目录: $OUT"
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo "GANTT_API_OK" || echo "GANTT_API_HAS_FAILURE"
