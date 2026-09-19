#!/usr/bin/env bash
# 首页 Dashboard 端到端验证（单源生产形态：只跑 embed 后的 Go 二进制）。
#
# 覆盖：
#   ① 视频/封面静态资源真的随包分发（不是掉进 SPA 兜底）
#   ② 玩家能解码出正确时长（证明文件完整、不是占位）
#   ③ 新手向导与视频介绍都能关闭，且关闭状态被本地记住；欢迎条能重新打开
#   ④ 快捷操作、最近更新、书架三个区块都渲染出真实内容
#   ⑤ 最近更新点击能进阅读态；快捷入口能跳到导入链路
set -uo pipefail
export PATH=/usr/local/go/bin:/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro TMPDIR=/home/macro/.workbuddy/tmp
export XDG_RUNTIME_DIR=$TMPDIR/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars"
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR"
AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser
# 仓库内脚本/夹具的落点（不要把验证依赖留在 $TMPDIR —— 那个目录会被清理）
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PORT=${PORT:-8150}
BASE=http://127.0.0.1:$PORT
ROOT=$TMPDIR/e2e-dash-$(date +%s); SHOTS=$ROOT/shots; mkdir -p "$SHOTS"
DATA_DIR="$ROOT/data" PORT=$PORT JWT_SECRET=e2edash GIN_MODE=release "$TMPDIR/haiku-wiki" >"$ROOT/server.log" 2>&1 &
SPID=$!
cleanup() { "$AB" close >/dev/null 2>&1; kill $SPID 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT
for _ in $(seq 1 80); do c=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$BASE/" || true); [ "$c" = "200" ] && break; sleep 0.5; done

PASS=0; FAIL=0
ck() { # ck <描述> <期望> <实际>
  if [ "$2" = "$3" ]; then echo "  ✅ $1"; PASS=$((PASS+1));
  else echo "  ❌ $1  期望[$2] 实际[$3]"; FAIL=$((FAIL+1)); fi
}
ckc() { # ckc <描述> <子串> <全文>
  case "$3" in *"$2"*) echo "  ✅ $1"; PASS=$((PASS+1));;
    *) echo "  ❌ $1  未包含[$2] 实际[$3]"; FAIL=$((FAIL+1));; esac
}
q() { "$AB" eval "$1" 2>&1 | grep -v '^{}' | tail -1 | sed -e 's/^"//' -e 's/"$//'; }
shot() { "$AB" screenshot "$SHOTS/$1" >/dev/null 2>&1; echo "    📸 $1"; }
go() { "$AB" open "$1" >/dev/null 2>&1; "$AB" wait "$2" >/dev/null 2>&1; }

echo "== 0. 静态资源 =="
ck "就绪（HTTP）" "200" "$c"
H=$(curl -sI --noproxy '*' "$BASE/onboarding/haiku-wiki-guide.mp4")
ckc "视频 Content-Type" "video/mp4" "$H"
SIZE=$(curl -sI --noproxy '*' "$BASE/onboarding/haiku-wiki-guide.mp4" | tr -d '\r' | awk -F': ' '/[Cc]ontent-[Ll]ength/{print $2}')
ck "视频体积（字节）" "19784027" "$SIZE"
H2=$(curl -sI --noproxy '*' "$BASE/onboarding/haiku-wiki-guide-poster.jpg")
ckc "封面 Content-Type" "image/jpeg" "$H2"
# 视频前 4 字节必须是 MP4 的 ftyp box，否则说明返回的是 SPA 兜底的 HTML
MAGIC=$(curl -s --noproxy '*' -r 0-11 "$BASE/onboarding/haiku-wiki-guide.mp4" | tail -c 8 | cut -c1-4)
ck "MP4 box 魔数" "ftyp" "$MAGIC"

echo "== 1. 登录并进入首页 =="
# ⚠️ seed-demo.py 走**仓库内**的副本（原先写的是 $TMPDIR/seed-demo.py —— tmp 一清就挂）。
#    它只读 BASE / OUT 两个环境变量，没有硬编码路径。
BASE="$BASE" OUT="$ROOT/ids.json" python3 "$HERE/seed-demo.py" >/dev/null || exit 1
TOKEN=$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['token'])")
DEV=$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['books']['dev'])")
"$AB" set viewport 1600 900 >/dev/null 2>&1
go "$BASE/login" 2500
ck "登录页就绪" "/login" "$(q 'location.pathname')"
q "localStorage.setItem('hk_token','$TOKEN'); 'ok'" >/dev/null
go "$BASE/" 5500
ck "落在首页" "/" "$(q 'location.pathname')"

