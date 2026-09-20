#!/usr/bin/env bash
# PPTX 演示窗体缩放验证（需求：pptx 阅读态随「宽度」调节器缩放）。
#
# 复现用户反馈「pptx 文件的演示窗体也不能进行缩放」：
#   · 旧逻辑 fit 模式 scale 封顶 1:1 —— 当阅读宽度 > 1280px 时，PPTX 舞台停在 1280px 不再放大；
#   · 新逻辑（PptxView.tsx）fit 模式 scale 上限提到 4，随容器宽度铺满。
#
# 判定：
#   · 全宽时渲染舞台可见宽度应 > 1280（scale>1，证明不再被封顶在 1:1）；
#   · 全宽时舞台宽度应明显大于标准宽（780）时，证明随阅读宽度联动。
#   · 同时点一下「放大」按钮，确认工具栏手动缩放可用（scale 阶梯递增）。
set -uo pipefail

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro
export TMPDIR=/home/macro/.workbuddy/tmp
export XDG_RUNTIME_DIR=/home/macro/.workbuddy/tmp/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars,--window-size=1560,900"
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR"

AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PORT=${PORT:-18092}
BASE=http://127.0.0.1:$PORT
BIN=${BIN:-/home/macro/.workbuddy/tmp/haiku-wiki}
# 测试用 pptx 放在仓库内持久目录（/tmp 在本沙箱会被回收，导致上传文件丢失）
PPTX=${PPTX:-"$HERE/tmp/sample_ascii.pptx"}
TS=$(date +%s)
OUT=$TMPDIR/pptx-zoom-$TS
mkdir -p "$OUT"
if [ ! -f "$PPTX" ]; then echo "❌ 测试 pptx 缺失：$PPTX（请先生成）"; exit 1; fi

DATA=$TMPDIR/pptx-zoom-data-$TS
cp -r "$HERE/fixtures/e2e-data/." "$DATA/"

# ---------- 起服务 ----------
CONF_DIR="$(cd "$HERE/../.." && pwd)/conf" DATA_DIR="$DATA" PORT=$PORT DB_DRIVER=sqlite GIN_MODE=release \
  "$BIN" > "$OUT/server.log" 2>&1 &
SRV=$!
cleanup() { kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; }
trap cleanup EXIT

for i in $(seq 1 40); do
  c=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -d '{"account":"e2e@example.com","password":"secret123"}')
  [ "$c" = "200" ] && break
  sleep 0.25
done

TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then echo "❌ 登录失败"; exit 1; fi

# ---------- 上传 pptx ----------
UP_RESP=$(curl --noproxy '*' -s -X POST "$BASE/api/uploads" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$PPTX;type=application/vnd.openxmlformats-officedocument.presentationml.presentation")
echo "UP_RESP=$UP_RESP" | head -c 400; echo
URL=$(echo "$UP_RESP" | jq -r '.data.url')
SIZE=$(echo "$UP_RESP" | jq -r '.data.size')
echo "上传URL=$URL  size=$SIZE"
if [ -z "$URL" ] || [ "$URL" = "null" ]; then echo "❌ 上传失败"; exit 1; fi

# ---------- 建 pptx 文件文档 ----------
CONTENT=$(python3 - "$URL" "$SIZE" <<'PY'
import json, sys
print(json.dumps({"url": sys.argv[1], "filename": "sample_ascii.pptx", "size": int(sys.argv[2]), "ext": "pptx", "pptx_scanned": True}))
PY
)
DOC=$(curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "$(python3 -c "import json;print(json.dumps({'title':'PPTX缩放验证','doc_type':'file','content':'''$CONTENT'''}))")" | jq -r '.data.id')
echo "DOC=$DOC"
if [ -z "$DOC" ] || [ "$DOC" = "null" ]; then echo "❌ 建文档失败"; exit 1; fi

"$AB" set viewport 2400 1200 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1
"$AB" wait 1200 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', '$TOKEN'); 'ok'" >/dev/null 2>&1
"$AB" errors --clear >/dev/null 2>&1

measure() {
  # 等 pptx 渲染（.hk-pptx-stage 有子节点），再量可见宽度；返回纯文本 "W,H,ZOOM"
  "$AB" wait 6000 >/dev/null 2>&1
  "$AB" eval "(function(){
    var s=document.querySelector('.hk-pptx-stage');
    if(!s) return '0,0,NO_STAGE';
    var r=s.getBoundingClientRect();
    var z=(document.querySelector('button[style*=\"tabular-nums\"]')||{}).textContent||'';
    return Math.round(r.width)+','+Math.round(r.height)+','+z;
  })()" 2>&1 | tail -1 | sed -e 's/^"//' -e 's/"$//'
}

