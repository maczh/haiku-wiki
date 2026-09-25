#!/usr/bin/env bash
# 新建/导入的「存放位置（目录）」修复专项端到端验证（单源生产形态）。
#
# 覆盖三条用户诉求：
#   ① 新建菜单里能新增「目录」（知识库菜单 / 文档右键 / 内容区空态 三处入口）
#   ② 新建 / 导入对话框的目录选择框显示的是**名称**而不是数字（历史 bug 显示「0」）
#   ③ 选子目录 / 子文档作为存放位置真的生效（落库 parent_id 等于所选节点，
#      而不是无论怎么选都变成 0）
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
PORT=${PORT:-8181}
BASE=http://127.0.0.1:$PORT
ROOT=$TMPDIR/e2e-folder-$(date +%s); SHOTS=$ROOT/shots; mkdir -p "$SHOTS"
DATA_DIR="$ROOT/data" PORT=$PORT JWT_SECRET=e2efolder GIN_MODE=release "$TMPDIR/haiku-wiki" >"$ROOT/server.log" 2>&1 &
SPID=$!
cleanup() { "$AB" close >/dev/null 2>&1; kill $SPID 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT
for _ in $(seq 1 80); do c=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$BASE/" || true); [ "$c" = "200" ] && break; sleep 0.5; done

PASS=0; FAIL=0
ck() { if [ "$2" = "$3" ]; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1  期望[$2] 实际[$3]"; FAIL=$((FAIL+1)); fi; }
ckc() { case "$3" in *"$2"*) echo "  ✅ $1"; PASS=$((PASS+1));; *) echo "  ❌ $1  未包含[$2] 实际[$3]"; FAIL=$((FAIL+1));; esac; }
ckn() { case "$3" in *"$2"*) echo "  ❌ $1  不应包含[$2] 实际[$3]"; FAIL=$((FAIL+1));; *) echo "  ✅ $1"; PASS=$((PASS+1));; esac; }
q() { "$AB" eval "$1" 2>&1 | grep -v '^{}' | tail -1 | sed -e 's/^"//' -e 's/"$//'; }
shot() { "$AB" screenshot "$SHOTS/$1" >/dev/null 2>&1; echo "    📸 $1"; }
go() { "$AB" open "$1" >/dev/null 2>&1; "$AB" wait "$2" >/dev/null 2>&1; }

