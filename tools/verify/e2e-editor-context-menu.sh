#!/usr/bin/env bash
# 编辑器增强回归：Markdown 右键上下文菜单（行/选区/表格三态）+ 表格文字与背景色 +
# 思维导图默认结构（思维导图而非逻辑结构图）+ 脑图模板预览（含带图片节点的模板）。
#
# 数据：仓库夹具 fixtures/e2e-data 的临时副本（book 1：1=md 2=sheet 3=mindmap 4=flowchart 5=file），
#       本套件还会自建 1 篇 markdown + 1 篇 mindmap + 2 个用户脑图模板。
# 端口：8192（可用 PORT= 覆盖）。前置：bash tools/build/build-embed.sh 产出 $TMPDIR/haiku-wiki。
set -uo pipefail

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro
export TMPDIR=${TMPDIR:-/home/macro/.workbuddy/tmp}
export XDG_RUNTIME_DIR=$TMPDIR/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars,--window-size=1560,900"
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR"

AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser
PORT=${PORT:-8192}
BASE=http://127.0.0.1:$PORT
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BIN=$TMPDIR/haiku-wiki
[ -x "$BIN" ] || { echo "❌ 缺少 $BIN，先跑 bash tools/build/build-embed.sh"; echo "FAILED"; exit 1; }

DATA=$TMPDIR/ctxmenu-data-$(date +%s)
cp -r "$HERE/fixtures/e2e-data/." "$DATA/"
OUT=$TMPDIR/ctxmenu-out-$(date +%s); mkdir -p "$OUT"

DATA_DIR="$DATA" PORT="$PORT" JWT_SECRET=ctxmenu-secret GIN_MODE=release \
  "$BIN" >"$OUT/server.log" 2>&1 &
SPID=$!
cleanup() { "$AB" close >/dev/null 2>&1; kill "$SPID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 100); do
  c=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books"); [ "$c" != "000" ] && break; sleep 0.25
done
grep -q "address already in use" "$OUT/server.log" 2>/dev/null && {
  echo "❌ 端口 $PORT 已被占用（幽灵实例），换端口重跑：PORT=<空闲端口> bash $0"; echo "FAILED"; exit 1; }

TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
[ -z "$TOKEN" ] || [ "$TOKEN" = "null" ] && { echo "❌ 登录失败"; echo "FAILED"; exit 1; }
AUTH="Authorization: Bearer $TOKEN"

pass=0; fail=0
chk() { if [ "$2" = "$3" ]; then echo "  ✅ $1 = $3"; pass=$((pass+1));
        else echo "  ❌ $1：期望 $2，实际 $3"; fail=$((fail+1)); fi; }
contains() { if printf '%s' "$3" | grep -qF -- "$2"; then echo "  ✅ $1（含 $2）"; pass=$((pass+1));
             else echo "  ❌ $1：未含 $2（实际：$(printf '%s' "$3" | head -c 160)）"; fail=$((fail+1)); fi; }
neq() { if [ "$2" != "$3" ]; then echo "  ✅ $1（实际 $3）"; pass=$((pass+1));
        else echo "  ❌ $1：不应等于 $2"; fail=$((fail+1)); fi; }
chkMin() { if [ "${3:-0}" -ge "$2" ] 2>/dev/null; then echo "  ✅ $1 = $3"; pass=$((pass+1));
           else echo "  ❌ $1：期望 >=$2，实际 $3"; fail=$((fail+1)); fi; }
q() { "$AB" eval "$1" 2>&1 | tail -1 | sed 's/^"//; s/"$//'; }
num() { case "${1:-}" in ''|*[!0-9]*) echo 0 ;; *) echo "$1" ;; esac; }
newId() { curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" -H "$AUTH" -H 'Content-Type: application/json' -d "$1" | jq -r '.data.id // .data.doc.id // empty'; }

# ---------- 预置数据 ----------
MD=$'# 标题一\n\n正文段落一。第二句在这里。\n\n## 标题二\n\n| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n| 香蕉 | 5 |\n'
# 每节都用一篇全新的 markdown（自动保存会把改动写回，复用同一篇会让后面的节失去基线）
newMd() {
  local id
  id=$(newId "$(jq -nc --arg c "$MD" '{parent_id:0,title:"右键菜单用例",doc_type:"markdown",content:$c}')")
  [ -n "$id" ] && [ "$id" != "null" ] || { echo "❌ 预置 markdown 失败"; echo "FAILED"; exit 1; }
  echo "$id"
}
MDID=$(newMd)
echo "预置 markdown docId=$MDID"
MMID=$(newId '{"parent_id":0,"title":"默认结构用例","doc_type":"mindmap","content":""}')
echo "预置 mindmap docId=$MMID"

# 用户另存的脑图模板：A 版带图片节点（曾因缺 imageSize 导致整树渲染失败）、B 版为普通节点
mkTpl() { # $1=name $2=nodeExtraJson
  curl --noproxy '*' -s -X POST "$BASE/api/templates" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg n "$1" --argjson ex "$2" '{category:"探针分类",doc_type:"mindmap",name:$n,title:$n,
      content:({version:2,layout:"mindMap",root:{data:{text:"季度规划",expand:true,uid:"r"},children:[
        {data:({text:"目标",expand:true,uid:"a"}+$ex),children:[{data:{text:"营收翻倍",expand:true,uid:"b"},children:[]}]},
        {data:{text:"风险",expand:true,uid:"c"},children:[]}]}}|tojson)}')" >/dev/null
}
TPL_IMG="探针脑图-带图片"
TPL_PLAIN="探针脑图-无图片"
mkTpl "$TPL_PLAIN" '{"note":"备注","tag":["P0"]}'
# 注意：故意只给 image、不给 imageSize —— 这正是历史/外部数据会出现的形态
mkTpl "$TPL_IMG" '{"image":"/logo.svg","imageTitle":"配图"}'