echo "== 2. 三大区块是否渲染出内容 =="
ck "新手向导存在" "true" "$(q "!!document.querySelector('[data-testid=hk-onboarding-guide]')")"
ck "步骤数=3" "3" "$(q "document.querySelectorAll('[data-testid=hk-onboarding-guide] .hk-dash-step').length")"
ck "视频卡片存在" "true" "$(q "!!document.querySelector('[data-testid=hk-intro-video]')")"
ck "章节数=6" "6" "$(q "document.querySelectorAll('.hk-dash-video-chapter').length")"
ck "快捷操作数=8" "8" "$(q "document.querySelectorAll('[data-testid=hk-quick-actions] .hk-dash-quick-item').length")"
echo "    最近更新条数=$(q "document.querySelectorAll('[data-testid=hk-recent-docs] [data-doc-id]').length")"
ck "最近更新有内容" "yes" "$(q "document.querySelectorAll('[data-testid=hk-recent-docs] [data-doc-id]').length>0?'yes':'no'")"
ck "书架卡片数=4（我的2+团队1+公司1）" "4" "$(q "document.querySelectorAll('[data-testid=hk-bookshelf] .ant-card').length")"
ck "团队速览有内容" "yes" "$(q "/加入团队/.test(document.body.innerText)?'no':'yes'")"
shot 30-dashboard-full.png

echo "== 3. 视频真的能解码（不是占位文件）=="
DUR=$(q "(()=>{const v=document.querySelector('[data-testid=hk-intro-player]');return v&&isFinite(v.duration)?Math.round(v.duration):-1})()")
ck "视频时长（秒）" "167" "$DUR"
ck "封面已挂载" "yes" "$(q "(()=>{const v=document.querySelector('[data-testid=hk-intro-player]');return v&&v.getAttribute('poster')?'yes':'no'})()")"
ck "标题含时长说明" "yes" "$(q "/约 3 分钟/.test(document.body.innerText)?'yes':'no'")"
shot 31-dashboard-video.png

echo "== 4. 关闭向导与视频（并验证本地记忆）=="
q "document.querySelector('[data-testid=hk-onboarding-close]').click(); 'ok'" >/dev/null
q "document.querySelector('[data-testid=hk-intro-dismiss]').click(); 'ok'" >/dev/null
"$AB" wait 900 >/dev/null 2>&1
ck "向导已收起" "false" "$(q "!!document.querySelector('[data-testid=hk-onboarding-guide]')")"
ck "视频已收起" "false" "$(q "!!document.querySelector('[data-testid=hk-intro-video]')")"
ckc "记忆键（向导）" "hk_onboard_dismissed" "$(q "Object.keys(localStorage).sort().join(',')")"
ckc "记忆键（视频）" "hk_intro_video_dismissed" "$(q "Object.keys(localStorage).sort().join(',')")"
shot 32-dashboard-dismissed.png

go "$BASE/" 5000   # 重新进入：关闭状态必须仍是关闭
ck "刷新后向导仍关闭" "false" "$(q "!!document.querySelector('[data-testid=hk-onboarding-guide]')")"
ck "刷新后视频仍关闭" "false" "$(q "!!document.querySelector('[data-testid=hk-intro-video]')")"

echo "== 5. 欢迎条可以重新打开 =="
q "document.querySelector('[data-testid=hk-toggle-onboard]').click(); 'ok'" >/dev/null
"$AB" wait 700 >/dev/null 2>&1
ck "向导重新出现" "true" "$(q "!!document.querySelector('[data-testid=hk-onboarding-guide]')")"
q "(()=>{const b=document.querySelector('[data-testid=hk-toggle-intro]');if(!b)return 'no-btn';b.click();return 'ok'})()" >/dev/null
"$AB" wait 700 >/dev/null 2>&1
ck "视频重新出现" "true" "$(q "!!document.querySelector('[data-testid=hk-intro-video]')")"
ck "两个「不再提示」键已清空" "" "$(q "Object.keys(localStorage).filter(k=>k.indexOf('_dismissed')>0).join(',')")"

