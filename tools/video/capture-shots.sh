#!/usr/bin/env bash
# 采集《寄海文库 · 新手操作演示》视频所需的全部界面截图。
#
# 用法：
#   BIN=/path/to/haiku-wiki bash capture-shots.sh <输出目录>
#
# 前置：BIN 必须是「前端已 embed」的生产形态二进制（见 web/package.json 与 Dockerfile），
#      界面在 dev server 与生产形态下表现一致，但本项目所有验证都走生产形态，
#      以免把「只在 embed 下复现」的问题漏掉。
#
# ── 本脚本踩过的三个坑（改之前先读）─────────────────────────────────────────────
# ① 文档树是懒加载的：知识库节点没展开时，页面里**根本没有文档节点**。
#    而且要**逐个展开 + 逐个等**——一次性 forEach 点击所有 `.ant-tree-switcher_close`
#    会因为 React 重渲染让数组里的元素失联，把刚展开的节点又切回去。
# ② 文档右键菜单（分享/导出）挂在内层 span 上：
#    `docMenu()` 返回 `<Dropdown trigger={['contextMenu']}>` 包裹的 `<span>`，
#    React 的 onContextMenu 在这个 span 上。事件是**向上**冒泡的，
#    所以把 contextmenu 派发到祖先 `.ant-tree-node-content-wrapper` 永远不命中，
#    必须派发到 `.ant-tree-title span`。
# ③ data-testid 的生成规则是 `hk-quick-${key.replace(/^on/,'').toLowerCase()}`
#    → onCreateDoc 对应的是 `hk-quick-createdoc`，不是 `hk-quick-oncreatedoc`。
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
SHOTS=${1:?用法: BIN=<二进制> bash capture-shots.sh <输出目录>}
BIN=${BIN:?请用 BIN=<二进制路径> 指定已 embed 前端的可执行文件}
PORT=${PORT:-8171}
BASE=http://127.0.0.1:$PORT

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=${HOME:-/home/macro} TMPDIR=${TMPDIR:-/tmp}
export XDG_RUNTIME_DIR=$TMPDIR/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=${AGENT_BROWSER_EXECUTABLE_PATH:-/opt/google/chrome/chrome}
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars"
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR" "$SHOTS"
AB=${AB:-/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser}