# ---------- 浏览器登录态 ----------
"$AB" set viewport 1560 900 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1; "$AB" wait 2000 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); localStorage.removeItem('hk.toc.open'); 'ok'" >/dev/null 2>&1
"$AB" errors --clear >/dev/null 2>&1

IR="document.querySelector('.vditor-ir .vditor-reset')"
# 每节都带 nonce 强制重新加载（同 URL 的 open 不会重载，会沿用上一节被改过的内容）
visit() { "$AB" open "$BASE/books/1?docId=$1&tab=$2&_n=$RANDOM$RANDOM" >/dev/null 2>&1; "$AB" wait "${3:-6000}" >/dev/null 2>&1; }

blkSig() { q "(function(){var r=$IR;if(!r)return 'no-ir';var t=[];for(var i=0;i<r.children.length;i++)t.push(r.children[i].tagName.toLowerCase());return t.join(',')})()"; }
cnt() { q "(function(){var r=$IR;if(!r)return '-1';return String(r.querySelectorAll('$1').length)})()"; }
waitIr() { local n=0; while [ "$(blkSig)" = "no-ir" ] && [ $n -lt 12 ]; do "$AB" wait 700 >/dev/null 2>&1; n=$((n+1)); done; }
ctxBlock() {
  q "(function(){var r=$IR;if(!r)return 'no-ir';var t=r.children[$1];if(!t)return 'no-block';var b=t.getBoundingClientRect();var x=Math.round(b.left+40),y=Math.round(b.top+b.height/2);var el=document.elementFromPoint(x,y)||t;el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:2}));return 'ok'})()" >/dev/null
}
menuItems() {
  q "(function(){var m=document.querySelector('[data-vd-cm]');if(!m)return 'no-menu';var t=[];m.querySelectorAll('.ant-menu-item,.ant-menu-submenu-title').forEach(function(x){t.push((x.textContent||'').trim())});return t.join('/')})()"
}
subItems() {
  q "(function(){var ps=document.querySelectorAll('.ant-menu-submenu-popup');var out='';ps.forEach(function(p){if(p.className.indexOf('hidden')>=0)return;var r=p.getBoundingClientRect();if(r.width<20||getComputedStyle(p).display==='none')return;var t=[];p.querySelectorAll('.ant-menu-item').forEach(function(x){t.push((x.textContent||'').trim())});if(t.length)out=t.join('/')});return out||'no-popup'})()"
}
openSub() {
  q "(function(){var m=document.querySelector('[data-vd-cm]');if(!m)return 'no-menu';var t=m.querySelectorAll('.ant-menu-submenu-title')[$1];if(!t)return 'no-sub';t.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));t.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));return 'hovered'})()" >/dev/null
}
clickTop() {
  q "(function(){var m=document.querySelector('[data-vd-cm]');if(!m)return 'no-menu';var hit=null;m.querySelectorAll('.ant-menu-item').forEach(function(x){if((x.textContent||'').trim().indexOf('$1')>=0)hit=x});if(!hit)return 'no-item';hit.click();return 'clicked'})()" >/dev/null
}
clickSub() {
  q "(function(){var ps=document.querySelectorAll('.ant-menu-submenu-popup');var hit=null;ps.forEach(function(p){if(p.className.indexOf('hidden')>=0)return;var r=p.getBoundingClientRect();if(r.width<20||getComputedStyle(p).display==='none')return;var it=null;p.querySelectorAll('.ant-menu-item').forEach(function(x){if((x.textContent||'').trim().indexOf('$1')>=0)it=x});if(it)hit=it});if(!hit)return 'no-item';hit.click();return 'clicked'})()" >/dev/null
}
# 一次完整的「右键 block n → 样式/插入(子菜单序号) → 点某项」
lineOp() { ctxBlock "$1"; "$AB" wait 800 >/dev/null 2>&1; openSub "${3:-0}"; "$AB" wait 800 >/dev/null 2>&1; clickSub "$2"; "$AB" wait 1600 >/dev/null 2>&1; }
# 按表头文本定位文档里那张表
TBL="(function(){var ts=document.querySelector('.vditor-ir .vditor-reset').querySelectorAll('table');var t=null;ts.forEach(function(x){if((x.textContent||'').indexOf('名称')>=0)t=x});return t||ts[0]})()"
tblRows() { q "(function(){var t=$TBL;if(!t)return 'no-table';return String(t.querySelectorAll('tbody tr').length)})()"; }
tblCols() { q "(function(){var t=$TBL;if(!t)return 'no-table';return String(t.querySelectorAll('thead th').length)})()"; }
tblSig() { q "(function(){var t=$TBL;if(!t)return 'no-table';var a=[];t.querySelectorAll('tr').forEach(function(r){var c=[];r.querySelectorAll('td,th').forEach(function(x){c.push((x.textContent||'').trim())});a.push(c.join(':'))});return a.join(' | ')})()"; }
ctxTable() {
  q "(function(){var t=$TBL;if(!t)return 'no-table';var td=t.querySelector('tbody td')||t.querySelector('td');if(!td)return 'no-td';var b=td.getBoundingClientRect();var x=Math.round(b.left+b.width/2),y=Math.round(b.top+b.height/2);var el=document.elementFromPoint(x,y)||td;el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:2}));return 'ok'})()" >/dev/null
}
tableOp() { ctxTable; "$AB" wait 800 >/dev/null 2>&1; clickTop "$1"; "$AB" wait 1600 >/dev/null 2>&1; }
ctxSel() { # $1=block序号 $2=选中字符数
  q "(function(){var r=$IR;if(!r)return 'no-ir';var b=r.children[$1];if(!b)return 'no-block';
var tn=null;var w=document.createTreeWalker(b,NodeFilter.SHOW_TEXT);var n;
while((n=w.nextNode())){var t=(n.textContent||'').replace(/\u200b/g,'');if(t.trim()!==''){tn=n;break}}
if(!tn)return 'no-text';
var len=Math.max(1,Math.min($2,tn.textContent.length));
var sel=window.getSelection();var rg=document.createRange();rg.setStart(tn,0);rg.setEnd(tn,len);
sel.removeAllRanges();sel.addRange(rg);
var rb=rg.getBoundingClientRect();var x=Math.round(rb.left+2),y=Math.round(rb.top+Math.max(1,rb.height/2));
var el=document.elementFromPoint(x,y)||tn.parentNode;
el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:2}));
return 'sel:'+sel.toString().slice(0,10)})()" >/dev/null
}
selOp() { ctxSel "$1" "$2"; "$AB" wait 800 >/dev/null 2>&1; clickTop "$3"; "$AB" wait 1400 >/dev/null 2>&1; }
# 顶部条按钮
topBtn() { q "(function(){var h=null;document.querySelectorAll('button').forEach(function(b){if((b.textContent||'').trim()==='$1')h=b});if(!h)return 'no-btn';h.click();return 'clicked'})()"; }
swatch() { q "(function(){var ps=document.querySelectorAll('.ant-popover');var h=null;ps.forEach(function(p){if(getComputedStyle(p).display==='none')return;p.querySelectorAll('div[title]').forEach(function(d){if(d.getAttribute('title')==='$1')h=d})});if(!h)return 'no-swatch';h.click();return 'clicked'})()"; }

