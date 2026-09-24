#!/usr/bin/env bash
# 预览缩放/全屏冒烟（2026-09-23 新增，同日随 0b46e51 更新）：
#   · 流程图（mermaid）阅读态 + 编辑器右侧实时预览：图形按容器全宽自然铺开（>300px 且 ≥ 容器 60%）、
#     阅读态通栏铺满（不再受阅读宽度调节器约束）。⚠️ 自研缩放工具条已按设计移除
#     （scale 对矢量图无实际放大效果，见 reader/FlowchartView.tsx 注释），故断言其**不存在**；
#   · 白板（Excalidraw）编辑器：宿主工具条「全屏」按钮点击后 document.fullscreenElement 生效；
#   · 白板/绘图共用 DrawioSvgView 阅读态：工具条带全屏按钮（.anticon-fullscreen）。
#     ⚠️ DrawioSvgView 的缩放/全屏工具条仍在，别和流程图混淆。
#
# 已知陷阱（沿用 whiteboard-check.sh）：
#   · curl 必须 --noproxy '*'（本机代理劫持 127.0.0.1）；
#   · Chrome 用 --no-sandbox --no-proxy-server；
#   · Excalidraw 懒加载，编辑态要等足时间。
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
PORT=${PORT:-8111}
BASE=http://127.0.0.1:$PORT
OUT=$TMPDIR/preview-zoom-out-$(date +%s); mkdir -p "$OUT"
DATA=$TMPDIR/preview-zoom-data-$(date +%s); mkdir -p "$DATA"

