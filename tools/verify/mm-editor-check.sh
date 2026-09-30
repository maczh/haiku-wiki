#!/usr/bin/env bash
# 思维导图编辑器改造验收：顶部样式组合（节点样式/基础样式/主题/优先级/进度/图标）
# + 右侧面板裁剪（只剩结构/大纲/设置）+ 优先级/图标/主题的落库持久化 + 阅读态高度自适应。
# 单源生产形态：用 build-embed.sh 产物 + e2e 夹具库。默认端口 8186。
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$HERE/../.."
export HOME=/home/macro TMPDIR=/home/macro/.workbuddy/tmp
export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export XDG_RUNTIME_DIR=/home/macro/.workbuddy/tmp/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars,--window-size=1560,900"
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"
AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser
BIN=/home/macro/.workbuddy/tmp/haiku-wiki
PORT=8186
BASE="http://127.0.0.1:$PORT"
PASS=0; FAIL=0

ok()  { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); echo "  ❌ $1 (want=$3 got=$2)"; fi }
jseval() { "$AB" eval "$1" 2>/dev/null | tr -d '"'; }

DATA=$(mktemp -d /home/macro/.workbuddy/tmp/mm-editor-check.XXXXXX)
cp -r tools/verify/fixtures/e2e-data/. "$DATA"/

cleanup() { "$AB" close >/dev/null 2>&1; fuser -k $PORT/tcp >/dev/null 2>&1; }
trap cleanup EXIT

PORT=$PORT DATA_DIR="$DATA" JWT_SECRET=mmcheck nohup "$BIN" >"$DATA/server.log" 2>&1 &
# 起服务 + 登录轮询放同一命令段
TOKEN=""
for i in $(seq 1 40); do
  TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token' 2>/dev/null)
  [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && [ "${#TOKEN}" -gt 20 ] && break
  sleep 0.5
done
if [ "${#TOKEN}" -le 20 ]; then echo "❌ 登录失败"; tail -5 "$DATA/server.log"; exit 1; fi

"$AB" open "$BASE/login" >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token','$TOKEN')" >/dev/null 2>&1
"$AB" open "$BASE/books/1?docId=3&tab=edit" >/dev/null 2>&1
"$AB" wait 4500 >/dev/null 2>&1

echo "== 1) 顶部样式组合 =="
ok "组合容器存在"   "$(jseval "!!document.querySelector('.hk-mm-style-combos')")" "true"
for t in 节点样式 基础样式 主题 优先级 进度 图标; do
  ok "顶部有「$t」" "$(jseval "(function(){var b=document.querySelector('.hk-mm-style-combos button[title=\"$t\"]');if(!b)return '0';var r=b.getBoundingClientRect();return r.width>10?'1':'0'})()")" "1"
done

echo "== 2) 右侧面板裁剪 =="
ok "右侧只剩 3 个入口" "$(jseval "String(document.querySelectorAll('.hk-mm-side-btn').length)")" "3"
ok "右侧无「主题」"    "$(jseval "(function(){var t='';document.querySelectorAll('.hk-mm-side-btn').forEach(function(b){t+=b.textContent});return t.indexOf('主题')>=0?'1':'0'})()")" "0"
ok "右侧无「基础样式」" "$(jseval "(function(){var t='';document.querySelectorAll('.hk-mm-side-btn').forEach(function(b){t+=b.textContent});return t.indexOf('基础')>=0?'1':'0'})()")" "0"

echo "== 3) 优先级落库 =="
"$AB" eval "document.querySelector('.hk-mm-style-combos button[title=\"优先级\"]').click()" >/dev/null 2>&1
"$AB" wait 500 >/dev/null 2>&1
ok "优先级面板打开(9 档)" "$(jseval "String(document.querySelectorAll('.mm-pop-panel .mm-prio-chip').length)")" "9"
"$AB" eval "(function(){var c=[].slice.call(document.querySelectorAll('.mm-pop-panel .mm-prio-chip'));var t=c.find(function(x){return x.textContent.trim()==='2'});if(!t)return 'no';t.click();return 'ok'})()" >/dev/null 2>&1
"$AB" wait 3800 >/dev/null 2>&1
CONTENT=$(curl --noproxy '*' -s "$BASE/api/docs/3" -H "Authorization: Bearer $TOKEN" | jq -r '.data.doc.content')
ok "落库含 priority=2"   "$(echo "$CONTENT" | jq -r '.root.data.priority' 2>/dev/null)" "2"

echo "== 4) 图标落库 =="
"$AB" eval "document.querySelector('.hk-mm-style-combos button[title=\"图标\"]').click()" >/dev/null 2>&1
"$AB" wait 500 >/dev/null 2>&1
"$AB" eval "document.querySelector('.mm-pop-panel .mm-icon-chip').click()" >/dev/null 2>&1
"$AB" wait 3800 >/dev/null 2>&1
CONTENT=$(curl --noproxy '*' -s "$BASE/api/docs/3" -H "Authorization: Bearer $TOKEN" | jq -r '.data.doc.content')
ok "落库含 icons[1 项]"  "$(echo "$CONTENT" | jq -r '.root.data.icons | length' 2>/dev/null)" "1"

echo "== 5) 主题切换落库 =="
# 先设一项基础样式覆盖（连线线型=虚线），后面用来验证「切主题不会把它抹掉」
"$AB" eval "(() => { const b=[...document.querySelectorAll('.hk-mm-style-combos .mm-tb-combo')].find(x=>x.textContent.includes('基础样式')); if(b){b.click();return 'ok';} return 'no'; })()" >/dev/null 2>&1
"$AB" wait 600 >/dev/null 2>&1
"$AB" eval "(() => {
  const lab=[...document.querySelectorAll('.mm-pop-label')].find(e=>e.textContent.trim()==='连线线型');
  const box=lab && lab.nextElementSibling;
  const b=box && [...box.querySelectorAll('.mm-shape-chip')].find(x=>x.textContent.trim()==='虚线');
  if(b){b.click();return 'ok';} return 'no';
})()" >/dev/null 2>&1
"$AB" wait 1200 >/dev/null 2>&1
"$AB" eval "document.querySelector('.hk-mm-style-combos button[title=\"主题\"]').click()" >/dev/null 2>&1
"$AB" wait 500 >/dev/null 2>&1
ok "主题面板含经典绿"    "$(jseval "(function(){var c=[].slice.call(document.querySelectorAll('.mm-pop-panel .mm-theme-card'));return c.some(function(x){return x.textContent.indexOf('经典绿')>=0})?'1':'0'})()")" "1"
"$AB" eval "(function(){var c=[].slice.call(document.querySelectorAll('.mm-pop-panel .mm-theme-card'));var t=c.find(function(x){return x.textContent.indexOf('经典绿')>=0});if(!t)return 'no';t.click();return 'ok'})()" >/dev/null 2>&1
"$AB" wait 3800 >/dev/null 2>&1
CONTENT=$(curl --noproxy '*' -s "$BASE/api/docs/3" -H "Authorization: Bearer $TOKEN" | jq -r '.data.doc.content')
ok "落库含 __canvasThemeId=classic-green" "$(echo "$CONTENT" | jq -r '.theme.__canvasThemeId' 2>/dev/null)" "classic-green"
# ⚠️ 主题切换**只换配色、不动基础样式**：__baseStyle 是用户手动设的全局覆盖，与主题（层配色
# 方案）正交，切主题不该把连线线型/箭头/边框线型抹掉。所以这里断言 base 仍在，而不是「已清零」。
ok "主题切换后 base 覆盖保留" "$(echo "$CONTENT" | jq -r 'if (.theme.__baseStyle|type)=="null" then "no" else "yes" end' 2>/dev/null)" "yes"
ok "切主题未抹掉已设的连线线型" "$(echo "$CONTENT" | jq -r '.theme.__baseStyle.linkPattern' 2>/dev/null)" "dashed"