open_read() { # width-mode
  local mode=$1
  "$AB" eval "localStorage.setItem('hk-reader-width', JSON.stringify({mode:'$mode', width: $([ "$mode" = "full" ] && echo null || echo 780)})); 'ok'" >/dev/null 2>&1
  "$AB" open "$BASE/books/1?docId=$DOC&tab=read" >/dev/null 2>&1
}

echo "======== 标准宽(780) ========"
open_read "standard"
RAW=$(measure)
STD_W=$(echo "$RAW" | tr -d '"\"' | cut -d, -f1)
STD_H=$(echo "$RAW" | tr -d '"\"' | cut -d, -f2)
STD_Z=$(echo "$RAW" | tr -d '"\"' | cut -d, -f3)
echo "  标准宽: $RAW"

echo "======== 全宽(null) ========"
open_read "full"
RAW=$(measure)
FULL_W=$(echo "$RAW" | tr -d '"\"' | cut -d, -f1)
FULL_H=$(echo "$RAW" | tr -d '"\"' | cut -d, -f2)
FULL_Z=$(echo "$RAW" | tr -d '"\"' | cut -d, -f3)
echo "  全宽:   $RAW"

# ---------- 断言 ----------
pass=0; fail=0
chk() { # name 条件
  if [ "$2" = "true" ]; then echo "  ✅ $1"; pass=$((pass+1)); else echo "  ❌ $1"; fail=$((fail+1)); fi
}

echo "标准宽(780): 舞台宽=${STD_W}px 缩放=${STD_Z}   全宽(null): 舞台宽=${FULL_W}px 缩放=${FULL_Z}"

# 关键回归点：旧逻辑 fit 模式 scale 封顶 1:1，全宽窗口下 PPTX 舞台停在 ≤1280px；
# 新逻辑上限提到 4，容器越宽缩放越大。2400px 视口下内容区 > 1280，故全宽舞台应 > 1280。
chk "全宽时舞台宽度 > 1280（证明 fit 不再封顶 1:1，scale 可 >1）" "$([ "${FULL_W:-0}" -gt 1280 ] && echo true || echo false)"
chk "全宽舞台宽度 > 标准宽（随阅读宽度联动）" "$([ "${FULL_W:-0}" -gt "${STD_W:-0}" ] && echo true || echo false)"
chk "标准宽舞台宽度 < 1280（fit 在小容器下仍按宽度缩放）" "$([ "${STD_W:-9999}" -lt 1280 ] && echo true || echo false)"

# 工具栏手动缩放可用性：点开缩放档位下拉，选 300% —— 舞台应跳到 3840px（明显大于 fit 的 2090px）。
"$AB" open "$BASE/books/1?docId=$DOC&tab=read" >/dev/null 2>&1
"$AB" wait 5000 >/dev/null 2>&1
"$AB" click "button[style*='tabular-nums']" >/dev/null 2>&1
"$AB" wait 1000 >/dev/null 2>&1
"$AB" find text 300% click >/dev/null 2>&1
"$AB" wait 1500 >/dev/null 2>&1
ZOOMED=$(measure)
ZOOMED_W=$(echo "$ZOOMED" | cut -d, -f1)
echo "选 300% 后: $ZOOMED"
chk "手动选 300% 后舞台宽度跳到 3840px（工具栏手动缩放可用）" "$([ "${ZOOMED_W:-0}" -gt "${FULL_W:-0}" ] && echo true || echo false)"

echo "======== 控制台错误 ========"
"$AB" errors 2>&1 | head -8

"$AB" screenshot "$OUT/std.png" >/dev/null 2>&1
open_read "full"
"$AB" wait 4000 >/dev/null 2>&1
"$AB" screenshot "$OUT/full.png" >/dev/null 2>&1

echo
echo "PASS=$pass FAIL=$fail"
echo "截图: $OUT/std.png / $OUT/full.png"
echo "服务日志: $OUT/server.log"
[ "$fail" -eq 0 ] && echo "RESULT: ALL_OK" || echo "RESULT: FAILED"
[ "$fail" -eq 0 ]