echo "===== 1) 行上下文菜单：样式（含「不得波及其它块」） ====="
visit "$MDID" edit; waitIr
chk "初始块序" "h1,p,h2,table" "$(blkSig)"
ctxBlock 1; "$AB" wait 800 >/dev/null 2>&1
chk "顶层菜单项" "样式/插入/删除行" "$(menuItems)"
openSub 0; "$AB" wait 800 >/dev/null 2>&1
chk "样式子菜单 7 项" "标题 1（H1）/标题 2（H2）/标题 3（H3）/正文/引用/无序列表/有序列表" "$(subItems)"
chk "样式→标题 2（H2）" "h1,h2,h2,table" "$(lineOp 1 '标题 2（H2）'; blkSig)"
chk "样式→引用" "h1,blockquote,h2,table" "$(lineOp 1 '引用'; blkSig)"
chk "样式→无序列表" "h1,ul,h2,table" "$(lineOp 1 '无序列表'; blkSig)"
chk "样式→有序列表" "h1,ol,h2,table" "$(lineOp 1 '有序列表'; blkSig)"
chk "样式→正文" "h1,p,h2,table" "$(lineOp 1 '正文'; blkSig)"
chk "样式→标题 3（H3）" "h1,h3,h2,table" "$(lineOp 1 '标题 3（H3）'; blkSig)"
chk "样式→标题 1（H1）" "h1,h1,h2,table" "$(lineOp 1 '标题 1（H1）'; blkSig)"
ctxBlock 1; "$AB" wait 800 >/dev/null 2>&1
chk "删除行（只删本行）" "h1,h2,table" "$(clickTop '删除行'; "$AB" wait 1600 >/dev/null 2>&1; blkSig)"
contains "删除行后正文仍完整" "苹果" "$(q "(function(){var r=$IR;return r?r.textContent.replace(/\s+/g,' '):''})()")"