echo "== 6. 最近更新点击进阅读态 =="
FIRST=$(q "(()=>{const e=document.querySelector('[data-testid=hk-recent-docs] [data-doc-id]');return e?e.getAttribute('data-doc-id'):''})()")
echo "    首条 docId=$FIRST"
q "document.querySelector('[data-testid=hk-recent-docs] [data-doc-id]').click(); 'ok'" >/dev/null
"$AB" wait 4000 >/dev/null 2>&1
ckc "URL 命中阅读态" "tab=read" "$(q 'location.pathname + location.search')"
ckc "URL 带 docId" "docId=$FIRST" "$(q 'location.pathname + location.search')"
ck "正文已渲染" "yes" "$(q "document.querySelector('.doc-content')&&document.querySelector('.doc-content').innerText.length>30?'yes':'no'")"
shot 33-recent-open.png

echo "== 7. 快捷操作可达 =="
go "$BASE/" 5000
q "document.querySelector('[data-testid=hk-quick-createdoc]').click(); 'ok'" >/dev/null
"$AB" wait 1500 >/dev/null 2>&1
ckc "新建文档弹窗标题" "新建文档" "$(q "(document.querySelector('.ant-modal-title')||{}).textContent||'无'")"
ck "弹窗有 3 个下拉（库/目录/类型）" "3" "$(q "document.querySelectorAll('.ant-modal .ant-select-selector').length")"
# 目录下拉默认落在「根目录（知识库顶层）」而不是裸数字 0（历史 bug），且必须显示名称
ckc "目录下拉显示根目录名称" "根目录（知识库顶层）" "$(q "([...document.querySelectorAll('.ant-modal .ant-select-selection-item')].map(e=>e.textContent).join('|'))")"
ck "目录下拉不是禁用态（已预选知识库）" "false" "$(q "document.querySelectorAll('.ant-modal .ant-select-disabled').length>0?'true':'false'")"
q "document.querySelector('.ant-modal-close').click(); 'ok'" >/dev/null
"$AB" wait 800 >/dev/null 2>&1

go "$BASE/" 5000
q "document.querySelector('[data-testid=hk-quick-importfile]').click(); 'ok'" >/dev/null
"$AB" wait 1600 >/dev/null 2>&1
ckc "导入先弹出选库弹窗" "选择目标知识库" "$(q "(document.querySelector('.ant-modal-title')||{}).textContent||'无'")"
q "(()=>{const b=[...document.querySelectorAll('.ant-modal-footer button')].find(x=>x.textContent.indexOf('下一步')>=0);if(!b)return 'no-btn';b.click();return 'ok'})()" >/dev/null
"$AB" wait 4000 >/dev/null 2>&1
ckc "导入跳转到知识库页" "/books/" "$(q 'location.pathname')"
ck "导入参数已被消费（不再残留）" "-1" "$(q "location.search.indexOf('import')")"
# 文件导入用的是 Drawer（标题「导入文档」），网页导入才是 Modal，别搞混
ckc "文件导入抽屉已打开" "导入文档" "$(q "(document.querySelector('.ant-drawer-title')||{}).textContent||'无'")"
ck "抽屉拖拽区已渲染" "yes" "$(q "!!document.querySelector('.ant-drawer .ant-upload-drag')?'yes':'no'")"
shot 34-quick-import.png
q "(()=>{const c=document.querySelector('.ant-drawer-close');if(c){c.click();return 'ok'}return 'none'})()" >/dev/null
"$AB" wait 900 >/dev/null 2>&1

go "$BASE/" 5000
q "document.querySelector('[data-testid=hk-quick-importurl]').click(); 'ok'" >/dev/null
"$AB" wait 1600 >/dev/null 2>&1
q "(()=>{const b=[...document.querySelectorAll('.ant-modal-footer button')].find(x=>x.textContent.indexOf('下一步')>=0);if(!b)return 'no-btn';b.click();return 'ok'})()" >/dev/null
"$AB" wait 3500 >/dev/null 2>&1
ckc "网页导入弹窗已打开" "导入" "$(q "(document.querySelector('.ant-modal-title')||{}).textContent||'无'")"
shot 35-quick-import-url.png

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
echo "SHOTS_DIR=$SHOTS"
[ "$FAIL" = "0" ] && echo "E2E_DASHBOARD_OK" || echo "E2E_DASHBOARD_FAILED"