# AntD Select 的选项只认真实鼠标事件：先 mousedown 展开，再点选项。
# 弹窗按**标题**精确定位 —— 步骤切换有动画，两个 Modal 会短暂同时存在于 DOM，
# 不定位标题就会点到上一个弹窗的按钮（这是上一轮 6 个假失败的主因）。
pick() { # pick <弹窗标题子串> <该弹窗内第几个 select，0 起> <选项文案子串>
  q "(()=>{const m=[...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('$1')});
    if(!m)return 'no-modal';
    const s=[...m.querySelectorAll('.ant-select-selector')][$2];
    if(!s)return 'no-select';
    s.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));
    return 'opened'})()" >/dev/null
  "$AB" wait 900 >/dev/null 2>&1
  q "(()=>{const ds=[...document.querySelectorAll('.ant-select-dropdown')].filter(d=>!d.classList.contains('ant-select-dropdown-hidden'));
    const d=ds[ds.length-1]; if(!d)return 'no-dropdown';
    const all=[...d.querySelectorAll('.ant-select-item-option')];
    const o=all.find(x=>x.textContent.includes('$3'));
    if(!o)return 'no-option['+all.map(x=>x.textContent).join('/')+']';
    o.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));
    o.click();
    return 'picked'})()"
}
# 指定标题弹窗内所有 Select 的当前显示文本（选中项 / 占位符）
selTexts() { # selTexts <弹窗标题子串>
  q "(()=>{const m=[...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('$1')});
    if(!m)return 'no-modal';
    return [...m.querySelectorAll('.ant-select')].map(s=>{const i=s.querySelector('.ant-select-selection-item');
      const p=s.querySelector('.ant-select-selection-placeholder');
      return i?i.textContent:(p?p.textContent:'(空)')}).join(' | ')})()"
}
# 点指定标题弹窗页脚里文案含 xx 的按钮
modalBtn() { # modalBtn <弹窗标题子串> <按钮文案子串>
  q "(()=>{const norm=t=>t.replace(/\\s+/g,'');
    const m=[...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('$1')});
    if(!m)return 'no-modal';
    const want=norm('$2');
    const b=[...m.querySelectorAll('.ant-modal-footer button')].find(x=>norm(x.textContent).includes(want));
    if(!b)return 'no-btn['+[...m.querySelectorAll('.ant-modal-footer button')].map(x=>x.textContent).join('/')+']';
    b.click(); return 'clicked'})()"
}
modalTitles() { q "([...document.querySelectorAll('.ant-modal-title')].map(e=>e.textContent).join('|'))||'无'"; }
setInput() { # setInput <弹窗标题子串> <弹窗内输入框选择器> <值>
  # React 受控输入必须走原生 value setter + input 事件，直接改 .value 不触发 onChange
  q "(()=>{const m=[...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('$1')});
    if(!m)return 'no-modal';
    const el=m.querySelector('$2'); if(!el) return 'no-input';
    const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(el,'$3'); el.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'})()"
}
clickLink() { # 点内容区概览条里的「新建文档 / 新建目录」入口（2026-09-21 工作台改版后是 Button，兼容 a）
  q "(()=>{const norm=t=>t.replace(/\s+/g,'');const el=[...document.querySelectorAll('a,button')].find(x=>norm(x.textContent)==='$1'); if(!el)return 'no-link'; el.click(); return 'ok'})()"
}
expandNode() { # expandNode <节点文本子串>（父节点必须已展开，逐个点+等，批量点会因重渲染失联）
  q "(()=>{const w=[...document.querySelectorAll('.ant-tree-treenode')].find(t=>t.textContent.includes('$1')&&!t.querySelector('.ant-tree-switcher_open'));
    if(!w)return 'no-or-open'; const s=w.querySelector('.ant-tree-switcher'); if(!s)return 'no-switcher';
    s.click(); return 'clicked'})()" >/dev/null
  "$AB" wait 2500 >/dev/null 2>&1
}
closeMenus() { q "document.body.click(); 'ok'" >/dev/null; "$AB" wait 300 >/dev/null 2>&1; "$AB" press Escape >/dev/null 2>&1; "$AB" wait 400 >/dev/null 2>&1; }
menuItems() { q "(()=>{const ds=[...document.querySelectorAll('.ant-dropdown')].filter(d=>!d.classList.contains('ant-dropdown-hidden'));
  return ds.length?[...ds[ds.length-1].querySelectorAll('.ant-dropdown-menu-item')].map(i=>i.textContent+(i.classList.contains('ant-dropdown-menu-item-disabled')?'(禁用)':'')).join('/'):'(无菜单)'})()"; }
ctxDoc() { # 在文档节点标题上派发 contextmenu（菜单挂在内层 span，派发到祖先 wrapper 永不命中）
  closeMenus
  q "(()=>{const n=[...document.querySelectorAll('.ant-tree-treenode')].find(t=>t.textContent.includes('$1'));
    if(!n)return 'no-node'; const el=n.querySelector('.ant-tree-title span')||n.querySelector('.ant-tree-node-content-wrapper');
    const b=el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:Math.round(b.left+30),clientY:Math.round(b.top+9)}));
    return 'ok'})()" >/dev/null
  "$AB" wait 800 >/dev/null 2>&1
}
api() { curl -s --noproxy '*' -H "Authorization: Bearer $TOKEN" "$BASE$1"; }

echo "== 0. 播种（含目录与嵌套子目录）=="
BASE="$BASE" OUT="$ROOT/ids.json" python3 - <<'PY'
import json, os, urllib.request, urllib.error
BASE = os.environ["BASE"]
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token: r.add_header("Authorization", "Bearer " + token)
    try:
        with op.open(r, timeout=30) as resp: p = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code} {e.read().decode()[:200]}")
    if p.get("code") != 0: raise SystemExit(f"{method} {path} -> {p}")
    return p.get("data")
tok = api("POST", "/api/auth/register", {"username":"diruser","name":"Dir","email":"dir@x.com","password":"pass123"})["token"]
book = api("POST", "/api/books", {"name":"目录验证库","description":"","visibility":"private"}, tok)
bid = book["id"]
f1 = api("POST", f"/api/books/{bid}/docs", {"title":"RIS项目","doc_type":"folder","parent_id":0}, tok)
f2 = api("POST", f"/api/books/{bid}/docs", {"title":"子目录","doc_type":"folder","parent_id":f1["id"]}, tok)
d1 = api("POST", f"/api/books/{bid}/docs", {"title":"需求说明","doc_type":"markdown","parent_id":f1["id"]}, tok)
json.dump({"token":tok,"book":bid,"f1":f1["id"],"f2":f2["id"],"d1":d1["id"]}, open(os.environ["OUT"],"w"))
print("seeded")
PY
TOKEN=$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['token'])")
BOOK=$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['book'])")
F1=$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['f1'])")
F2=$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['f2'])")
echo "  book=$BOOK folder=$F1 subfolder=$F2"