echo "===== 2) 插入菜单：表格 / 分割线 / 时序图 / 流程图 / 图片 / 链接 ====="
MDID=$(newMd); visit "$MDID" edit; waitIr
T0=$(num "$(cnt table)")
lineOp 1 '表格' 1
chk "插入→表格" "$((T0+1))" "$(num "$(cnt table)")"
MDID=$(newMd); visit "$MDID" edit; waitIr
lineOp 1 '分割线' 1
chkMin "插入→分割线（hr 元素）" 1 "$(num "$(cnt hr)")"
MDID=$(newMd); visit "$MDID" edit; waitIr
lineOp 1 '时序图' 1
contains "插入→时序图（mermaid 源码）" "sequenceDiagram" "$(q "(function(){var r=$IR;return r?r.textContent.replace(/\s+/g,' '):''})()")"
MDID=$(newMd); visit "$MDID" edit; waitIr
lineOp 1 '流程图' 1
contains "插入→流程图（mermaid 源码）" "flowchart" "$(q "(function(){var r=$IR;return r?r.textContent.replace(/\s+/g,' '):''})()")"
MDID=$(newMd); visit "$MDID" edit; waitIr
lineOp 1 '图片' 1
chkMin "插入→图片（img 元素）" 1 "$(num "$(cnt img)")"
MDID=$(newMd); visit "$MDID" edit; waitIr
lineOp 1 '链接' 1
contains "插入→链接" "链接文字" "$(q "(function(){var r=$IR;return r?r.textContent.replace(/\s+/g,' '):''})()")"

