#!/usr/bin/env bash
# 白板文档（Excalidraw）端到端回归：模板/API 导出 + 浏览器编辑器/阅读态
#
# 覆盖（2026-09-22 新增 whiteboard 文档类型）：
#   1. API：登录 → whiteboard 模板 ≥20 → 创建白板文档 → 保存场景+SVG 预览 →
#      formats 清单（excalidraw/svg/png/pdf）→ 导出 .excalidraw（官方壳）/.svg →
#      png 服务端拒绝并指引浏览器 → 书 zip 含 .excalidraw → 正文含 SVG
#   2. 浏览器：编辑器 .excalidraw 挂载（顶部工具条/素材库/清除画布）→
#      阅读态渲染 SVG 预览 → 模板中心出现白板模板
#
# 已知陷阱：
#   · 书 zip 里是**中文文件名**，`unzip -l` 渲染成空白 → 必须 python zipfile 校验；
#   · Excalidraw 组件**必须显式 import '@excalidraw/excalidraw/index.css'**，
#     缺了样式 .excalidraw 根没有 height:100%，画布 offsetHeight 会撑到 2^25px
#     （探针断言 .excalidraw offsetHeight < 父容器 + display:flex 可盯住回归）；
#   · 服务端 PNG 导出按设计返回 400 + 浏览器指引文案（PNG/PDF 由前端生成）。
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro
export TMPDIR=/home/macro/.workbuddy/tmp
export XDG_RUNTIME_DIR=$TMPDIR/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars,--window-size=1600,1000"
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR"

AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser
BIN=$TMPDIR/haiku-wiki
PORT=${PORT:-8109}
BASE=http://127.0.0.1:$PORT
OUT=$TMPDIR/whiteboard-out-$(date +%s); mkdir -p "$OUT"
DATA=$TMPDIR/whiteboard-data-$(date +%s); mkdir -p "$DATA"

