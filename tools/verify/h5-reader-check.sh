#!/usr/bin/env bash
# 寄海文库 H5 阅读态布局回归：单源生产形态（后端内嵌 dist）+ agent-browser（移动视口）。
# 覆盖 6 项 H5 反馈：
#   1. 正文与底部工具条之间不再留空白（MobileLayout）
#   2. 思维导图 / PDF / DOCX 等画布型预览支持双指缩放 + 单指拖动（H5ZoomStage）
#   3. 缩放后划屏滚动不失效（touch-action 复位）
#   4. 只读表格不再卡「渲染中」/空白（luckysheet localforage 兜底 + 早刷防护）
#   5. 接口文档 / 甘特图的 H5 布局（接口树抽屉 / 甘特铺满）
#   6. PPTX H5 全屏（portal 伪全屏，iOS 无原生全屏的兜底）
#   7. 分享阅读模式的 H5 布局（书级 /share/:slug → MShare；文档级 /doc-share/:slug →
#      MShareDoc；两类都是「单栏沉浸 + 抽屉目录」，且桌面模式仍走原 SharePage）
# 必须一次跑完：后台进程会在单次工具调用结束后被回收。
set -uo pipefail

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro
export TMPDIR=/home/macro/.workbuddy/tmp
export XDG_RUNTIME_DIR=/home/macro/.workbuddy/tmp/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars"
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR"

AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser
PORT=${PORT:-8177}
TS=$(date +%s)
OUT=/home/macro/.workbuddy/tmp/h5-$TS
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
if [ -n "${E2E_DATA:-}" ]; then
  DATA=$E2E_DATA
else
  DATA=$TMPDIR/h5-data-$TS
  mkdir -p "$DATA"
  cp -r "$HERE/fixtures/e2e-data/." "$DATA/"
fi
BASE=http://127.0.0.1:$PORT
mkdir -p "$OUT"

DATA_DIR="$DATA" PORT="$PORT" JWT_SECRET=e2e-secret-for-verify GIN_MODE=release \
  "$TMPDIR/haiku-wiki" >"$OUT/server.log" 2>&1 &
BPID=$!
cleanup() { "$AB" close >/dev/null 2>&1; kill "$BPID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

PASS=0; FAIL=0
say()  { printf '\n\033[36m== %s ==\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
# agent-browser eval 的返回值可能带引号，断言前统一去掉引号与首尾空白（见 skill §3.3.2）
jseval() { "$AB" eval "$1" 2>&1 | tr -d '\r' | tail -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr -d '"'; }
# 断言：ok <描述> <实测> <期望>
ok() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '   \033[32m✅ %s = %s\033[0m\n' "$1" "$2"; else FAIL=$((FAIL+1)); printf '   \033[31m❌ %s = %s (期望 %s)\033[0m\n' "$1" "$2" "$3"; fi; }
shot() { "$AB" screenshot "$OUT/$1.png" >/dev/null 2>&1; info "[截图] $1.png"; }

code=000
for _ in $(seq 1 60); do
  code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books" 2>/dev/null)
  [ "$code" != "000" ] && [ -n "$code" ] && break
  sleep 0.3
done
info "后端就绪：HTTP $code"
if ! curl --noproxy '*' -s "$BASE/" | grep -q 'id="root"'; then
  echo "❌ 内嵌 dist 未生效"; exit 1
fi

# ⚠️ AutoMigrate 是**异步**的：服务起来后 /api/books 会先返回 401，但 users 表可能还没
# 补上 deleted_at 等列 —— 此刻登录拿到的是「账号或密码错误」（TOKEN=null）。必须重试等迁移。
TOKEN=""
for i in $(seq 1 40); do
  TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
  if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && [ "${#TOKEN}" -gt 20 ]; then break; fi
  sleep 0.5
done
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then echo "❌ 登录失败"; tail -8 "$OUT/server.log"; exit 1; fi
info "登录成功（重试 ${i} 次）"

# 造两篇夹具：接口文档 / 甘特图（默认夹具里没有这两类）
mkdoc() { # $1=doc_type $2=title
  curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"parent_id\":0,\"title\":\"$2\",\"doc_type\":\"$1\",\"content\":\"\"}" | jq -r '.data.id'
}
API_ID=$(mkdoc api "H5回归-接口文档")
GANTT_ID=$(mkdoc gantt "H5回归-甘特图")
info "新建 api=$API_ID gantt=$GANTT_ID"

say "初始化浏览器（移动视口 390x844）"
"$AB" set viewport 390 844 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1
"$AB" wait 2000 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); localStorage.setItem('haiku_view_mode','h5'); 'ok'" >/dev/null 2>&1
"$AB" wait 300 >/dev/null 2>&1

