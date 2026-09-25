#!/usr/bin/env bash
# H5 回归：「进入文档页 → 返回文库目录页后，目录失去上下划屏滚动能力」。
#
# 反馈原文（2026-09-24）：**除了 md / docx / 思维导图**，其他类型文档进入 H5 页面后返回
# 文库目录页，就失去上下划屏滚动能力。→ 说明是「某些文档页在卸载时留下了全局副作用」。
#
# ⚠️ 本脚本的要害在 `h5-touch-scroll.mjs`：用 **CDP 派发真实触摸手势**
#   （`Input.synthesizeScrollGesture` + `gestureSourceType:'touch'` + isMobile/hasTouch）。
#   早期版本用 `el.scrollTop = 200` 做「可滚性」判断 —— 那是**程序化滚动**，
#   走不到浏览器的手势识别/touch-action 路径，因此 12 种类型全绿却依旧被用户投诉划不动。
#
# 必须一次跑完：后台进程会在单次工具调用结束后被回收。
set -uo pipefail

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro
export TMPDIR=/home/macro/.workbuddy/tmp
export XDG_RUNTIME_DIR=/home/macro/.workbuddy/tmp/xdg
export CHROME_PATH=/opt/google/chrome/chrome
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR"

PORT=${PORT:-8178}
TS=$(date +%s)
OUT=/home/macro/.workbuddy/tmp/h5sb-$TS
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DATA=$TMPDIR/h5sb-data-$TS
mkdir -p "$DATA" "$OUT"
cp -r "$HERE/fixtures/e2e-data/." "$DATA/"
BASE=http://127.0.0.1:$PORT

[ -x "$TMPDIR/haiku-wiki" ] || { echo "❌ 找不到 $TMPDIR/haiku-wiki —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用 → 用 PORT=<空闲端口> 重跑"; exit 1
fi

DATA_DIR="$DATA" PORT="$PORT" JWT_SECRET=e2e-secret-for-verify GIN_MODE=release \
  "$TMPDIR/haiku-wiki" >"$OUT/server.log" 2>&1 &
BPID=$!
cleanup() { kill "$BPID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

say()  { printf '\n\033[36m== %s ==\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }

code=000
for _ in $(seq 1 60); do
  code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books" 2>/dev/null)
  [ "$code" != "000" ] && [ -n "$code" ] && break
  sleep 0.3
done
info "后端就绪：HTTP $code"
curl --noproxy '*' -s "$BASE/" | grep -q 'id="root"' || { echo "❌ 内嵌 dist 未生效"; exit 1; }

# ⚠️ AutoMigrate 异步：就绪 ≠ 表已迁移完，登录要重试（否则整套假红）
TOKEN=""
for i in $(seq 1 40); do
  TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
  [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && [ "${#TOKEN}" -gt 20 ] && break
  sleep 0.5
done
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && info "登录成功" || { echo "❌ 登录失败"; tail -5 "$OUT/server.log"; exit 1; }

mkdoc() { # $1=doc_type $2=title → 回显 id
  curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"parent_id\":0,\"title\":\"$2\",\"doc_type\":\"$1\",\"content\":\"\"}" | jq -r '.data.id'
}

say "造夹具：覆盖全部 doc_type"
# 夹具自带：1=markdown 2=sheet 3=mindmap 4=flowchart 5=file(pdf)
declare -A IDS=( [markdown]=1 [sheet]=2 [mindmap]=3 [flowchart]=4 [file]=5 )
for t in gantt api whiteboard drawing todo calendar prototype; do
  IDS[$t]=$(mkdoc "$t" "滚动回归-$t")
done
info "doc ids: $(for k in "${!IDS[@]}"; do echo -n "$k=${IDS[$k]} "; done)"

# ⚠️ 必须把文库页撑到「可滚动」：只有 5~13 篇文档时 [data-h5-main] 的
#    scrollHeight === clientHeight（实测 736/736），压根没有可滚空间，
#    用例会全部退化成「本来就不可滚」而失去意义。补 40 篇填充（实测 sh≈2094 / ch≈736）。
say "填充文档：把文库目录页撑到可滚动"
for i in $(seq -w 1 40); do mkdoc markdown "滚动回归-填充$i" >/dev/null; done
info "填充完成"

TREE=$(curl --noproxy '*' -s "$BASE/api/books/1/docs" -H "Authorization: Bearer $TOKEN")
title_of() { echo "$TREE" | jq -r --argjson id "$1" '.data[]|select(.id==$id)|.title' 2>/dev/null; }

CASES_JSON="["
for t in markdown sheet mindmap flowchart file gantt api whiteboard drawing todo calendar prototype; do
  id=${IDS[$t]}
  title=$(title_of "$id")
  [ -z "$title" ] || [ "$title" = "null" ] && { info "⚠️ 取不到 doc $id 标题，跳过 $t"; continue; }
  CASES_JSON+=$(jq -cn --arg n "$t" --argjson i "$id" --arg ti "$title" '{name:$n,id:$i,title:$ti}')","
done
CASES_JSON="${CASES_JSON%,}]"
info "用例数：$(echo "$CASES_JSON" | jq 'length')"

say "真实触摸划屏：文库页 → 文档页 → 返回文库页"
set +e
OUT="$OUT" BASE="$BASE" TOKEN="$TOKEN" CASES="$CASES_JSON" \
  node "$HERE/h5-touch-scroll.mjs" 2>&1 | tee "$OUT/touch.log" | grep -E 'RESULT|DIAG|TOUCH_SCROLL_FAILURES='
set -e

PASS=$(grep -c 'ok=true' "$OUT/touch.log" || true)
FAIL=$(grep -c 'ok=false' "$OUT/touch.log" || true)
SKIP=$(grep -c 'ok=skip' "$OUT/touch.log" || true)

echo
echo "================ 汇总 ================"
echo "✅ 通过 $PASS 项 / ❌ 失败 $FAIL 项 / ⏭ 跳过 $SKIP 项"
echo "输出目录：$OUT"
[ "$FAIL" -eq 0 ] && echo H5_SCROLL_BACK_PASS || echo H5_SCROLL_BACK_FAIL
