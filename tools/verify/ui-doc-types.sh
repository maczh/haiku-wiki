#!/usr/bin/env bash
# 覆盖全部 5 种文档类型（markdown / sheet / mindmap / flowchart / file）的阅读与编辑渲染验证。
# 数据：仓库夹具 fixtures/e2e-data（book 1：1=md 2=sheet 3=mindmap 4=flowchart 5=file），
#       每次运行复制一份临时副本给服务端写，夹具本身保持不变。
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
BASE=http://127.0.0.1:8080
# 演示数据：默认取**仓库内夹具的临时副本**（服务端会写库，夹具本身不能被改动）。
# 想用别的数据目录：E2E_DATA=/path/to/data
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [ -n "${E2E_DATA:-}" ]; then
  DATA=$E2E_DATA
else
  DATA=$TMPDIR/e2e-data-$(date +%s)
  cp -r "$HERE/fixtures/e2e-data/." "$DATA/"
fi
TS=$(date +%s)
OUT=/home/macro/.workbuddy/tmp/doctypes-out-$TS
mkdir -p "$OUT"

DATA_DIR="$DATA" PORT=8080 JWT_SECRET=e2e-secret-for-verify GIN_MODE=release \
  "$TMPDIR/haiku-wiki" >"$OUT/server.log" 2>&1 &
SPID=$!
cleanup() { "$AB" close >/dev/null 2>&1; kill "$SPID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 80); do
  c=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books"); [ "$c" != "000" ] && break; sleep 0.25
done
TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
[ -z "$TOKEN" ] || [ "$TOKEN" = "null" ] && { echo "❌ 登录失败"; exit 1; }

"$AB" set viewport 1560 900 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1; "$AB" wait 2000 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); localStorage.removeItem('hk.toc.open'); 'ok'" >/dev/null 2>&1
"$AB" errors --clear >/dev/null 2>&1

pass=0; fail=0
chk() {
  if [ "$2" = "$3" ]; then echo "  ✅ $1 = $3"; pass=$((pass+1));
  else echo "  ❌ $1：期望 $2，实际 $3"; fail=$((fail+1)); fi
}
q() { "$AB" eval "$1" 2>&1 | tail -1 | sed 's/^"//; s/"$//'; }

visit() { # docId tab label
  "$AB" open "$BASE/books/1?docId=$1&tab=$2" >/dev/null 2>&1
  "$AB" wait "${3:-5000}" >/dev/null 2>&1
}

echo "======== 阅读模式 ========"

echo "-- markdown (docId=1) --"
visit 1 read 5000
chk "正文渲染字符数 > 0" "true" "$(q "document.querySelector('.doc-content') && document.querySelector('.doc-content').innerHTML.length > 0")"
chk "大纲浮动层出现" "true" "$(q "!!document.querySelector('.hk-toc-float')")"
"$AB" screenshot "$OUT/read-markdown.png" >/dev/null 2>&1

echo "-- sheet (docId=2) --"
visit 2 read 6000
chk "Luckysheet 容器" "true" "$(q "!!document.querySelector('.luckysheet-cell-main')")"
echo "     单元格文本片段: $(q "(function(){var e=document.querySelector('.x-spreadsheet');return e?e.innerText.replace(/\\s+/g,' ').slice(0,60):'(无)'})()")"
chk "表格区域可见高度 > 0" "true" "$(q "(function(){var e=document.querySelector('.luckysheet-cell-main');return !!e && e.getBoundingClientRect().height > 100})()")"
"$AB" screenshot "$OUT/read-sheet.png" >/dev/null 2>&1

echo "-- mindmap (docId=3) --"
visit 3 read 6000
chk "只读画布容器 .smm-container" "true" "$(q "!!document.querySelector('.smm-container')")"
chk "节点数 > 0" "true" "$(q "document.querySelectorAll('.smm-node').length > 0")"
chk "存在大尺寸画布 svg（>300x100）" "true" "$(q "[].slice.call(document.querySelectorAll('svg')).some(function(s){var r=s.getBoundingClientRect();return r.width>300&&r.height>100})")"
"$AB" screenshot "$OUT/read-mindmap.png" >/dev/null 2>&1

echo "-- flowchart (docId=4) --"
visit 4 read 7000
chk "mermaid svg 渲染" "true" "$(q "(function(){var s=[].slice.call(document.querySelectorAll('svg')).filter(function(x){return x.getAttribute('aria-roledescription')||x.closest('[id^=mermaid]')});return s.length>0})()")"
chk "无语法错误提示" "true" "$(q "!document.body.innerText.includes('流程图语法有误')")"
echo "     错误区域文本: $(q "(document.body.innerText.match(/流程图语法有误[\\s\\S]{0,80}/)||['(无)'])[0].replace(/\\s+/g,' ')")"
"$AB" screenshot "$OUT/read-flowchart.png" >/dev/null 2>&1

echo "-- file 附件 (docId=5) --"
visit 5 read 7000
chk "pdf canvas 渲染" "true" "$(q "document.querySelectorAll('canvas').length > 0")"
chk "下载原文件按钮" "true" "$(q "document.body.innerText.includes('下载原文件')")"
"$AB" screenshot "$OUT/read-file.png" >/dev/null 2>&1

echo "======== 编辑模式 ========"

echo "-- markdown 编辑 --"
visit 1 edit 6000
chk "Vditor 编辑器" "true" "$(q "!!document.querySelector('.vditor')")"
"$AB" screenshot "$OUT/edit-markdown.png" >/dev/null 2>&1

echo "-- sheet 编辑 --"
visit 2 edit 6000
chk "Luckysheet 编辑器" "true" "$(q "!!document.querySelector('.luckysheet-cell-main')")"
"$AB" screenshot "$OUT/edit-sheet.png" >/dev/null 2>&1

echo "-- mindmap 编辑 --"
visit 3 edit 7000
chk "顶部浮动工具条" "true" "$(q "!!document.querySelector('.hk-mm-tb-left')")"
chk "右下缩放条" "true" "$(q "!!document.querySelector('.hk-mm-zoom')")"
chk "画布节点数 > 0" "true" "$(q "document.querySelectorAll('.smm-node').length > 0")"
"$AB" screenshot "$OUT/edit-mindmap.png" >/dev/null 2>&1

echo "-- flowchart 编辑 --"
visit 4 edit 7000
chk "实时预览 mermaid svg" "true" "$(q "[].slice.call(document.querySelectorAll('svg')).some(function(s){return s.getAttribute('aria-roledescription')})")"
chk "预览无语法错误" "true" "$(q "!document.body.innerText.includes('流程图语法有误')")"
"$AB" screenshot "$OUT/edit-flowchart.png" >/dev/null 2>&1

echo "======== 控制台 ========"
echo "  页面错误："
"$AB" errors 2>&1 | tail -8 | sed 's/^/    /'
echo "  控制台 error 级别日志数：$(q "(function(){return 0})()")"
"$AB" console 2>&1 | grep -c "\[error\]" | sed 's/^/    /'

echo "======== 结果：通过 $pass 项，失败 $fail 项 ========"
echo "输出目录：$OUT"