"$AB" set viewport 1600 900 >/dev/null 2>&1
go "$BASE/login" 2500
q "localStorage.setItem('hk_token','$TOKEN'); 'ok'" >/dev/null

# 树节点 id 快照，用于「新建后到底落了哪条」的精确断言（不依赖标题是否输入成功）
docIds() { api "/api/books/$BOOK/docs" | python3 -c "import sys,json;print(','.join(str(d['id']) for d in json.load(sys.stdin)['data']))"; }
newIds() { api "/api/books/$BOOK/docs" | python3 -c "
import sys,json
before=set('$1'.split(',')) if '$1' else set()
ds=json.load(sys.stdin)['data']
print(','.join(str(d['id']) for d in ds if str(d['id']) not in before))"; }
field() { api "/api/books/$BOOK/docs" | python3 -c "
import sys,json
ds=json.load(sys.stdin)['data']
m=[d for d in ds if d['id']==$1]
print(m[0]['$2'] if m else 'NOT_FOUND')"; }

echo "== 1. 后端：folder 类型、嵌套与「目录不承载正文」的边界 =="
TREE=$(api "/api/books/$BOOK/docs")
ck "树里有 3 个节点" "3" "$(echo "$TREE" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")"
ck "RIS项目 doc_type=folder" "folder" "$(field $F1 doc_type)"
ck "子目录 parent 指向 RIS项目" "$F1" "$(field $F2 parent_id)"
ck "目录不出现在最近更新" "0" "$(api "/api/recent-docs?limit=20" | python3 -c "import sys,json;print(len([i for i in json.load(sys.stdin)['data']['items'] if i['id'] in ($F1,$F2)]))")"
ck "目录导出格式为空" "0" "$(api "/api/export/docs/$F1/formats" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data'].get('formats') or []))")"

echo "== 2. 知识库树菜单：新建目录入口 =="
go "$BASE/books/$BOOK" 5000
expandNode '私人知识库'
expandNode '目录验证库'
q "(()=>{const n=[...document.querySelectorAll('.ant-tree-treenode')].find(t=>t.textContent.includes('目录验证库'));
  const m=n&&n.querySelector('.anticon-more'); if(!m)return 'no-more'; m.click(); return 'ok'})()" >/dev/null
"$AB" wait 900 >/dev/null 2>&1
ITEMS=$(menuItems)
# 2026-09-22 起：文库菜单「新建」变为下级子菜单（直接选择所有可新建类型），不再有独立「新建文档/新建目录」项
ckc "知识库菜单含「导入」" "导入" "$ITEMS"
SUB=$(q "(()=>{const ds=[...document.querySelectorAll('.ant-dropdown')].filter(d=>!d.classList.contains('ant-dropdown-hidden'));
  if(!ds.length)return '(无菜单)';
  const s=[...ds[ds.length-1].querySelectorAll('.ant-dropdown-menu-submenu-title')].find(i=>i.textContent.includes('新建'));
  return s?'新建子菜单':'(无新建子菜单)'})()")
ckc "知识库菜单「新建」为下级子菜单" "新建子菜单" "$SUB"
# 悬浮展开子菜单，断言含全部类型与「新建分组」
q "(()=>{const ds=[...document.querySelectorAll('.ant-dropdown')].filter(d=>!d.classList.contains('ant-dropdown-hidden'));
  const s=ds.length&&[...ds[ds.length-1].querySelectorAll('.ant-dropdown-menu-submenu-title')].find(i=>i.textContent.includes('新建'));
  if(!s)return 'no-sub'; s.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); s.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); return 'ok'})()" >/dev/null
"$AB" wait 900 >/dev/null 2>&1
SUBITEMS=$(q "(()=>{const its=[...document.querySelectorAll('.ant-dropdown-menu-item')].filter(x=>x.offsetParent!==null);
  return its.map(i=>i.textContent.trim()).join('/')||'(无)'})()")
for WANT in 文档 Excel文件 Word文件 PPT文件 思维导图 流程图 绘图 白板 待办清单 工作日历 甘特图 接口 图片库 需求原型 新建分组; do
  ckc "新建子菜单含「$WANT」" "$WANT" "$SUBITEMS"
done
shot 01-book-menu.png
closeMenus