ROOT=$(mktemp -d "$TMPDIR/video-shots-XXXXXX")
DATA_DIR="$ROOT/data" PORT=$PORT JWT_SECRET=shots GIN_MODE=release "$BIN" >"$ROOT/server.log" 2>&1 &
SPID=$!
cleanup() { "$AB" close >/dev/null 2>&1; kill $SPID 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT
for _ in $(seq 1 80); do c=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$BASE/" || true); [ "$c" = "200" ] && break; sleep 0.5; done
[ "$c" = "200" ] || { echo "服务未就绪，日志：$ROOT/server.log"; exit 1; }

q() { "$AB" eval "$1" 2>&1 | grep -v '^{}' | tail -1 | sed -e 's/^"//' -e 's/"$//'; }
shot() { "$AB" screenshot "$SHOTS/$1" >/dev/null 2>&1; echo "  📸 $1"; }
go() { "$AB" open "$1" >/dev/null 2>&1; "$AB" wait "$2" >/dev/null 2>&1; }
st() { "$AB" "$@" >/dev/null 2>&1; }

# 演示数据（用户 李海 / 王工 + 3 个知识库 + 9 篇文档 + 团队 + 协作者 + 分享）
BASE="$BASE" OUT="$ROOT/ids.json" python3 "$(dirname "$0")/seed-demo.py" || exit 1
IDS="$ROOT/ids.json"
json() { python3 -c "import json;d=json.load(open('$IDS'));print($1)"; }
TOKEN=$(json "d['token']")
DEV=$(json "d['books']['dev']")
MKT=$(json "d['books']['mkt']")
MD=$(json "d['docs']['markdown']['id']")

"$AB" set viewport 1600 900 >/dev/null 2>&1
go "$BASE/login" 2500
shot 01-login.png
q "localStorage.setItem('hk_token','$TOKEN'); 'ok'" >/dev/null

echo "── 首页 ──"
go "$BASE/" 5500
shot 02-dashboard-hero.png
q "(()=>{const c=[...document.querySelectorAll('div')].find(d=>d.scrollHeight>d.clientHeight+200);if(c)c.scrollTop=700;else window.scrollTo(0,700);return 'ok'})()" >/dev/null
st wait 800
shot 23-dashboard-books.png
q "(()=>{const c=[...document.querySelectorAll('div')].find(d=>d.scrollHeight>d.clientHeight+200);if(c)c.scrollTop=0;return 'ok'})()" >/dev/null
st wait 600
q "document.querySelector('[data-testid=hk-quick-createbook]').click(); 'ok'" >/dev/null
st wait 1500
shot 21-new-book.png
q "document.querySelector('.ant-modal-close').click(); 'ok'" >/dev/null
st wait 1000
q "document.querySelector('[data-testid=hk-quick-createdoc]').click(); 'ok'" >/dev/null
st wait 1500
q "(()=>{const s=document.querySelectorAll('.ant-modal .ant-select-selector');if(s.length<2)return 'no-select';['mousedown','mouseup','click'].forEach(t=>s[1].dispatchEvent(new MouseEvent(t,{bubbles:true})));return 'ok'})()" >/dev/null
st wait 1300
shot 06-doc-types.png
q "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); 'ok'" >/dev/null
st wait 600
q "document.querySelector('.ant-modal-close').click(); 'ok'" >/dev/null
st wait 900

echo "── 知识库与目录树 ──"
go "$BASE/books/$DEV" 5000
expand_one() {   # 坑①：逐个展开 + 逐个等
  q "(()=>{const w=[...document.querySelectorAll('.ant-tree-treenode')].find(t=>t.textContent.includes('$1')&&!t.querySelector('.ant-tree-switcher_open'));if(!w)return 'no-or-open';const s=w.querySelector('.ant-tree-switcher');if(!s)return 'no-switcher';s.click();return 'clicked'})()" >/dev/null
  st wait 2500
}
expand_one '私人知识库'
expand_one '产品研发中心'
shot 05-book-tree.png

open_book_menu() { q "(()=>{const tn=[...document.querySelectorAll('.ant-tree-treenode')].find(t=>t.textContent.includes('$1'));const m=tn&&tn.querySelector('.anticon-more');if(!m)return 'no-more';m.click();return 'ok'})()" >/dev/null; st wait 1300; }
menu() { q "(()=>{const it=[...document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')].find(e=>e.textContent.trim()==='$1');if(!it)return 'no-item';it.click();return 'ok'})()" >/dev/null; st wait 2500; }

echo "── 新建文档 / 导入 ──"
open_book_menu '产品研发中心'; menu '新建文档'
shot 22-new-doc.png
q "document.querySelector('.ant-modal-close').click(); 'ok'" >/dev/null; st wait 900
open_book_menu '产品研发中心'; menu '导入'
shot 07-import-dialog.png
q "document.querySelector('.ant-modal-close').click(); 'ok'" >/dev/null; st wait 900

echo "── 文档右键：分享 / 导出（坑②）──"
ctx() {
  q "(()=>{const tn=[...document.querySelectorAll('.ant-tree-treenode')].find(t=>t.textContent.includes('$1'));if(!tn)return 'no-node';
      const el=tn.querySelector('.ant-tree-title span')||tn.querySelector('.ant-tree-title');if(!el)return 'no-el';
      const b=el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,view:window,button:2,buttons:2,which:3,clientX:Math.round(b.left+20),clientY:Math.round(b.top+b.height/2)}));
      return 'ok'})()" >/dev/null
  st wait 1300
}
ctx '产品需求文档'; menu '分享'; shot 17-share.png
q "(()=>{const c=document.querySelector('.ant-drawer-close');if(c)c.click();return 'ok'})()" >/dev/null; st wait 1200
ctx '产品需求文档'; menu '导出'; shot 18-export.png
q "(()=>{const c=document.querySelector('.ant-modal-close');if(c)c.click();return 'ok'})()" >/dev/null; st wait 1000

echo "── 各文档类型 ──"
open_doc() { go "$BASE/books/$DEV?docId=$1&tab=read" 4500; }
open_doc "$MD"                                     ; shot 09-reader.png
open_doc "$(json "d['docs']['markdown']['id']")"   ; q "(()=>{const t=[...document.querySelectorAll('button,a,span')].find(e=>e.textContent.trim()==='编辑');if(t){t.click();return 'ok'}return 'none'})()" >/dev/null; st wait 3500; shot 08-editor.png
open_doc "$(json "d['docs']['sheet']['id']")"      ; shot 10-sheet.png
open_doc "$(json "d['docs']['mindmap']['id']")"    ; shot 11-mindmap.png
open_doc "$(json "d['docs']['flowchart']['id']")"  ; shot 12-flowchart.png
open_doc "$(json "d['docs']['gantt']['id']")"      ; shot 13-gantt.png
open_doc "$(json "d['docs']['todo']['id']")"       ; shot 14-todo.png
open_doc "$(json "d['docs']['calendar']['id']")"   ; shot 15-calendar.png

echo "── 搜索 / 公开分享页 ──"
go "$BASE/search?q=%E7%9F%A5%E8%AF%86%E5%BA%93" 4000
shot 24-search.png
SLUG=$(json "d['share']['slug'] if 'slug' in d.get('share',{}) else ''")
if [ -n "$SLUG" ]; then "$AB" open "$BASE/doc-share/$SLUG" >/dev/null 2>&1; st wait 3500; shot 19-share-public.png; fi

echo
echo "SHOTS_DIR=$SHOTS"
echo "CAPTURE_DONE 共 $(ls -1 "$SHOTS" | wc -l) 张"