echo "===== 3) 表格内上下文菜单：行列增删（以当前单元格为中心） ====="
MDID=$(newMd); visit "$MDID" edit; waitIr
echo "  · 原表：$(tblSig)"
ctxTable; "$AB" wait 800 >/dev/null 2>&1
chk "右键单元格 → 6 项菜单" "在上方插入行/在下方插入行/在左侧插入列/在右侧插入列/删除本行/删除本列" "$(menuItems)"
R0=$(num "$(tblRows)"); C0=$(num "$(tblCols)")
tableOp '在下方插入行'
chk "在下方插入行" "$((R0+1))" "$(num "$(tblRows)")"
tableOp '在右侧插入列'
chk "在右侧插入列" "$((C0+1))" "$(num "$(tblCols)")"
R1=$(num "$(tblRows)"); C1=$(num "$(tblCols)")
tableOp '删除本行'
chk "删除本行" "$((R1-1))" "$(num "$(tblRows)")"
tableOp '删除本列'
chk "删除本列" "$((C1-1))" "$(num "$(tblCols)")"
echo "  · 操作后：$(tblSig)"

echo "===== 4) 选区上下文菜单：格式化（每项独立起一篇新文档，编辑态 + 阅读态双验） ====="
MDID=$(newMd); visit "$MDID" edit; waitIr
ctxSel 1 6; "$AB" wait 800 >/dev/null 2>&1
chk "选中文字 → 6 项菜单" "加粗/斜体/删除线/下划线/行内代码/代码块" "$(menuItems)"
# 选中 block1 的前 6 字 = 「正文段落一。」——刻意让选区以标点结尾、后面紧跟正文，
# 这正是 CommonMark 侧翼规则最容易翻车的形态（闭合标记前是标点、后是文字 → 标记不成立，
# 文档里会留下字面 ** 且不加粗）。断言口径：
#   编辑态 = IR 是否把标记解析成了行内元素（证明 markdown 合法、用户当场看到加粗）
#   阅读态 = .doc-content 里的最终渲染元素（证明落库内容也能正确渲染）
cntRd() { q "(function(){var r=document.querySelector('.doc-content');if(!r)return '-1';return String(r.querySelectorAll('$1').length)})()"; }
selCase() { # $1=菜单项 $2=编辑态选择器 $3=编辑态期望 $4=阅读态选择器 $5=阅读态期望
  local id
  id=$(newMd); visit "$id" edit; waitIr
  ctxSel 1 6; "$AB" wait 900 >/dev/null 2>&1
  clickTop "$1"; "$AB" wait 1600 >/dev/null 2>&1
  chk "$1（编辑态 $2）" "$3" "$(num "$(cnt "$2")")"
  # 等自动保存落库（防抖 3s），否则阅读态读到的是改动前的内容
  "$AB" wait 2600 >/dev/null 2>&1
  "$AB" open "$BASE/books/1?docId=$id&_n=$RANDOM$RANDOM" >/dev/null 2>&1; "$AB" wait 6000 >/dev/null 2>&1
  chk "$1（阅读态 $4）" "$5" "$(num "$(cntRd "$4")")"
}
selCase '加粗' 'strong' 1 'strong' 1
selCase '斜体' 'em' 1 'em' 1
# 编辑态是 <s>、阅读态是 <del>（Lute 两种形态不一致，选择器要分别写）
selCase '删除线' 's' 1 'del' 1
selCase '行内代码' 'code' 1 'code' 1
# 下划线没有对应的 markdown 语法，走 HTML 行内标签：编辑态是 html-inline 标记本身
# （开/闭两个，不是 <u> 元素），阅读态才是真正的 <u>
selCase '下划线' '[data-type=html-inline]' 2 'u' 1
# 代码块：编辑态/阅读态都应有 pre，且落库内容必须是独占一行的围栏
MDID=$(newMd); visit "$MDID" edit; waitIr
ctxSel 1 6; "$AB" wait 900 >/dev/null 2>&1
clickTop '代码块'; "$AB" wait 4800 >/dev/null 2>&1
chkMin "代码块（编辑态 pre）" 1 "$(num "$(cnt 'pre')")"
contains "代码块围栏已落库（且后文未被吞）" '```' "$(curl --noproxy '*' -s "$BASE/api/docs/$MDID" -H "$AUTH" | jq -r '.data.doc.content')"
contains "代码块内是选中文字" '正文段落一。' "$(curl --noproxy '*' -s "$BASE/api/docs/$MDID" -H "$AUTH" | jq -r '.data.doc.content')"
"$AB" open "$BASE/books/1?docId=$MDID&_n=$RANDOM$RANDOM" >/dev/null 2>&1; "$AB" wait 6000 >/dev/null 2>&1
chkMin "代码块（阅读态 pre）" 1 "$(num "$(cntRd 'pre')")"