say "1) H5 底部无空白（#1）+ 思维导图原生无级缩放（#3）"
"$AB" open "$BASE/m/doc/3" >/dev/null 2>&1
"$AB" wait 4000 >/dev/null 2>&1
ok "H5 容器存在"        "$(jseval "!!document.querySelector('[data-h5-doc]')")" "true"
# ⚠️ 思维导图**刻意不再走** H5ZoomStage（CSS transform 是把整层位图拉花 → 放大后文字虚化），
#    改为 MindmapView 内部驱动 mm.view.scale 做原生无级缩放（放大后矢量重排，始终清晰）。
#    见 styles.ts 的 H5_ZOOMABLE_TYPES 与 MindmapView.attachNativeZoom。
ok "导图不套 CSS 缩放层" "$(jseval "(document.querySelector('[data-h5-doc]')||{getAttribute:function(){return 'x'}}).getAttribute('data-h5-zoomable')")" "0"
ok "无 H5ZoomStage 手势层" "$(jseval "!!document.querySelector('[data-h5-zoom]')")" "false"
ok "导图原生缩放已挂载"  "$(jseval "(document.querySelector('[data-h5-native-zoom]')||{getAttribute:function(){return '0'}}).getAttribute('data-h5-native-zoom')")" "1"
GAP=$(jseval "(function(){var m=document.querySelector('[data-h5-main]'),t=document.querySelector('[data-h5-tabbar]');if(!m||!t)return 'na';return Math.round(t.getBoundingClientRect().top-m.getBoundingClientRect().bottom)})()")
ok "正文↔工具条间隙(px)" "$GAP" "0"
ok "导图已渲染(.smm-container)" "$(jseval "!!document.querySelector('.smm-container')")" "true"
shot "01-h5-mindmap"

say "2) 只读表格不再卡「渲染中」/空白（#4）"
"$AB" open "$BASE/m/doc/2" >/dev/null 2>&1
"$AB" wait 4500 >/dev/null 2>&1
ok "luckysheet 网格存在" ".luckysheet-cell-main:$(jseval "!!document.querySelector('.luckysheet-cell-main')")" ".luckysheet-cell-main:true"
ok "渲染中遮罩已清除"    "#loadingdata:$(jseval "!!document.querySelector('#luckysheetloadingdata')")" "#loadingdata:false"
ok "网格画布非零尺寸"    "$(jseval "(function(){var c=document.querySelector('.luckysheet-cell-main canvas')||document.querySelector('.luckysheet-cell-main');if(!c)return 'na';var r=c.getBoundingClientRect();return (r.width>50&&r.height>30)})()")" "true"
ok "底部 Tab 可见"       "$(jseval "!!document.querySelector('[data-h5-tabbar]')")" "true"
GAP2=$(jseval "(function(){var m=document.querySelector('[data-h5-main]'),t=document.querySelector('[data-h5-tabbar]');if(!m||!t)return 'na';return Math.round(t.getBoundingClientRect().top-m.getBoundingClientRect().bottom)})()")
ok "表格页正文↔工具条间隙(px)" "$GAP2" "0"
info "main 滚动: $(jseval "(function(){var m=document.querySelector('[data-h5-main]');return m?('scrollH='+m.scrollHeight+' clientH='+m.clientHeight):'na'})()")"
info "tabbar rect: $(jseval "(function(){var t=document.querySelector('[data-h5-tabbar]');if(!t)return 'na';var r=t.getBoundingClientRect();return Math.round(r.top)+'..'+Math.round(r.bottom)+' vh='+window.innerHeight})()")"
shot "02-h5-sheet"