echo "== 3. 文档/目录右键菜单 =="
expandNode 'RIS项目'
ctxDoc '需求说明'
ck "定位到文档节点" "ok" "$(q "(()=>{const n=[...document.querySelectorAll('.ant-tree-treenode')].find(t=>t.textContent.includes('需求说明')); return n?'ok':'no-node'})()")"
ITEMS=$(menuItems)
ckc "文档菜单含「新建子文档」" "新建子文档" "$ITEMS"
ckc "文档菜单含「新建子目录」" "新建子目录" "$ITEMS"
shot 02-doc-menu.png
closeMenus
ctxDoc 'RIS项目'
ITEMS=$(menuItems)
ckc "目录菜单含「新建子目录」" "新建子目录" "$ITEMS"
ckn "目录菜单不含「导出」" "导出" "$ITEMS"
ckn "目录菜单不含「分享」" "分享" "$ITEMS"
# 2026-09-20 起复制递归复制整棵子树（POST /docs/:id/copy），目录也可复制
ckc "目录菜单含「复制」" "复制" "$ITEMS"
ckn "目录的「复制」未被禁用" "复制(禁用)" "$ITEMS"
shot 03-folder-menu.png
closeMenus

echo "== 4. 新建文档：模板画廊 → 目录框显示名称（不是 0），且真的落到所选子目录 =="
go "$BASE/books/$BOOK" 5000
ck "概览条「新建文档」按钮" "ok" "$(clickLink '新建文档')"
"$AB" wait 1500 >/dev/null 2>&1
# 2026-09-21 起新建文档先经模板画廊
ckc "模板画廊弹出" "选择模板创建文档" "$(modalTitles)"
ck "画廊选「空白文档」" "ok" "$(q "(()=>{const m=[...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('选择模板')}); const b=m&&[...m.querySelectorAll('button')].find(b=>b.textContent.includes('空白文档')); if(!b)return 'no-blank'; b.click(); return 'ok'})()")"
"$AB" wait 1500 >/dev/null 2>&1
ckc "弹窗标题" "新建文档 · 选择位置" "$(modalTitles)"
TXT=$(selTexts '新建文档 · 选择位置')
ckc "知识库框显示库名" "目录验证库" "$TXT"
ckc "目录框显示「根目录（知识库顶层）」而非裸数字" "根目录（知识库顶层）" "$TXT"
ckn "目录框不含裸数字 0" "| 0" "$TXT"
shot 04-newdoc-step1.png
ck "选中「子目录」" "picked" "$(pick '新建文档 · 选择位置' 1 '子目录')"
ckc "目录框改显所选子目录名" "子目录" "$(selTexts '新建文档 · 选择位置')"
shot 05-newdoc-picked.png
BEFORE=$(docIds)
ck "进入第二步" "clicked" "$(modalBtn '新建文档 · 选择位置' '下一步')"
"$AB" wait 1200 >/dev/null 2>&1
ckc "第二步标题" "新建文档 · 填写信息" "$(modalTitles)"
ck "名称输入成功" "ok" "$(setInput '新建文档 · 填写信息' '.ant-input' '落到子目录的文档')"
"$AB" wait 400 >/dev/null 2>&1
ck "点「创建」" "clicked" "$(modalBtn '新建文档 · 填写信息' '创建')"
"$AB" wait 3500 >/dev/null 2>&1
NEW=$(newIds "$BEFORE" | head -1)
ck "只新增 1 个节点" "1" "$(echo "$NEW" | tr ',' '\n' | grep -c .)"
ck "新文档标题正确（说明名称输入生效）" "落到子目录的文档" "$(field "${NEW%%,*}" title 2>/dev/null || echo )"
ck "新文档落在所选子目录下（不是 0）" "$F2" "$(field "${NEW%%,*}" parent_id 2>/dev/null || echo '')"

echo "== 5. 新建目录（第二步只填名称、不选类型）=="
go "$BASE/books/$BOOK" 5000
ck "概览条「新建目录」按钮" "ok" "$(clickLink '新建目录')"
"$AB" wait 1500 >/dev/null 2>&1
ckc "弹窗标题" "新建目录 · 选择位置" "$(modalTitles)"
ck "选中「RIS项目」" "picked" "$(pick '新建目录 · 选择位置' 1 'RIS项目')"
shot 06-newfolder-step1.png
BEFORE=$(docIds)
ck "进入第二步" "clicked" "$(modalBtn '新建目录 · 选择位置' '下一步')"
"$AB" wait 1200 >/dev/null 2>&1
ckc "第二步标题" "新建目录 · 填写信息" "$(modalTitles)"
ckn "目录没有「文档类型」下拉" "文档类型" "$(q "([...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('新建目录 · 填写信息')}).textContent)")"
shot 07-newfolder-step2.png
ck "名称输入成功" "ok" "$(setInput '新建目录 · 填写信息' '.ant-input' '新目录A')"
"$AB" wait 400 >/dev/null 2>&1
ck "点「创建目录」" "clicked" "$(modalBtn '新建目录 · 填写信息' '创建目录')"
"$AB" wait 3500 >/dev/null 2>&1
NEW=$(newIds "$BEFORE" | head -1)
ck "新节点 doc_type=folder" "folder" "$(field "${NEW%%,*}" doc_type 2>/dev/null || echo '')"
ck "新目录父节点=RIS项目" "$F1" "$(field "${NEW%%,*}" parent_id 2>/dev/null || echo '')"
shot 08-newfolder-done.png