echo "===== 5) 表格：文字颜色 / 单元格背景色（可设 + 落库 + 阅读态渲染） ====="
visit 2 edit 7000
chk "顶部条取色按钮" "文字颜色/单元格背景色" \
  "$(q "(function(){var t=[];document.querySelectorAll('button').forEach(function(b){var s=(b.textContent||'').trim();if(s==='文字颜色'||s==='单元格背景色')t.push(s)});return t.join('/')})()")"
chk "Luckysheet 已渲染" "true" "$(q "(function(){return String(!!document.querySelector('.luckysheet-cell-main'))})()")"
q "(function(){var c=document.querySelector('.luckysheet-cell-main');if(!c)return 'no-canvas';var b=c.getBoundingClientRect();var el=document.elementFromPoint(b.left+50,b.top+30)||c;['mousedown','mouseup','click'].forEach(function(t){el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:b.left+50,clientY:b.top+30,button:0}))});return 'ok'})()" >/dev/null
"$AB" wait 800 >/dev/null 2>&1
echo "  · 选区：$(q "(function(){try{var s=window.luckysheet.getluckysheet_select_save();return s&&s.length?s[0].row.join(',')+'|'+s[0].column.join(','):'EMPTY'}catch(e){return 'ERR'}})()")"
chk "点「文字颜色」弹出取色面板" "clicked" "$(topBtn '文字颜色')"
"$AB" wait 900 >/dev/null 2>&1
SW=$(q "(function(){var n=0;document.querySelectorAll('.ant-popover').forEach(function(p){if(getComputedStyle(p).display==='none')return;n+=p.querySelectorAll('div[title^=\"#\"]').length});return String(n)})()")
if [ "${SW:-0}" -ge 12 ] 2>/dev/null; then echo "  ✅ 预设色板色块数 = $SW"; pass=$((pass+1)); else echo "  ❌ 预设色板色块数：期望 >=12，实际 $SW"; fail=$((fail+1)); fi
chk "选中色块 #e60000" "clicked" "$(swatch '#e60000')"
"$AB" wait 5000 >/dev/null 2>&1
C2=$(curl --noproxy '*' -s "$BASE/api/docs/2" -H "$AUTH" | jq -r '.data.doc.content')
contains "文字颜色已落库" '"fc":"#e60000"' "$C2"
chk "点「单元格背景色」弹出取色面板" "clicked" "$(topBtn '单元格背景色')"
"$AB" wait 900 >/dev/null 2>&1
chk "选中色块 #ffff00" "clicked" "$(swatch '#ffff00')"
"$AB" wait 5000 >/dev/null 2>&1
C2=$(curl --noproxy '*' -s "$BASE/api/docs/2" -H "$AUTH" | jq -r '.data.doc.content')
contains "背景色已落库" '"bg":"#ffff00"' "$C2"
visit 2 read 7000
chk "阅读态拿到单元格颜色" "fc=true bg=true" \
  "$(q "(function(){try{var s=JSON.stringify(window.luckysheet.getAllSheets());return 'fc='+(s.indexOf('#e60000')>=0)+' bg='+(s.indexOf('#ffff00')>=0)}catch(e){return 'ERR'}})()")"