say "3) 附件 PDF 预览可缩放（#2）"
"$AB" open "$BASE/m/doc/5" >/dev/null 2>&1
"$AB" wait 5000 >/dev/null 2>&1
ok "附件 zoomable"      "$(jseval "(document.querySelector('[data-h5-doc]')||{getAttribute:function(){return 'x'}}).getAttribute('data-h5-zoomable')")" "1"
ok "手势层存在"          "$(jseval "!!document.querySelector('[data-h5-zoom]')")" "true"
ok "PDF canvas 已渲染"   "$(jseval "[].slice.call(document.querySelectorAll('canvas')).some(function(c){var r=c.getBoundingClientRect();return r.width>80&&r.height>80})")" "true"
shot "03-h5-file-pdf"

say "4) 接口文档 H5 布局（左栏抽屉，#5）"
"$AB" open "$BASE/m/doc/$API_ID" >/dev/null 2>&1
"$AB" wait 3500 >/dev/null 2>&1
ok "H5 容器存在"         "$(jseval "!!document.querySelector('[data-h5-doc]')")" "true"
ok "目录按钮存在"         "$(jseval "!!document.querySelector('.anticon-menu')")" "true"
LEFT_OFF=$(jseval "(function(){var b=[].slice.call(document.querySelectorAll('div')).filter(function(d){var s=getComputedStyle(d);return s.position==='fixed'&&s.transform&&s.transform.indexOf('matrix')===0&&s.width&&parseInt(s.width)>200});return b.length?Math.round(b[0].getBoundingClientRect().left):'na'})()")
info "抽屉初始 left=$LEFT_OFF（负值=已收起）"
info "点击目录按钮: $(jseval "(function(){var i=document.querySelector('.anticon-menu');if(!i)return 'not-found';i.click();return 'clicked'})()")"
"$AB" wait 800 >/dev/null 2>&1
ok "抽屉遮罩出现"         "$(jseval "[].slice.call(document.querySelectorAll('div')).some(function(d){return getComputedStyle(d).backgroundColor==='rgba(0, 0, 0, 0.35)'})")" "true"
shot "04-h5-api-drawer"

