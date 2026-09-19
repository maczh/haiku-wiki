#!/usr/bin/env bash
# 导入端到端验证：真实 xlsx（含空工作表）/ docx / pdf 走浏览器导入链路，
# 断言需求「xlsx 多工作表拆成父+子表格」「docx/pdf 按原文件保存且可预览」。
#
# 关于「选择文件」：agent-browser 的 upload 在本机对该 React 隐藏 input 静默失效
# （命令返回成功但 input.files.length 仍为 0），因此改用 gen-upload-js.py 生成一段
# 在页面内注入的 JS：用真实 File + DataTransfer 设置 input.files 并派发 change，
# 走的是应用真实的 onChange → parseFile → ImportDialog 链路，仅替代 OS 文件选择器。
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
PORT=${PORT:-18081}
BASE=http://127.0.0.1:$PORT
TS=$(date +%s)
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DATA=/home/macro/.workbuddy/tmp/imp-data-$TS
OUT=/home/macro/.workbuddy/tmp/imp-out-$TS
BIN=${HAIKU_BIN:-/home/macro/.workbuddy/tmp/haiku-wiki}
UPLOAD_JS_OUT=$OUT/imp-upload.js
mkdir -p "$DATA" "$OUT"

# 前置检查：二进制存在 + 端口空闲。端口被占用时（常见于别的会话留下的「幽灵实例」，
# `ps` 看不到）本脚本会连上**别人的**服务、并在别人的库里注册用户 → 报「注册失败」，
# 极易被误读成产品缺陷。宁可在这里明确失败，并用 PORT=<空闲端口> 重跑。
[ -x "$BIN" ] || { echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/api/books" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi

DATA_DIR="$DATA" PORT=$PORT JWT_SECRET=e2e-secret-for-verify GIN_MODE=release "$BIN" >"$OUT/server.log" 2>&1 &
SPID=$!
cleanup() { "$AB" close >/dev/null 2>&1; kill "$SPID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 80); do
  code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books" 2>/dev/null)
  [ "$code" != "000" ] && [ -n "$code" ] && break
  sleep 0.25
done
echo "服务就绪：HTTP $code"

TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
  -d '{"username":"imp","name":"Imp","email":"imp@example.com","password":"secret123"}' | jq -r '.data.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then echo "❌ 注册失败"; tail -10 "$OUT/server.log"; exit 1; fi
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

BOOK=$(curl --noproxy '*' -s -X POST "$BASE/api/books" "${H[@]}" \
  -d '{"name":"导入验证库","description":"import e2e","visibility":"private"}' | jq -r '.data.id')
echo "知识库 ID = $BOOK，初始文档数 = $(curl --noproxy '*' -s "$BASE/api/books/$BOOK/docs" "${H[@]}" | jq '.data|length')"

echo "== 浏览器：打开知识库 → 模拟选中 3 个文件 =="
"$AB" set viewport 1560 900 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1; "$AB" wait 2000 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); 'ok'" >/dev/null 2>&1
# ImportDialog 已是「按需挂载」（见按需分包第 3 层修复），知识库页上不再有隐藏的 file input。
# 走 ?import=file 直达参数自动打开「导入文档」抽屉，再注入文件。
"$AB" open "$BASE/books/$BOOK?import=file" >/dev/null 2>&1; "$AB" wait 5000 >/dev/null 2>&1
DRAWER=$("$AB" eval "(document.querySelector('.ant-drawer-title')||{}).textContent||'无'" 2>&1 | tail -1)
echo "  导入抽屉: $DRAWER"

UPLOAD_JS_OUT="$UPLOAD_JS_OUT" python3 "$HERE/gen-upload-js.py"
echo "  注入结果: $("$AB" eval "$(cat "$UPLOAD_JS_OUT")" 2>&1 | tail -1)"

echo "== 等待导入完成 =="
ok=0
for _ in $(seq 1 60); do
  if "$AB" eval "document.body.innerText.includes('完成：成功')" 2>&1 | tail -1 | grep -q true; then ok=1; break; fi
  sleep 0.75
done
echo "  完成提示出现: $ok"
"$AB" eval "(document.body.innerText.match(/完成：成功[^\\n]*/)||[''])[0]" 2>&1 | tail -1
echo "  逐文件结果: $("$AB" eval "(function(){var t=document.body.innerText;var m=t.match(/[^\\n]*(导入成功|失败|不支持|解析)[^\\n]*/g);return m?m.join(' | '):'(无)'})()" 2>&1 | tail -1)"
"$AB" screenshot "$OUT/01-导入结果抽屉.png" >/dev/null 2>&1

echo "== 目录树断言（API 为事实来源） =="
TREE=$(curl --noproxy '*' -s "$BASE/api/books/$BOOK/docs" "${H[@]}")
echo "$TREE" > "$OUT/tree.json"
echo "$TREE" | jq -r '.data[] | "  id=\(.id) parent=\(.parent_id) type=\(.doc_type) title=\(.title)"' | sort -t= -k4

PARENT_ID=$(echo "$TREE" | jq -r '.data[] | select(.title=="多工作表") | .id')
pass=0; fail=0
chk() {
  if [ "$2" = "$3" ]; then echo "  ✅ $1 = $3"; pass=$((pass+1));
  else echo "  ❌ $1：期望 $2，实际 $3"; fail=$((fail+1)); fi
}
chk "父文档「多工作表」类型" "sheet" "$(echo "$TREE" | jq -r '.data[]|select(.title=="多工作表")|.doc_type')"
chk "空白工作表被跳过（子文档数=2）" "2" "$(echo "$TREE" | jq '[.data[]|select(.parent_id=='"${PARENT_ID:-0}"')]|length')"
chk "子「产品」类型" "sheet" "$(echo "$TREE" | jq -r '.data[]|select(.title=="产品")|.doc_type')"
chk "子「区域」类型" "sheet" "$(echo "$TREE" | jq -r '.data[]|select(.title=="区域")|.doc_type')"
chk "子「产品」挂在父文档下" "${PARENT_ID:-x}" "$(echo "$TREE" | jq -r '.data[]|select(.title=="产品")|.parent_id')"
chk "子「区域」挂在父文档下" "${PARENT_ID:-x}" "$(echo "$TREE" | jq -r '.data[]|select(.title=="区域")|.parent_id')"
chk "空白页未生成文档" "0" "$(echo "$TREE" | jq '[.data[]|select(.title=="空白页")]|length')"
chk "docx 导入为附件类型" "file" "$(echo "$TREE" | jq -r '.data[]|select(.title=="导入的Word文档")|.doc_type')"
chk "pdf 导入为附件类型" "file" "$(echo "$TREE" | jq -r '.data[]|select(.title=="导入的PDF文档")|.doc_type')"

echo "== 子表格内容校验 =="
SID=$(echo "$TREE" | jq -r '.data[]|select(.title=="产品")|.id')
SHEET=$(curl --noproxy '*' -s "$BASE/api/docs/$SID" "${H[@]}" | jq -r '.data.doc.content')
echo "  content: $SHEET"
# 表格存储契约已升到 v3（Luckysheet 原生多工作表 celldata），见 web/src/lib/sheet.ts 文件头
echo "$SHEET" | jq -e '.version==3 and (.sheets|length)>=1
  and ([.sheets[0].celldata[]|select(.r==0 and .c==0)|.v.v]|first)=="产品"
  and ([.sheets[0].celldata[]|select(.r==1 and .c==0)|.v.v]|first)=="苹果"
  and ([.sheets[0].celldata[]|select(.r==1 and .c==1)|.v.v]|first)==3' >/dev/null 2>&1 \
  && { echo "  ✅ 表格内容契约正确（v3：celldata 含表头与数据）"; pass=$((pass+1)); } \
  || { echo "  ❌ 表格内容契约异常"; fail=$((fail+1)); }

echo "== 附件阅读页抽查（docx） =="
DID=$(echo "$TREE" | jq -r '.data[]|select(.title=="导入的Word文档")|.id')
"$AB" open "$BASE/books/$BOOK?docId=$DID&tab=read" >/dev/null 2>&1
"$AB" wait 7000 >/dev/null 2>&1
echo "  含「下载原文件」: $("$AB" eval "document.body.innerText.includes('下载原文件')" 2>&1 | tail -1)"
echo "  docx 预览容器: $("$AB" eval "!!document.querySelector('.docx-preview')" 2>&1 | tail -1)"
echo "  预览文本: $("$AB" eval "(function(){var e=document.querySelector('.docx-preview');return e?e.innerText.replace(/\\s+/g,' ').slice(0,70):'(无)'})()" 2>&1 | tail -1)"
echo "  「编辑」按钮禁用: $("$AB" eval "(function(){var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return x.innerText.trim()==='编辑'});return b.length?b.some(function(x){return x.disabled}):'no-btn'})()" 2>&1 | tail -1)"
"$AB" screenshot "$OUT/02-docx原文件预览.png" >/dev/null 2>&1

echo "== 页面错误 =="
"$AB" errors 2>&1 | tail -6

echo "== 结果：通过 $pass 项，失败 $fail 项 =="
echo "输出目录：$OUT"