echo "===== 6) 思维导图：默认结构 = 思维导图 ====="
visit "$MMID" edit 7000
q "(function(){var t=null;document.querySelectorAll('.hk-mm-side-btn').forEach(function(b){if(((b.getAttribute('title')||'')+(b.textContent||'')).indexOf('结构')>=0)t=b});if(t)t.click();return t?'clicked':'no-btn'})()" >/dev/null
"$AB" wait 1500 >/dev/null 2>&1
chk "结构面板选中项" "思维导图" \
  "$(q "(function(){var d=null;document.querySelectorAll('.ant-drawer-open').forEach(function(x){if((x.textContent||'').indexOf('结构')>=0&&x.querySelector('.ant-radio-wrapper-checked'))d=x});if(!d)return 'no-drawer';return (d.querySelector('.ant-radio-wrapper-checked').textContent||'').trim()})()")"
"$AB" screenshot "$OUT/20-mm-structure.png" >/dev/null 2>&1

echo "===== 7) 脑图模板预览（另存模板不再报错） ====="
"$AB" errors --clear >/dev/null 2>&1
"$AB" open "$BASE/templates" >/dev/null 2>&1; "$AB" wait 7000 >/dev/null 2>&1
chk "按类型筛选「思维导图」" "clicked" \
  "$(q "(function(){var h=null;document.querySelectorAll('button').forEach(function(b){if((b.textContent||'').trim()==='思维导图')h=b});if(!h)return 'no-chip';h.click();return 'clicked'})()")"
"$AB" wait 2500 >/dev/null 2>&1
tplPreview() { # $1=模板名 → 打开预览并返回节点数
  q "(function(){var h=null;document.querySelectorAll('button').forEach(function(b){if((b.textContent||'').indexOf('$1')>=0)h=b});if(!h)return 'no-card';h.click();return 'clicked'})()" >/dev/null
  "$AB" wait 4000 >/dev/null 2>&1
}
tplTitle() { q "(function(){var t=document.querySelector('.ant-modal-title');return t?(t.textContent||'').trim():'no-modal'})()"; }
tplNodes() { q "(function(){return String(document.querySelectorAll('.smm-node').length)})()"; }
closeTpl() { "$AB" press Escape >/dev/null 2>&1; "$AB" wait 1500 >/dev/null 2>&1; }

tplPreview "$TPL_IMG"
contains "预览标题含模板名（带图片）" "$TPL_IMG" "$(tplTitle)"
N=$(tplNodes)
if [ "${N:-0}" -ge 4 ] 2>/dev/null; then echo "  ✅ 带图片节点模板渲染节点数 = $N"; pass=$((pass+1));
else echo "  ❌ 带图片节点模板渲染节点数：期望 >=4，实际 $N"; fail=$((fail+1)); fi
chk "图片确已渲染" "1" "$(q "(function(){return String(document.querySelectorAll('.smm-container image').length)})()")"
"$AB" screenshot "$OUT/21-mm-tpl-preview.png" >/dev/null 2>&1
closeTpl

tplPreview "$TPL_PLAIN"
N=$(tplNodes)
if [ "${N:-0}" -ge 4 ] 2>/dev/null; then echo "  ✅ 普通节点模板渲染节点数 = $N"; pass=$((pass+1));
else echo "  ❌ 普通节点模板渲染节点数：期望 >=4，实际 $N"; fail=$((fail+1)); fi
closeTpl
# 对照：内置脑图模板同样可预览
tplPreview "成本结构分析脑图"
N=$(tplNodes)
if [ "${N:-0}" -ge 4 ] 2>/dev/null; then echo "  ✅ 内置模板「成本结构分析脑图」渲染节点数 = $N"; pass=$((pass+1));
else echo "  ❌ 内置模板渲染节点数：期望 >=4，实际 $N"; fail=$((fail+1)); fi
closeTpl

ERRN=$("$AB" errors 2>&1 | grep -c . )
chk "界面操作零控制台错误" "0" "$ERRN"
"$AB" errors 2>&1 | head -8 | sed 's/^/    · /'

echo
echo "通过 $pass 项，失败 $fail 项"
[ "$fail" -eq 0 ] && echo "CTXMENU_OK" || echo "CTXMENU_FAILED"
echo "（服务端日志与截图：$OUT）"