echo "== 6) 刷新后回显 =="
"$AB" open "$BASE/books/1?docId=3&tab=edit" >/dev/null 2>&1
"$AB" wait 4500 >/dev/null 2>&1
ok "优先级徽标回显 2"    "$(jseval "(function(){var b=document.querySelector('.hk-mm-style-combos button[title=\"优先级\"] .mm-badge');return b?b.textContent.trim():'no'})()")" "2"
"$AB" eval "(function(){var b=document.querySelector('.hk-mm-style-combos button[title=\"主题\"]');if(!b)return 'no';b.click();return '1'})()" >/dev/null 2>&1
"$AB" wait 600 >/dev/null 2>&1
ok "主题卡高亮经典绿"    "$(jseval "(function(){var c=document.querySelector('.mm-pop-panel .mm-theme-card.is-on');return c?c.textContent.trim():'no'})()")" "经典绿"
"$AB" press Escape >/dev/null 2>&1

echo "== 7) 阅读态高度自适应 =="
"$AB" eval "window.scrollTo(0,0)" >/dev/null 2>&1
"$AB" open "$BASE/books/1?docId=3&tab=read" >/dev/null 2>&1
"$AB" wait 3500 >/dev/null 2>&1
# 期望高度 = clamp(视口 - top - 28, 320, 视口)
ok "阅读态画布高度自适应视口" "$(jseval "(function(){var w=document.querySelector('[data-h5-native-zoom=\"0\"]');if(!w||!w.parentElement)return 'na';var r=w.parentElement.getBoundingClientRect();var avail=window.innerHeight-r.top-28;var exp=Math.max(320,Math.min(avail,window.innerHeight));var d=r.height-exp;return Math.abs(d)<3?'1':'0|h='+Math.round(r.height)+',exp='+Math.round(exp)+',top='+Math.round(r.top)+',vh='+window.innerHeight})()")" "1"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