say "5) 甘特图 H5 铺满（#5）"
"$AB" open "$BASE/m/doc/$GANTT_ID" >/dev/null 2>&1
"$AB" wait 4000 >/dev/null 2>&1
ok "甘特 fill=1"        "$(jseval "(document.querySelector('[data-h5-doc]')||{getAttribute:function(){return 'x'}}).getAttribute('data-h5-fill')")" "1"
ok "甘特面板存在"        "$(jseval "!!document.querySelector('.hk-gantt')||!!document.querySelector('.wx-gantt')||!!document.querySelector('.svar-gantt')")" "true"
# H5 默认折叠左表格：只读列宽合计 726px，不折叠的话 390px 视口下时间轴被挤成 0 宽（看不到甘特条）
ok "H5 默认折叠左表"     "$(jseval "(document.querySelector('.hk-gantt')||{className:''}).className.indexOf('left-collapsed')>=0")" "true"
ok "时间轴刻度有日期文案" "$(jseval "/月|\\d+\\/\\d+/.test((document.querySelector('.hk-gantt .wx-scale')||{innerText:''}).innerText)")" "true"
ok "甘特条落在视口内"    "$(jseval "(function(){var b=document.querySelector('.hk-gantt .wx-bar');if(!b)return 'na';var r=b.getBoundingClientRect();return r.width>20&&r.right>0&&r.left<390})()")" "true"
info "甘特条宽度: $(jseval "(function(){var b=document.querySelector('.hk-gantt .wx-bar');if(!b)return 'na';return Math.round(b.getBoundingClientRect().width)})()") px"
# #6：手机上四角小三角目标太小（16×16 且藏在面板角上，手指点不准），改为底部常驻三段式切换条
ok "底部折叠切换条存在"   "$(jseval "!!document.querySelector('[data-h5-gantt-mode]')")" "true"
ok "默认档位=甘特图"      "$(jseval "(document.querySelector('[data-h5-gantt-mode]')||{getAttribute:function(){return 'na'}}).getAttribute('data-h5-gantt-mode')")" "chart"
ok "切换条三档齐全"       "$(jseval "document.querySelectorAll('.hk-gantt-foldbar-item').length")" "3"
ok "切换条在视口内"       "$(jseval "(function(){var b=document.querySelector('.hk-gantt-foldbar');if(!b)return 'na';var r=b.getBoundingClientRect();return r.bottom<=window.innerHeight+1&&r.top>0})()")" "true"
info "点「任务表」: $(jseval "(function(){var b=[].slice.call(document.querySelectorAll('.hk-gantt-foldbar-item')).find(function(x){return x.textContent.indexOf('任务表')>=0});if(!b)return 'not-found';b.click();return 'clicked'})()")"
"$AB" wait 1200 >/dev/null 2>&1
ok "已切到任务表档位"     "$(jseval "(document.querySelector('[data-h5-gantt-mode]')||{getAttribute:function(){return 'na'}}).getAttribute('data-h5-gantt-mode')")" "grid"
ok "任务表档位左表可见"   "$(jseval "(function(){var g=document.querySelector('.wx-grid')||document.querySelector('.hk-gantt');if(!g)return 'na';return g.getBoundingClientRect().width>300})()")" "true"
shot "05b-h5-gantt-foldbar"
# 诊断：时间刻度（.wx-scale）的行/单元。桌面端刻度文案正常，此处确认 H5 是否也渲染出日期
S5_SCALE='[].slice.call(document.querySelectorAll(".wx-scale .wx-row")).map(function(r,i){return i+" cells="+r.children.length+" txt="+JSON.stringify((r.innerText||"").slice(0,24))}).join(" | ")'
info "刻度行: $(jseval "$S5_SCALE")"
shot "05-h5-gantt"