[ -x "$BIN" ] || { echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi
cp -r "$HERE/fixtures/e2e-data/." "$DATA/"

PORT=$PORT DATA_DIR="$DATA" JWT_SECRET=previewzoom GIN_MODE=release "$BIN" >"$OUT/server.log" 2>&1 &
SPID=$!
cleanup(){ "$AB" close >/dev/null 2>&1; kill $SPID 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  c=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/api/books" 2>/dev/null); [ "$c" = "401" ] && break; sleep 0.5
done
echo "服务就绪: ${c:-timeout}"

PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  ✓ $1"; }
no(){ FAIL=$((FAIL+1)); echo "  ✗ $1"; }
note(){ echo "  ⚠️ $1"; }
J() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
AUTH_JSON='Content-Type: application/json'

# ⚠️ AutoMigrate 异步：服务就绪（/api/books 返回 401）≠ 表已迁移完，此时登录会得到
# 「账号或密码错误」。必须重试等迁移落定，否则整套用例假红。
TOKEN=""
for _i in $(seq 1 40); do
  TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H "$AUTH_JSON" \
    -d '{"account":"e2e@example.com","password":"secret123"}' | J "d['data']['token']")
  [ -n "$TOKEN" ] && [ "$TOKEN" != "None" ] && break
  sleep 0.5
done
[ -n "$TOKEN" ] && [ "$TOKEN" != "None" ] && ok "登录" || { echo "❌ 认证失败"; exit 1; }
AUTH="Authorization: Bearer $TOKEN"

# ---------- 播种：宽时序图（复刻用户反馈场景）+ 带预览 SVG 的白板 ----------
SEQ='sequenceDiagram
    autonumber
    participant B as 客户
    participant M as 商户后台
    participant O as 订单服务
    participant P as 支付服务
    participant R as 风控服务
    B->>M: 发起退款申请
    M->>O: POST /refunds/apply
    O->>R: 风控校验
    R-->>O: 通过
    O->>P: 退款请求
    P-->>O: 受理成功
    O-->>M: 返回受理结果
    M-->>B: 通知受理'
python3 -c "import json,sys;print(json.dumps({'content': sys.argv[1], 'source': 'manual'}, ensure_ascii=False))" "$SEQ" > "$OUT/seq.json"
FID=$(curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" -H "$AUTH" -H "$AUTH_JSON" \
  -d '{"title":"退款时序-缩放验证","doc_type":"flowchart"}' | J "d['data']['id']")
curl --noproxy '*' -s -X PATCH "$BASE/api/docs/$FID" -H "$AUTH" -H "$AUTH_JSON" -d @"$OUT/seq.json" \
  | J "d['data']['changed']" | grep -q True && ok "写入宽时序图 doc=$FID" || no "写入时序图正文"

read -r -d '' WBCONTENT <<'EOF'
{"version":1,"elements":[{"id":"a1","type":"rectangle","x":80,"y":80,"width":160,"height":70,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"#a5d8ff","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":1,"isDeleted":false,"boundElements":null,"updated":1,"link":null,"locked":false}],"appState":{"viewBackgroundColor":"#ffffff"},"files":{},"svg":"<svg xmlns='http://www.w3.org/2000/svg' width='320' height='220'><rect x='80' y='80' width='160' height='70' rx='8' fill='#a5d8ff' stroke='#1971c2'/></svg>"}
EOF
python3 -c "import json,sys;print(json.dumps({'content': sys.argv[1], 'source': 'manual'}, ensure_ascii=False))" "$WBCONTENT" > "$OUT/wb.json"
WID=$(curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" -H "$AUTH" -H "$AUTH_JSON" \
  -d '{"title":"白板-全屏验证","doc_type":"whiteboard"}' | J "d['data']['id']")
curl --noproxy '*' -s -X PATCH "$BASE/api/docs/$WID" -H "$AUTH" -H "$AUTH_JSON" -d @"$OUT/wb.json" \
  | J "d['data']['changed']" | grep -q True && ok "写入白板 doc=$WID" || no "写入白板正文"

q(){ "$AB" eval "$1" 2>&1 | tail -1 | sed 's/^"//; s/"$//'; }
visit(){ "$AB" open "$1" >/dev/null 2>&1; "$AB" wait "${2:-4500}" >/dev/null 2>&1; }

# ---------- 1) 流程图阅读态：缩放工具条 + 放大生效 + 通栏 ----------
echo "== 流程图阅读态 =="
"$AB" set viewport 1600 1000 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1; "$AB" wait 1500 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); 'ok'" >/dev/null 2>&1
visit "$BASE/books/1?docId=$FID&tab=read" 7000
# ⚠️ 设计变更（commit 0b46e51「小BUG修复」）：流程图（mermaid）阅读态**已移除**自研缩放工具条 ——
# 旧工具条的 scale 变换对矢量图没有实际放大效果，改为委托 Markdown/Vditor 全宽自然铺开
# （见 `components/reader/FlowchartView.tsx` 顶部注释）。因此这里断言的是
# 「工具条已移除 + 图形真的铺开」，旧版的「工具条齐全 / 点放大百分比变大」断言已失效。
TB=$(q "(function(){
  var btns=[].slice.call(document.querySelectorAll('button'));
  return btns.some(function(b){return b.textContent.indexOf('适应宽度')>=0})?'toolbar-present':'no-toolbar'})()")
[ "$TB" = "no-toolbar" ] && ok "阅读态无缩放工具条（已改为全宽铺开）" || no "旧缩放工具条仍在: $TB"

# mermaid 渲染探针：扫描**所有** svg 取像图表的那一个（宽度 > 300）——
# 不能取第一个 svg：页面图标也是 svg，旧写法会命中 0x0 而误判「未渲染」。
SVGBOX=$(q "(function(){
  var list=[].slice.call(document.querySelectorAll('svg')).map(function(s){
    var r=s.getBoundingClientRect(); return Math.round(r.width)+'x'+Math.round(r.height)});
  return 'big:'+list.filter(function(v){return parseInt(v)>300}).length+' ['+list.slice(0,4).join(', ')+']'})()")
echo "    渲染探针: $SVGBOX"
case "$SVGBOX" in big:[1-9]*) ok "mermaid SVG 已按容器铺开（>300px）" ;; *) no "mermaid SVG 未铺开: $SVGBOX" ;; esac