[ -x "$BIN" ] || { echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi
cp -r "$HERE/fixtures/e2e-data/." "$DATA/"

PORT=$PORT DATA_DIR="$DATA" JWT_SECRET=whiteboard GIN_MODE=release "$BIN" >"$OUT/server.log" 2>&1 &
SPID=$!
cleanup(){ "$AB" close >/dev/null 2>&1; kill $SPID 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$BASE/api/books" 2>/dev/null); [ "$c" = "401" ] && break; sleep 0.5
done
echo "服务就绪: ${c:-timeout}"

pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ✓ $1"; }
bad() { fail=$((fail+1)); echo "  ✗ $1"; }
J() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
AUTH_JSON='Content-Type: application/json'

# ---------- API ----------
TOKEN=$(curl -s --noproxy '*' -X POST "$BASE/api/auth/login" -H "$AUTH_JSON" \
  -d '{"account":"e2e@example.com","password":"secret123"}' | J "d['data']['token']")
[ -n "$TOKEN" ] && ok "登录" || bad "登录"
AUTH="Authorization: Bearer $TOKEN"

N=$(curl -s --noproxy '*' "$BASE/api/templates?doc_type=whiteboard" -H "$AUTH" | J "len(d['data'])")
[ "$N" -ge 20 ] && ok "内置白板模板 ≥20（$N）" || bad "内置白板模板不足（$N）"

DOC=$(curl -s --noproxy '*' -X POST "$BASE/api/books/1/docs" -H "$AUTH" -H "$AUTH_JSON" \
  -d '{"title":"冒烟白板","doc_type":"whiteboard"}')
DOCID=$(echo "$DOC" | J "d['data']['id']")
DT=$(echo "$DOC" | J "d['data']['doc_type']")
[ "$DT" = "whiteboard" ] && ok "创建 whiteboard 文档 id=$DOCID" || bad "创建文档类型=$DT"

# 保存场景 + SVG 预览（前端保存契约：content 为 {version,elements,appState,files,svg}）
read -r -d '' CONTENT <<'EOF'
{"version":1,"elements":[{"id":"a1","type":"rectangle","x":80,"y":80,"width":160,"height":70,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"#a5d8ff","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":1,"isDeleted":false,"boundElements":null,"updated":1,"link":null,"locked":false},{"id":"a2","type":"text","x":110,"y":100,"width":100,"height":31,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"roundness":null,"seed":2,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":1,"link":null,"locked":false,"text":"冒烟测试白板","fontSize":20,"fontFamily":1,"textAlign":"center","verticalAlign":"top","containerId":null,"originalText":"冒烟测试白板","lineHeight":1.25,"autoResize":true}],"appState":{"viewBackgroundColor":"#ffffff"},"files":{},"svg":"<svg xmlns='http://www.w3.org/2000/svg' width='320' height='220'><rect x='80' y='80' width='160' height='70' rx='8' fill='#a5d8ff' stroke='#1971c2'/><text x='120' y='120' font-size='18'>冒烟测试白板</text></svg>"}
EOF
python3 -c "import json,sys;print(json.dumps({'content': sys.argv[1], 'source': 'manual'}, ensure_ascii=False))" "$CONTENT" > "$OUT/content.json"
curl -s --noproxy '*' -X PATCH "$BASE/api/docs/$DOCID" -H "$AUTH" -H "$AUTH_JSON" \
  -d @"$OUT/content.json" | J "d['data']['changed']" | grep -q True && ok "保存白板正文+SVG 预览" || bad "保存正文"

FMT=$(curl -s --noproxy '*' "$BASE/api/export/docs/$DOCID/formats" -H "$AUTH")
echo "$FMT" | J "','.join(f['value'] for f in d['data']['formats'])" | grep -q excalidraw && ok "formats 含 excalidraw/svg/png/pdf" || bad "formats 清单缺失"

# 导出 .excalidraw：应为官方壳（type=excalidraw, version=2, elements 还原）
curl -s --noproxy '*' "$BASE/api/export/docs/$DOCID?format=excalidraw" -H "$AUTH" -o "$OUT/out.excalidraw"
python3 -c "
import json,sys
d=json.load(open('$OUT/out.excalidraw'))
assert d.get('type')=='excalidraw' and d.get('version')==2 and len(d['elements'])==2, d" \
  && ok "导出 .excalidraw（官方壳）" || bad "导出 .excalidraw"

# 导出 .svg：应等于保存的预览
curl -s --noproxy '*' "$BASE/api/export/docs/$DOCID?format=svg" -H "$AUTH" -o "$OUT/out.svg"
head -c 4 "$OUT/out.svg" | grep -q '<svg' && ok "导出 .svg（保存时生成的预览）" || bad "导出 .svg"

# png 服务端按设计拒绝并指引浏览器
PNG=$(curl -s --noproxy '*' "$BASE/api/export/docs/$DOCID?format=png" -H "$AUTH")
echo "$PNG" | grep -q '浏览器' && ok "png 服务端拒绝并指引浏览器" || bad "png 行为异常: $PNG"

# 导出书 zip 应包含 .excalidraw（中文文件名，unzip -l 渲染不出 → python 校验）
curl -s --noproxy '*' -o "$OUT/book.zip" "$BASE/api/export/books/1" -H "$AUTH"
python3 -c "
import zipfile,sys
names = zipfile.ZipFile('$OUT/book.zip').namelist()
assert any(n.endswith('.excalidraw') for n in names), names" \
  && ok "书导出 zip 含 .excalidraw" || bad "书 zip 缺 .excalidraw"

# 正文接口应含 SVG 预览
curl -s --noproxy '*' "$BASE/api/docs/$DOCID" -H "$AUTH" | J "'svg' in d['data']['doc']['content']" | grep -q True \
  && ok "正文含 SVG 预览" || bad "正文缺 SVG"

# ---------- 浏览器 ----------
"$AB" open "$BASE/login" >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', '$TOKEN')" >/dev/null 2>&1
"$AB" open "$BASE/books/1?docId=$DOCID&tab=edit" >/dev/null 2>&1
"$AB" wait 9000 >/dev/null 2>&1

# 编辑器挂载 + 样式加载探针：.excalidraw 必须 display:flex 且高度不超过父容器
# （缺 index.css 时 display 会退回 block、offsetHeight 撑到 2^25px —— 见脚本头注释）
R=$("$AB" eval "
(function(){
  var e=document.querySelector('.excalidraw'); if(!e) return 'no-editor';
  var cs=getComputedStyle(e), h=e.offsetHeight, ph=e.parentElement.offsetHeight;
  if(cs.display!=='flex') return 'css-missing';
  if(h>ph+40) return 'canvas-overflow:'+h+'>'+ph;
  return 'editor:'+e.offsetWidth+'x'+h;
})()" 2>/dev/null | tr -d '"')
echo "  编辑器探针: $R"
case "$R" in editor:*) ok "Excalidraw 编辑器已挂载（含样式）" ;; *) bad "编辑器异常: $R" ;; esac
"$AB" screenshot "$OUT/edit.png" >/dev/null 2>&1

# 阅读态：SVG 预览渲染（不加载 Excalidraw 本体）
"$AB" open "$BASE/books/1?docId=$DOCID&tab=read" >/dev/null 2>&1
"$AB" wait 6000 >/dev/null 2>&1
R2=$("$AB" eval "(function(){var w=document.querySelector('.hk-drawio-svg svg');return w? 'svg:'+w.getBoundingClientRect().width.toFixed(0) : 'no-svg'})()" 2>/dev/null | tr -d '"')
case "$R2" in svg:*) ok "阅读态渲染 SVG 预览" ;; *) bad "阅读态未渲染 SVG: $R2" ;; esac
"$AB" screenshot "$OUT/read.png" >/dev/null 2>&1

# 模板中心：白板模板分类可见
"$AB" open "$BASE/templates" >/dev/null 2>&1
"$AB" wait 6000 >/dev/null 2>&1
R3=$("$AB" eval "(function(){return document.body.innerText.indexOf('白板模板')>=0?'cat-ok':'no-cat'})()" 2>/dev/null | tr -d '"')
[ "$R3" = "cat-ok" ] && ok "模板中心出现白板模板分类" || bad "模板中心缺白板分类"

# ---------- 导入 .excalidraw 文件（浏览器实走导入抽屉） ----------
printf '%s' '{"type":"excalidraw","version":2,"source":"https://excalidraw.com","elements":[{"id":"r1","type":"rectangle","x":100,"y":100,"width":180,"height":80,"angle":0,"strokeColor":"#e03131","backgroundColor":"#ffc9c9","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":1,"isDeleted":false,"boundElements":null,"updated":1,"link":null,"locked":false}],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}' > "$OUT/sample.excalidraw"
WB_BEFORE=$(curl -s --noproxy '*' "$BASE/api/books/1/docs" -H "$AUTH" | J "len([d for d in d['data'] if d.get('doc_type')=='whiteboard'])")
"$AB" open "$BASE/books/1" >/dev/null 2>&1
"$AB" wait 6000 >/dev/null 2>&1
"$AB" eval "(function(){var b=[].slice.call(document.querySelectorAll('button'));var x=b.find(function(v){return v.textContent.indexOf('导入')>=0});if(x){x.click();return 'ok'}return 'no-btn'})()" >/dev/null 2>&1
"$AB" wait 1500 >/dev/null 2>&1
# 导入有两层 Modal（选择方式→确定 / 选择位置→下一步），逐层推进直到抽屉出现
IMP=bad
for _ in 1 2 3 4; do
  HAS=$("$AB" eval "(function(){return document.querySelector('.ant-drawer input[type=file]')?'yes':'no'})()" 2>/dev/null | tr -d '"')
  if [ "$HAS" = "yes" ]; then
    "$AB" upload ".ant-drawer input[type=file]" "$OUT/sample.excalidraw" >/dev/null 2>&1
    "$AB" wait 5000 >/dev/null 2>&1
    IMP=ok
    break
  fi
  "$AB" eval "
(function(){
  var wraps=[].slice.call(document.querySelectorAll('.ant-modal-wrap'));
  var vis=wraps.filter(function(w){return w.offsetParent!==null && w.querySelector('.ant-modal')});
  var btns=[].slice.call((vis[vis.length-1]||document).querySelectorAll('.ant-modal .ant-btn'));
  var act=btns.find(function(b){var t=b.textContent.replace(/\s/g,'');return t==='下一步'||t==='确定'});
  if(act){act.click();return 'ok'}
  return 'no-btn'
})()" >/dev/null 2>&1
  "$AB" wait 1500 >/dev/null 2>&1
done
WB_AFTER=$(curl -s --noproxy '*' "$BASE/api/books/1/docs" -H "$AUTH" | J "len([d for d in d['data'] if d.get('doc_type')=='whiteboard'])")
if [ "$IMP" = "ok" ] && [ "$WB_AFTER" = "$((WB_BEFORE + 1))" ]; then
  # 正文应已剥壳（version=1 wrapper，无 type:excalidraw 壳）；列表接口不带正文，走详情
  NEWID=$(curl -s --noproxy '*' "$BASE/api/books/1/docs" -H "$AUTH" | python3 -c "
import sys, json
wb = [d for d in json.load(sys.stdin)['data'] if d.get('doc_type')=='whiteboard']
print(wb[-1]['id'])")
  curl -s --noproxy '*' "$BASE/api/docs/$NEWID" -H "$AUTH" | python3 -c "
import sys, json
c = json.loads(json.load(sys.stdin)['data']['doc']['content'])
assert c.get('version') == 1 and isinstance(c.get('elements'), list) and 'type' not in c, c" \
    && ok "导入 .excalidraw 创建白板文档（正文已剥壳）" || bad "导入正文结构异常"
else
  bad "导入 .excalidraw 未创建文档（before=$WB_BEFORE after=$WB_AFTER imp=$IMP）"
fi

echo "== PASS=$pass FAIL=$fail"
[ "$fail" = "0" ]