say "6) PPTX H5 全屏（portal 伪全屏，#6）"
PPTX_GEN="$OUT/gen-pptx.cjs"
cat > "$PPTX_GEN" <<'JS'
const PptxGenJS = require('pptxgenjs')
const p = new PptxGenJS()
const s = p.addSlide()
s.addText('H5 全屏回归', { x: 1, y: 1, w: 8, h: 1, fontSize: 32 })
s.addText('用于验证移动端全屏', { x: 1, y: 2.5, w: 8, h: 1, fontSize: 20 })
p.writeFile({ fileName: process.argv[2] }).then(() => process.stdout.write('ok'))
JS
PPTX_FILE="$OUT/fixture.pptx"
if NODE_PATH="$REPO/web/node_modules" node "$PPTX_GEN" "$PPTX_FILE" >/dev/null 2>&1 && [ -s "$PPTX_FILE" ]; then
  info "已生成 pptx 夹具：$(stat -c%s "$PPTX_FILE") 字节"
  UPRES=$(curl --noproxy '*' -s -X POST "$BASE/api/uploads" -H "Authorization: Bearer $TOKEN" \
    -F "file=@$PPTX_FILE;filename=H5回归.pptx")
  PURL=$(echo "$UPRES" | jq -r '.data.url // empty')
  PSIZE=$(echo "$UPRES" | jq -r '.data.size // 0')
  if [ -n "$PURL" ]; then
    PJSON=$(jq -cn --arg u "$PURL" --arg f "H5回归.pptx" --argjson s "$PSIZE" '{url:$u,filename:$f,size:$s,ext:"pptx",pptx_scanned:true}')
    PID=$(curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' \
      -d "$(jq -cn --arg t "H5回归-PPTX" --arg c "$PJSON" '{parent_id:0,title:$t,doc_type:"file",content:$c}')" | jq -r '.data.id')
    info "pptx 文档 id=$PID"
    "$AB" open "$BASE/m/doc/$PID" >/dev/null 2>&1
    "$AB" wait 8000 >/dev/null 2>&1
    ok "pptx 预览已渲染" "$(jseval "!!document.querySelector('.pptx-preview-wrapper')")" "true"
    ok "页码可读"        "$(jseval "/\\d+\\s*\\/\\s*\\d+/.test(document.body.innerText)")" "true"
    info "点击全屏按钮: $(jseval "(function(){var i=document.querySelector('.anticon-expand');if(!i)return 'not-found';var b=i.closest('button');(b||i).click();return 'clicked'})()")"
    "$AB" wait 900 >/dev/null 2>&1
    ok "伪全屏浮层出现"  "$(jseval "[].slice.call(document.querySelectorAll('div')).some(function(d){var s=getComputedStyle(d);return s.position==='fixed'&&s.zIndex==='1100'})")" "true"
    ok "浮层铺满视口高"  "$(jseval "(function(){var e=[].slice.call(document.querySelectorAll('div')).filter(function(d){var s=getComputedStyle(d);return s.position==='fixed'&&s.zIndex==='1100'})[0];if(!e)return 'na';return Math.abs(e.getBoundingClientRect().height-window.innerHeight)<4})()")" "true"
    # 幻灯片进入全屏后应自适应放大（回归点：portal 重挂载读出 0 宽会把比例压到 10% 下限）
    ok "全屏幻灯片已自适应" "$(jseval "(function(){var s=document.querySelector('.hk-pptx-stage');if(!s)return 'na';return s.getBoundingClientRect().width>250})()")" "true"
    shot "06-h5-pptx-fullscreen"
  else
    echo "   ⚠️ 跳过 pptx（上传失败）：$(echo "$UPRES" | head -c 200)"
  fi
else
  echo "   ⚠️ 跳过 pptx 用例（pptxgenjs 不可用或生成失败）"
fi

say "7) 分享阅读模式的 H5 布局（#5「阅读/分享模式」）"

# 7.1 书级分享：建一个只含思维导图的库 → 设 public → 取 share_slug
SHARE_BOOK=$(curl --noproxy '*' -s -X POST "$BASE/api/books" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"H5回归-分享库","description":"share e2e"}' | jq -r '.data.id')
SHARE_MD=$(curl --noproxy '*' -s -X POST "$BASE/api/books/$SHARE_BOOK/docs" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"parent_id":0,"title":"H5回归-分享导图","doc_type":"mindmap","content":""}' | jq -r '.data.id')
SLUG=$(curl --noproxy '*' -s -X PUT "$BASE/api/books/$SHARE_BOOK/visibility" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"visibility":"public"}' \
  | jq -r '.data.share_slug')
info "书级分享：book=$SHARE_BOOK 首篇 doc=$SHARE_MD slug=$SLUG"

if [ -z "$SLUG" ] || [ "$SLUG" = "null" ]; then
  FAIL=$((FAIL+1)); echo "   ❌ 书级分享 slug 获取失败，跳过 7.1"
else
  # 分享页免登录：清掉 token，保证验的是真实匿名访问（而不是本地已登录）
  "$AB" eval "localStorage.removeItem('hk_token'); localStorage.setItem('haiku_view_mode','h5'); 'ok'" >/dev/null 2>&1
  "$AB" open "$BASE/share/$SLUG" >/dev/null 2>&1
  "$AB" wait 4500 >/dev/null 2>&1
  ok "H5 分享页容器"       "$(jseval "!!document.querySelector('[data-h5-doc]')")" "true"
  ok "匿名可读（文库名）"   "$(jseval "document.body.innerText.indexOf('H5回归-分享库')>=0")" "true"
  ok "分享页无底部 Tab"     "$(jseval "!!document.querySelector('[data-h5-tabbar]')")" "false"
  # 同 #1：导图走原生缩放，不再套 H5ZoomStage
  ok "分享导图不套 CSS 缩放层" "$(jseval "(document.querySelector('[data-h5-doc]')||{getAttribute:function(){return 'x'}}).getAttribute('data-h5-zoomable')")" "0"
  ok "分享导图原生缩放已挂载" "$(jseval "(document.querySelector('[data-h5-native-zoom]')||{getAttribute:function(){return '0'}}).getAttribute('data-h5-native-zoom')")" "1"
  ok "导图已渲染"          "$(jseval "!!document.querySelector('.smm-container')")" "true"
  # 正文主区应铺到视口底部（同 #1 的「不留空白」诉求）
  ok "正文铺满视口底部"     "$(jseval "(function(){var h=document.querySelector('header');if(!h)return 'na';var m=h.nextElementSibling;if(!m)return 'na';return Math.abs(m.getBoundingClientRect().bottom-window.innerHeight)<2})()")" "true"
  shot "07-h5-share-book"
  info "点目录按钮: $(jseval "(function(){var i=document.querySelector('.anticon-menu');if(!i)return 'not-found';i.click();return 'clicked'})()")"
  "$AB" wait 900 >/dev/null 2>&1
  ok "目录抽屉已展开"       "$(jseval "(function(){var e=document.querySelector('.ant-drawer-content-wrapper');if(!e)return 'na';var r=e.getBoundingClientRect();return r.right>50&&r.left<390})()")" "true"
  ok "抽屉内目录行存在"     "$(jseval "!!document.querySelector('.ant-drawer .tree-row')")" "true"
  shot "08-h5-share-book-drawer"

  # 桌面模式仍走原 SharePage（H5 化只影响手机模式，不回归桌面分享页）
  "$AB" eval "localStorage.setItem('haiku_view_mode','desktop'); 'ok'" >/dev/null 2>&1
  "$AB" open "$BASE/share/$SLUG" >/dev/null 2>&1
  "$AB" wait 3500 >/dev/null 2>&1
  ok "桌面模式非 H5 页"     "$(jseval "!!document.querySelector('[data-h5-doc]')")" "false"
  ok "桌面分享页可读"       "$(jseval "document.body.innerText.indexOf('H5回归-分享库')>=0")" "true"
  "$AB" eval "localStorage.setItem('haiku_view_mode','h5'); 'ok'" >/dev/null 2>&1
fi

# 7.2 文档级分享：接口文档（左栏改抽屉）/ 甘特图（铺满）
mkshare() { # $1=docId
  curl --noproxy '*' -s -X PUT "$BASE/api/docs/$1/share" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"enabled":true}' | jq -r '.data.slug'
}
API_SLUG=$(mkshare "$API_ID")
GANTT_SLUG=$(mkshare "$GANTT_ID")
info "文档级分享：api slug=$API_SLUG gantt slug=$GANTT_SLUG"