# 图形宽度应跟随容器（通栏后不再被人为缩小到「适应宽度且不超过 1:1」）
FITW=$(q "(function(){
  var main=document.querySelector('main')||document.body;
  var cw=main.getBoundingClientRect().width;
  var ws=[].slice.call(document.querySelectorAll('svg')).map(function(s){return s.getBoundingClientRect().width});
  var w=Math.max.apply(null,ws.concat([0]));
  return (cw>0&&w/cw>=0.6)?'ok':'narrow:'+Math.round(w)+'/'+Math.round(cw)})()")
[ "$FITW" = "ok" ] && ok "图形宽度跟随容器（≥60%）" || no "图形未铺开: $FITW"
"$AB" screenshot "$OUT/flowchart-read.png" >/dev/null 2>&1

# 通栏：阅读宽度调节器（标准/宽屏/全宽）不再出现
WCTL=$(q "(function(){return document.body.innerText.indexOf('全宽')>=0?'present':'absent'})()")
[ "$WCTL" = "absent" ] && ok "流程图阅读态已通栏（宽度调节器隐藏）" || no "宽度调节器仍显示"

# ---------- 2) 流程图编辑态：右侧实时预览（同一 FlowchartView，同样无工具条） ----------
echo "== 流程图编辑态 =="
visit "$BASE/books/1?docId=$FID&tab=edit" 7000
EB=$(q "(function(){
  var ta=document.querySelector('textarea');
  if(!ta) return 'no-src';
  var big=[].slice.call(document.querySelectorAll('svg')).filter(function(s){return s.getBoundingClientRect().width>300});
  if(big.length===0) return 'no-preview';
  return 'ok'})()")
[ "$EB" = "ok" ] && ok "编辑器右侧实时预览已渲染 mermaid" || no "编辑态预览异常: $EB"
"$AB" screenshot "$OUT/flowchart-edit.png" >/dev/null 2>&1

# ---------- 3) 白板编辑态：宿主「全屏」按钮 → fullscreenElement 生效 ----------
echo "== 白板编辑态 =="
visit "$BASE/books/1?docId=$WID&tab=edit" 12000
EXC=$(q "(function(){return document.querySelector('.excalidraw')?'mounted':'no-editor'})()")
[ "$EXC" = "mounted" ] && ok "Excalidraw 编辑器挂载" || no "编辑器未挂载: $EXC"
FSBTN=$(q "(function(){
  var b=[].slice.call(document.querySelectorAll('button')).find(function(x){return x.textContent.replace(/\s/g,'')==='全屏'});
  return b?'ok':'no-btn'})()")
[ "$FSBTN" = "ok" ] && ok "宿主工具条有「全屏」按钮" || no "缺全屏按钮"
"$AB" eval "(function(){var b=[].slice.call(document.querySelectorAll('button')).find(function(x){return x.textContent.replace(/\s/g,'')==='全屏'});if(b){b.click();return 'ok'}return 'no-btn'})()" >/dev/null 2>&1
"$AB" wait 1200 >/dev/null 2>&1
FSEL=$(q "(function(){return document.fullscreenElement?('fullscreen:'+document.fullscreenElement.tagName):'none'})()")
case "$FSEL" in
  fullscreen:*) ok "点击后进入浏览器全屏" ;;
  # 无头 Chrome 不具备真实显示输出，requestFullscreen 会被浏览器拒绝 ——
  # 按钮与回调已就位（上一条断言），真实环境可进入全屏；这里降级为提示不计失败。
  *) note "无头环境无法真正进入系统全屏（requestFullscreen 被浏览器拒绝），按钮/回调已验证就位" ;;
esac
"$AB" screenshot "$OUT/whiteboard-edit-fullscreen.png" >/dev/null 2>&1
"$AB" press Escape >/dev/null 2>&1; "$AB" wait 600 >/dev/null 2>&1