echo "== 6. 导入：目录选择同样生效且落库到该层级 =="
go "$BASE/books/$BOOK" 5000
expandNode '私人知识库'
expandNode '目录验证库'
q "(()=>{const n=[...document.querySelectorAll('.ant-tree-treenode')].find(t=>t.textContent.includes('目录验证库'));
  const m=n&&n.querySelector('.anticon-more'); m.click(); return 'ok'})()" >/dev/null
"$AB" wait 900 >/dev/null 2>&1
ck "点菜单「导入」" "clicked" "$(q "(()=>{const i=[...document.querySelectorAll('.ant-dropdown-menu-item')].find(x=>x.textContent.trim()==='导入'); if(!i)return 'no-item'; i.click(); return 'clicked'})()")"
"$AB" wait 1500 >/dev/null 2>&1
ckc "导入弹窗标题" "导入 · 选择位置" "$(modalTitles)"
ckc "导入目录框显示根目录名" "根目录（知识库顶层）" "$(selTexts '导入 · 选择位置')"
ck "导入选中「子目录」" "picked" "$(pick '导入 · 选择位置' 1 '子目录')"
ckc "导入目录框改显子目录名" "子目录" "$(selTexts '导入 · 选择位置')"
shot 09-import-step1.png
BEFORE=$(docIds)
ck "进入「选择方式」" "clicked" "$(modalBtn '导入 · 选择位置' '下一步')"
"$AB" wait 1500 >/dev/null 2>&1
ckc "第二步标题" "导入 · 选择方式" "$(modalTitles)"
ck "点「确定」打开导入抽屉" "clicked" "$(modalBtn '导入 · 选择方式' '确定')"
"$AB" wait 4000 >/dev/null 2>&1
ckc "导入抽屉已打开" "导入文档" "$(q "(document.querySelector('.ant-drawer-title')||{}).textContent||'无'")"
shot 10-import-drawer.png
# 注入三个夹具文件（隐藏 input 只能页面内构造真实 File + DataTransfer + change，
# 走的是应用真实的 onChange → parseFile → 导入链路，只是替代了 OS 文件选择器）
# ⚠️ 生成器与夹具都在**仓库内**（原先调用的是 $TMPDIR/gen-upload-js.py 那个旧副本 ——
#    一旦清理 tmp，这里会静默跑到旧逻辑或直接失败）；只有产物 JS 留在 tmp。
UPLOAD_JS=$TMPDIR/imp-upload.js
UPLOAD_JS_OUT=$UPLOAD_JS python3 "$HERE/gen-upload-js.py" >/dev/null
echo "  注入结果: $("$AB" eval "$(cat "$UPLOAD_JS")" 2>&1 | grep -v '^{}' | tail -1 | sed -e 's/^"//' -e 's/"$//')"
ok=0
for _ in $(seq 1 40); do
  N=$(api "/api/books/$BOOK/docs" | python3 -c "
import sys,json
ds=json.load(sys.stdin)['data']
print(len([d for d in ds if d['parent_id']==$F2]))")
  [ "${N:-0}" -ge 4 ] && { ok=1; break; }
  sleep 1
done
echo "    子目录下节点数=$N（超时=$([ $ok = 1 ] && echo 否 || echo 是)）"
IMPP=$(api "/api/books/$BOOK/docs" | python3 -c "
import sys,json
ds=json.load(sys.stdin)['data']
names=['多工作表','导入的Word文档','导入的PDF文档']
hit=[d for d in ds if any(n in d['title'] for n in names)]
print('%d/%d' % (len([d for d in hit if d['parent_id']==$F2]), len(hit)))")
ck "导入的文档全部落在所选子目录下" "3/3" "$IMPP"
shot 11-import-done.png

echo
echo "==== PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" = "0" ] && echo "E2E_FOLDER_OK"
echo "SHOTS=$SHOTS"