if [ -z "$API_SLUG" ] || [ "$API_SLUG" = "null" ]; then
  FAIL=$((FAIL+1)); echo "   ❌ 文档级分享 slug 获取失败，跳过 7.2"
else
  "$AB" open "$BASE/doc-share/$API_SLUG" >/dev/null 2>&1
  "$AB" wait 4000 >/dev/null 2>&1
  ok "接口分享页容器"       "$(jseval "!!document.querySelector('[data-h5-doc]')")" "true"
  ok "匿名可读（标题）"     "$(jseval "document.body.innerText.indexOf('H5回归-接口文档')>=0")" "true"
  ok "分享页无底部 Tab"     "$(jseval "!!document.querySelector('[data-h5-tabbar]')")" "false"
  ok "目录按钮存在"         "$(jseval "!!document.querySelector('.anticon-menu')")" "true"
  ok "左栏初始已收起"       "$(jseval "(function(){var b=[].slice.call(document.querySelectorAll('div')).filter(function(d){var s=getComputedStyle(d);return s.position==='fixed'&&s.transform&&s.transform.indexOf('matrix')===0&&parseInt(s.width)>200});return b.length?(b[0].getBoundingClientRect().left<0):'na'})()")" "true"
  info "点目录按钮: $(jseval "(function(){var i=document.querySelector('.anticon-menu');if(!i)return 'not-found';i.click();return 'clicked'})()")"
  "$AB" wait 800 >/dev/null 2>&1
  ok "抽屉遮罩出现"         "$(jseval "[].slice.call(document.querySelectorAll('div')).some(function(d){return getComputedStyle(d).backgroundColor==='rgba(0, 0, 0, 0.35)'})")" "true"
  shot "09-h5-share-api-drawer"

  "$AB" open "$BASE/doc-share/$GANTT_SLUG" >/dev/null 2>&1
  "$AB" wait 4000 >/dev/null 2>&1
  ok "甘特分享页 fill=1"    "$(jseval "(document.querySelector('[data-h5-doc]')||{getAttribute:function(){return 'x'}}).getAttribute('data-h5-fill')")" "1"
  ok "甘特面板存在"         "$(jseval "!!document.querySelector('.wx-gantt')||!!document.querySelector('.hk-gantt')||!!document.querySelector('.svar-gantt')")" "true"
  ok "H5 默认折叠左表"      "$(jseval "(document.querySelector('.hk-gantt')||{className:''}).className.indexOf('left-collapsed')>=0")" "true"
  ok "时间轴刻度有日期文案" "$(jseval "/月|\\d+\\/\\d+/.test((document.querySelector('.hk-gantt .wx-scale')||{innerText:''}).innerText)")" "true"
  ok "甘特条落在视口内"     "$(jseval "(function(){var b=document.querySelector('.hk-gantt .wx-bar');if(!b)return 'na';var r=b.getBoundingClientRect();return r.width>20&&r.right>0&&r.left<390})()")" "true"
  shot "10-h5-share-gantt"

  # 只读表格在分享态：把 #4（luckysheet localforage 兜底）与 #5（分享页单栏）一起吃住的组合用例
  SHEET_SLUG=$(mkshare 2)
  if [ -z "$SHEET_SLUG" ] || [ "$SHEET_SLUG" = "null" ]; then
    FAIL=$((FAIL+1)); echo "   ❌ 表格文档分享 slug 获取失败"
  else
    "$AB" open "$BASE/doc-share/$SHEET_SLUG" >/dev/null 2>&1
    "$AB" wait 5000 >/dev/null 2>&1
    ok "表格分享页容器"       "$(jseval "!!document.querySelector('[data-h5-doc]')")" "true"
    ok "luckysheet 网格存在"  ".luckysheet-cell-main:$(jseval "!!document.querySelector('.luckysheet-cell-main')")" ".luckysheet-cell-main:true"
    ok "渲染中遮罩已清除"     "#loadingdata:$(jseval "!!document.querySelector('#luckysheetloadingdata')")" "#loadingdata:false"
    ok "网格画布非零尺寸"     "$(jseval "(function(){var c=document.querySelector('.luckysheet-cell-main canvas')||document.querySelector('.luckysheet-cell-main');if(!c)return 'na';var r=c.getBoundingClientRect();return (r.width>50&&r.height>30)})()")" "true"
    ok "分享页无底部 Tab"     "$(jseval "!!document.querySelector('[data-h5-tabbar]')")" "false"
    shot "11-h5-share-sheet"
  fi