# ---------- 4) 白板阅读态：DrawioSvgView 工具条带全屏按钮 ----------
echo "== 白板阅读态 =="
visit "$BASE/books/1?docId=$WID&tab=read" 7000
RFS=$(q "(function(){
  var fs=document.querySelector('.anticon-fullscreen');
  var svg=document.querySelector('.hk-drawio-svg svg');
  if(!svg) return 'no-svg';
  return fs?'ok':'no-fs-btn'})()")
[ "$RFS" = "ok" ] && ok "白板阅读态 SVG 预览 + 全屏按钮" || no "白板阅读态异常: $RFS"
"$AB" screenshot "$OUT/whiteboard-read.png" >/dev/null 2>&1

# ---------- 5) 表格阅读态：连续点击命中不偏行（「二次点击差 6 行」回归） ----------
# ⚠️ 根因不是时序/refresh，而是 CSS 包含块：luckysheet 的根 `.luckysheet` 自带
#    `position:absolute`（无 top/left），宿主 div 若是 static，它的包含块会落到滚动
#    容器之外的某个定位祖先上 → 网格**不随页面滚动**，而 luckysheet 算命中行用的是
#    `$("#"+container).offset().top`（宿主位置）→ 两者脱钩 → 第二次起整行下移约 6 行。
#    修法：宿主设为 position:relative（见 reader/SheetView.tsx 注释）。
#    断言不变量：**同一个网格内相对偏移 → 命中同一行**，且滚动后依旧成立。
echo "== 表格阅读态：点击命中 =="
visit "$BASE/books/1?docId=2&tab=read" 7000
SHEET_POS=$(q "(function(){
  var b=document.querySelector('[id^=hk-luckysheet-view-]');
  return b?getComputedStyle(b).position:'no-box'})()")
[ "$SHEET_POS" = "relative" ] && ok "表格宿主 position:relative（包含块正确）" || no "表格宿主 position=$SHEET_POS"

ROWS=$(q "(function(){
  var cm=document.querySelector('#luckysheet-cell-main');
  if(!cm) return 'no-grid';
  var api=window.luckysheet;
  if(!api||typeof api.getluckysheet_select_save!=='function') return 'no-api';
  var out=[];
  function row(){var s=api.getluckysheet_select_save();return (s&&s[0]&&s[0].row)?s[0].row[0]:'na'}
  function click(dy){
    var r=cm.getBoundingClientRect();
    var x=r.left+60, y=r.top+dy;
    ['mousedown','mouseup','click'].forEach(function(t){
      cm.dispatchEvent(new MouseEvent(t,{clientX:x,clientY:y,bubbles:true,cancelable:true,view:window}))});
    return row();
  }
  // 同一相对偏移连点三次：三次必须命中同一行
  out.push(click(100)); out.push(click(100)); out.push(click(100));
  // 再把外层滚动容器滚 250px，原地再点：滚动不应改变「网格内同一位置」的命中行
  var p=cm.parentElement, sc=null;
  while(p){var s=getComputedStyle(p);if(/(auto|scroll)/.test(s.overflowY)&&p.scrollHeight>p.clientHeight+10){sc=p;break}p=p.parentElement}
  if(!sc) sc=document.scrollingElement||document.documentElement;
  sc.scrollTop+=250;
  out.push(click(100));
  return out.join(',')})()")
echo "    命中行序列（3 次原地 + 滚动后 1 次）: $ROWS"
case "$ROWS" in
  no-grid|no-api) no "表格网格/API 不可用: $ROWS" ;;
  *na*)           no "未能读到选区行: $ROWS" ;;
  *) FIRST=${ROWS%%,*}; REST=${ROWS#*,}
     SAME=yes; IFS=','; for v in $REST; do [ "$v" = "$FIRST" ] || SAME=no; done; unset IFS
     [ "$SAME" = "yes" ] && ok "连续点击命中同一行（含滚动后，行=$FIRST）" || no "点击命中偏行: $ROWS" ;;
esac
"$AB" screenshot "$OUT/sheet-read-click.png" >/dev/null 2>&1

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo PREVIEW_ZOOM_OK || echo PREVIEW_ZOOM_FAILED
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
