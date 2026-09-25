#!/usr/bin/env bash
# H5 缩放清晰度 + 思维导图视口高度回归：
#   1. H5ZoomStage 双指放大松手后「折叠进 layout zoom」（data-h5-zoom-layout>100）
#      —— 浏览器按真实尺寸重排，DOCX 文字/PDF 矢量不发糊；
#   2. PdfViewer 缩放感知重渲染：可见页 canvas backing 分辨率随缩放提高、CSS 尺寸不变、
#      重置后回落（PDF 放大不发糊的机制）；
#   3. 缩放修复不破坏 1:1 原生划屏（touch-action 复位链路）；
#   4. 思维导图桌面阅读页 / 分享页画布填满视口剩余高度（不再固定 560px）。
# 触摸序列走 Playwright CDP（见 h5-zoom-sharp.mjs 头注释）。
set -uo pipefail

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro
export TMPDIR=/home/macro/.workbuddy/tmp
export XDG_RUNTIME_DIR=/home/macro/.workbuddy/tmp/xdg
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR"

PORT=${PORT:-8186}
TS=$(date +%s)
OUT=/home/macro/.workbuddy/tmp/zoomsharp-$TS
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [ -n "${E2E_DATA:-}" ]; then
  DATA=$E2E_DATA
else
  DATA=$TMPDIR/zoomsharp-data-$TS
  mkdir -p "$DATA"
  cp -r "$HERE/fixtures/e2e-data/." "$DATA/"
fi
BASE=http://127.0.0.1:$PORT
BIN=${HAIKU_BIN:-/home/macro/.workbuddy/tmp/haiku-wiki}
mkdir -p "$OUT"

[ -x "$BIN" ] || { echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/api/books" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi

DATA_DIR="$DATA" PORT="$PORT" JWT_SECRET=e2e-secret-for-verify GIN_MODE=release \
  "$BIN" >"$OUT/server.log" 2>&1 &
BPID=$!
cleanup() { kill "$BPID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

PASS=0; FAIL=0
ok() { if [ "$2" = "1" ]; then PASS=$((PASS+1)); printf '   \033[32m✅ %s\033[0m\n' "$1"; else FAIL=$((FAIL+1)); printf '   \033[31m❌ %s（实测 %s）\033[0m\n' "$1" "$2"; fi; }

code=000
for _ in $(seq 1 60); do
  code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books" 2>/dev/null)
  [ "$code" != "000" ] && [ -n "$code" ] && break
  sleep 0.3
done
echo "后端就绪：HTTP $code"

TOKEN=""
for i in $(seq 1 40); do
  TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
  if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && [ "${#TOKEN}" -gt 20 ]; then break; fi
  sleep 0.5
done
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then echo "❌ 登录失败"; tail -8 "$OUT/server.log"; exit 1; fi
echo "登录成功（重试 ${i} 次）"
H=(-H "Authorization: Bearer $TOKEN")

# 夹具：夹具库 1 的 doc 3 = 思维导图、doc 5 = file（PDF）。
# DOCX 附件现造一个：上传 import 夹具 docx → 建 file 文档。
DOCX_FILE="$HERE/fixtures/import-fixtures/导入的Word文档.docx"
DOCX_DOC_ID=0
if [ -f "$DOCX_FILE" ]; then
  UP=$(curl --noproxy '*' -s -X POST "$BASE/api/uploads" "${H[@]}" -F "file=@$DOCX_FILE;filename=缩放回归.docx")
  UURL=$(echo "$UP" | jq -r '.data.url // empty')
  USIZE=$(echo "$UP" | jq -r '.data.size // 0')
  if [ -n "$UURL" ]; then
    UJSON=$(jq -cn --arg u "$UURL" --arg f "缩放回归.docx" --argjson s "$USIZE" '{url:$u,filename:$f,size:$s,ext:"docx"}')
    DOCX_DOC_ID=$(curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" "${H[@]}" \
      -H 'Content-Type: application/json' \
      -d "$(jq -cn --arg t "缩放回归-DOCX" --arg c "$UJSON" '{parent_id:0,title:$t,doc_type:"file",content:$c}')" | jq -r '.data.id')
  fi
fi
echo "DOCX 文档 id=$DOCX_DOC_ID"

# 思维导图文档级分享 slug（桌面分享页高度断言用）
MM_SLUG=$(curl --noproxy '*' -s -X PUT "$BASE/api/docs/3/share" "${H[@]}" \
  -H 'Content-Type: application/json' -d '{"enabled":true}' | jq -r '.data.slug')
echo "思维导图分享 slug=$MM_SLUG"

echo "== 探针：双指缩放 / 折叠 / PDF 升清 / 划屏回归 / 导图高度 =="
BASE="$BASE" TOKEN="$TOKEN" OUT="$OUT" DOCX_DOC_ID="$DOCX_DOC_ID" MM_DOC_ID=3 MM_SLUG="$MM_SLUG" \
  node "$HERE/h5-zoom-sharp.mjs" 2>&1 | tee "$OUT/probe.log"

# 解析 RESULT 行断言（探针输出：RESULT <case> <step> <value> ok=<true|false>）
while IFS= read -r line; do
  case "$line" in
    RESULT*)
      name=$(echo "$line" | awk '{print $2}')
      step=$(echo "$line" | awk '{print $3}')
      okv=$(echo "$line" | awk '{print $4}' | cut -d= -f2)
      val=$(echo "$line" | cut -d' ' -f5-)
      if [ "$okv" = "true" ]; then
        PASS=$((PASS+1)); printf '   \033[32m✅ %s/%s = %s\033[0m\n' "$name" "$step" "$val"
      else
        FAIL=$((FAIL+1)); printf '   \033[31m❌ %s/%s = %s\033[0m\n' "$name" "$step" "$val"
      fi
      ;;
  esac
done < "$OUT/probe.log"

echo
echo "======== 结果：通过 $PASS 项，失败 $FAIL 项 ========"
echo "输出目录：$OUT"
[ "$FAIL" = "0" ] || exit 1
echo "ZOOM_SHARP_CHECK_PASS"