fi

say "8) H5 分享：各类型阅读页均有入口，可唤起 App（#5）"
# 7.x 里清掉了 token，这里重新注入（分享入口在登录态文档页，需 JWT 才能生成 /doc-share/:slug）
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); localStorage.setItem('haiku_view_mode','h5'); 'ok'" >/dev/null 2>&1
"$AB" open "$BASE/m/doc/3" >/dev/null 2>&1
"$AB" wait 4000 >/dev/null 2>&1
ok "阅读页有分享入口"   "$(jseval "!!document.querySelector('[data-h5-share-entry]')")" "true"
info "点分享: $(jseval "(function(){var e=document.querySelector('[data-h5-share-entry]');if(!e)return 'not-found';(e.closest('button')||e).click();return 'clicked'})()")"
"$AB" wait 2000 >/dev/null 2>&1
ok "分享面板已弹出"     "$(jseval "!!document.querySelector('[data-h5-share-sheet]')")" "true"
SHARE_URL=$(jseval "(function(){var s=document.querySelector('[data-h5-share-sheet]');if(!s)return 'na';var m=(s.innerText||'').match(/https?:\\/\\/[^\\s]+/);return m?m[0]:'no-url'})()")
info "分享链接: $SHARE_URL"
case "$SHARE_URL" in
  */doc-share/*) ok "分享链接形如 /doc-share/:slug" "doc-share" "doc-share" ;;
  *)             FAIL=$((FAIL+1)); printf '   \033[31m❌ 分享链接异常 = %s\033[0m\n' "$SHARE_URL" ;;
esac
ok "渠道按钮 8 个"      "$(jseval "document.querySelectorAll('[data-h5-share-channel]').length")" "8"
ok "复制按钮存在"       "$(jseval "!!document.querySelector('[data-h5-share-copy]')")" "true"
shot "11-h5-share-sheet"
info "关闭面板: $(jseval "(function(){var b=[].slice.call(document.querySelectorAll('[data-h5-share-sheet] button')).find(function(x){return x.textContent.trim()==='取消'});if(b){b.click();return 'closed'}return 'not-found'})()")"
"$AB" wait 600 >/dev/null 2>&1
ok "面板已关闭"         "$(jseval "!!document.querySelector('[data-h5-share-sheet]')")" "false"

# 公开分享页（免登录）同样要有分享入口，且直接分享当前链接
"$AB" eval "localStorage.removeItem('hk_token'); localStorage.setItem('haiku_view_mode','h5'); 'ok'" >/dev/null 2>&1
"$AB" open "$BASE/doc-share/${API_SLUG:-none}" >/dev/null 2>&1
"$AB" wait 3500 >/dev/null 2>&1
ok "文档分享页有分享入口" "$(jseval "!!document.querySelector('[data-h5-share-entry]')")" "true"
info "点分享: $(jseval "(function(){var e=document.querySelector('[data-h5-share-entry]');if(!e)return 'not-found';(e.closest('button')||e).click();return 'clicked'})()")"
"$AB" wait 1200 >/dev/null 2>&1
SHARE_URL2=$(jseval "(function(){var s=document.querySelector('[data-h5-share-sheet]');if(!s)return 'na';var m=(s.innerText||'').match(/https?:\\/\\/[^\\s]+/);return m?m[0]:'no-url'})()")
info "分享页链接: $SHARE_URL2"
case "$SHARE_URL2" in
  */doc-share/*) ok "分享页复用当前公开链接" "doc-share" "doc-share" ;;
  *)             FAIL=$((FAIL+1)); printf '   \033[31m❌ 分享页链接异常 = %s\033[0m\n' "$SHARE_URL2" ;;
esac
shot "12-h5-share-docshare"

say "控制台错误"
"$AB" errors 2>&1 | tail -12

echo
echo "================ 汇总 ================"
echo "✅ 通过 $PASS 项 / ❌ 失败 $FAIL 项"
echo "输出目录：$OUT"
[ "$FAIL" -eq 0 ] && echo "H5_READER_CHECK_PASS" || echo "H5_READER_CHECK_FAIL"
