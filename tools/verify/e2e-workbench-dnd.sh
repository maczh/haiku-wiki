#!/usr/bin/env bash
# 文库首页工作台 + 目录树「移动 / 复制 / 拖拽」端到端验证（单源生产形态）。
#
# 覆盖三条用户诉求：
#   ① 首页不再出现裸 "0" / "00" / "0000" 文本
#      （根因：BookPage 里 Number(searchParams.get('docId') || 0) 在未选中文档时返回**数字 0**，
#        下游 {docId && <X/>} 短路成 0，而 React 把数字 0 当合法子节点渲染成文本）
#   ② 首页工作台：有 待办 / 甘特 / 日历 文档才显示对应卡，三类都没有则整段不显示；
#      文库内搜索卡能把关键词带到搜索页
#   ③ 目录树：右键「移动」「复制」弹窗可跨知识库、可选多级子目录；拖拽落在节点中部=成为其子文档
#
# 落库一律用 API 回查断言（不看界面文案就下结论）。
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

PORT=${PORT:-8195}
BASE=http://127.0.0.1:$PORT
ROOT=$TMPDIR/e2e-wbdnd-$(date +%s); SHOTS=$ROOT/shots; mkdir -p "$SHOTS"
[ -x "$TMPDIR/haiku-wiki" ] || { echo "❌ 找不到后端二进制 —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi
DATA_DIR="$ROOT/data" PORT=$PORT JWT_SECRET=e2ewbdnd GIN_MODE=release "$TMPDIR/haiku-wiki" >"$ROOT/server.log" 2>&1 &
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
api() { curl -s --noproxy '*' -H "Authorization: Bearer $TOKEN" "$BASE$1"; }

# 弹窗内按 data-testid 定位 Select，展开并点文案含 xx 的选项。
# AntD 的选项只认真实鼠标事件，且弹窗有动画 —— 必须逐个等，不能批量点。
openSelect() { # openSelect <弹窗标题子串> <data-testid>
  q "(()=>{const m=[...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('$1')});
    if(!m)return 'no-modal';
    const s=m.querySelector('[data-testid=\"$2\"] .ant-select-selector');
    if(!s)return 'no-select';
    s.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));
    return 'opened'})()"
  "$AB" wait 900 >/dev/null 2>&1
}
pickTestId() { # pickTestId <弹窗标题子串> <data-testid> <选项文案子串>
  openSelect "$1" "$2" >/dev/null
  q "(()=>{const ds=[...document.querySelectorAll('.ant-select-dropdown')].filter(d=>!d.classList.contains('ant-select-dropdown-hidden'));
    const d=ds[ds.length-1]; if(!d)return 'no-dropdown';
    const all=[...d.querySelectorAll('.ant-select-item-option')];
    const o=all.find(x=>x.textContent.includes('$3'));
    if(!o)return 'no-option['+all.map(x=>x.textContent).join('/')+']';
    o.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0})); o.click(); return 'picked'})()"
}
pickTreeTestId() { # pickTreeTestId <弹窗标题子串> <data-testid> <节点文案子串>
  openSelect "$1" "$2" >/dev/null
  q "(()=>{const ds=[...document.querySelectorAll('.ant-select-dropdown')].filter(d=>!d.classList.contains('ant-select-dropdown-hidden'));
    const d=ds[ds.length-1]; if(!d)return 'no-dropdown';
    const all=[...d.querySelectorAll('.ant-select-tree-treenode')];
    const n=all.find(x=>{const t=x.querySelector('.ant-select-tree-title');return t&&t.textContent.includes('$3')});
    if(!n)return 'no-node['+all.map(x=>x.textContent).join('/')+']';
    const el=n.querySelector('.ant-select-tree-node-content-wrapper')||n;
    el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0})); el.click(); return 'picked'})()"
}
treeOptions() { # 当前展开的 TreeSelect 下拉里的全部节点文案
  q "(()=>{const ds=[...document.querySelectorAll('.ant-select-dropdown')].filter(d=>!d.classList.contains('ant-select-dropdown-hidden'));
    const d=ds[ds.length-1]; if(!d)return 'no-dropdown';
    return [...d.querySelectorAll('.ant-select-tree-treenode')].map(x=>x.textContent).join('/')})()"
}
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
closeMenus() { q "document.body.click(); 'ok'" >/dev/null; "$AB" wait 300 >/dev/null 2>&1; "$AB" press Escape >/dev/null 2>&1; "$AB" wait 400 >/dev/null 2>&1; }
menuItems() { q "(()=>{const ds=[...document.querySelectorAll('.ant-dropdown')].filter(d=>!d.classList.contains('ant-dropdown-hidden'));
  return ds.length?[...ds[ds.length-1].querySelectorAll('.ant-dropdown-menu-item')].map(i=>i.textContent+(i.classList.contains('ant-dropdown-menu-item-disabled')?'(禁用)':'')).join('/'):'(无菜单)'})()"; }
clickMenu() { # 点当前下拉里文案含 xx 的菜单项
  q "(()=>{const ds=[...document.querySelectorAll('.ant-dropdown')].filter(d=>!d.classList.contains('ant-dropdown-hidden'));
    if(!ds.length)return 'no-dropdown'; const d=ds[ds.length-1];
    const it=[...d.querySelectorAll('.ant-dropdown-menu-item')].find(i=>i.textContent.includes('$1'));
    if(!it)return 'no-item'; it.click(); return 'clicked'})()"
}
ctxDoc() { # 在文档节点标题上派发 contextmenu（菜单挂在内层 span，派发到祖先 wrapper 永不命中）
  closeMenus
  q "(()=>{const n=[...document.querySelectorAll('.ant-tree-treenode')].find(t=>t.textContent.includes('$1'));
    if(!n)return 'no-node'; const el=n.querySelector('.ant-tree-title span')||n.querySelector('.ant-tree-node-content-wrapper');
    const b=el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:Math.round(b.left+30),clientY:Math.round(b.top+9)}));
    return 'ok'})()" >/dev/null
  "$AB" wait 800 >/dev/null 2>&1
}
expandNode() { # expandNode <节点文本子串>
  q "(()=>{const w=[...document.querySelectorAll('.ant-tree-treenode')].find(t=>t.textContent.includes('$1')&&!t.querySelector('.ant-tree-switcher_open'));
    if(!w)return 'no-or-open'; const s=w.querySelector('.ant-tree-switcher'); if(!s)return 'no-switcher';
    s.click(); return 'clicked'})()" >/dev/null
  "$AB" wait 2500 >/dev/null 2>&1
}
# 裸 "0" 文本节点探针：textContent 全为 0 的文本节点（0/00/0000 都能命中）
bareZero() {
  q "(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let n,c=0,out=[];while(n=w.nextNode()){const t=n.textContent.trim();
      if(/^0+\$/.test(t)){c++;if(out.length<6){const p=n.parentElement;
        out.push((p.className||p.tagName)+'='+t)}}}
    return c+(out.length?(' 例如 '+out.join(' , ')):'')})()"
}
docList() { api "/api/books/$1/docs" | python3 -c "
import sys,json
ds=json.load(sys.stdin)['data']
print(';'.join(f\"{d['id']}:{d.get('title')}\" for d in ds))"; }
docCount() { api "/api/books/$1/docs" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))"; }
fieldOf() { api "/api/books/$1/docs" | python3 -c "
import sys,json
for d in json.load(sys.stdin)['data']:
    if d['id']==$2: print(f\"book={d['book_id']} parent={d.get('parent_id')}\")"; }

echo "== 0. 播种 =="
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
        raise SystemExit(f"{method} {path} -> {e.code} {e.read().decode()[:300]}")
    if p.get("code") != 0: raise SystemExit(f"{method} {path} -> {p}")
    return p.get("data")

tok = api("POST", "/api/auth/register",
          {"username":"wbdnd","name":"WB","email":"wbdnd@x.com","password":"pass123"})["token"]
A = api("POST", "/api/books", {"name":"产品库","description":"","visibility":"private"}, tok)["id"]
B = api("POST", "/api/books", {"name":"归档库","description":"","visibility":"private"}, tok)["id"]
def mk(book, title, dtype, parent=0, content=None):
    d = api("POST", f"/api/books/{book}/docs",
            {"title":title,"doc_type":dtype,"parent_id":parent}, tok)
    if content is not None:
        api("PATCH", f"/api/docs/{d['id']}", {"content":content}, tok)
    return d["id"]

ids = {
  "token":tok, "A":A, "B":B,
  "f1": mk(A, "设计资料", "folder"),
  "d2": mk(A, "散落文档", "markdown", 0, "待归档"),
  "d3": mk(A, "拖拽对象", "markdown", 0, "待拖拽"),
  "bf": mk(B, "归档目录", "folder"),
}
ids["f2"] = mk(A, "子目录", "folder", ids["f1"])
ids["d1"] = mk(A, "需求说明", "markdown", ids["f1"], "# 需求\n正文")
ids["bc"] = mk(B, "归档子层", "folder", ids["bf"])
json.dump(ids, open(os.environ["OUT"], "w"))
print("  seeded：产品库(A) 设计资料/子目录/需求说明 · 散落文档 · 拖拽对象；归档库(B) 归档目录/归档子层；暂无待办·甘特·日历")
PY
ids() { python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['$1'])"; }
TOKEN=$(ids token); A=$(ids A); B=$(ids B); F1=$(ids f1); D1=$(ids d1)
D2=$(ids d2); D3=$(ids d3); BF=$(ids bf); BC=$(ids bc)
echo "  A=$A B=$B f1=$F1 d1=$D1 d2=$D2 d3=$D3 bf=$BF bc=$BC"

"$AB" set viewport 1600 900 >/dev/null 2>&1
go "$BASE/login" 2500
q "localStorage.setItem('hk_token','$TOKEN'); 'ok'" >/dev/null

echo
echo "== 1. 首页不得出现裸 0 文本（任务①）=="
go "$BASE/book/$A" 3500
Z=$(bareZero); echo "    /book/$A（未选中文档）裸 0 节点：$Z"
ckc "知识库页未选中文档时无裸 0 文本" "0 " "$Z "
shot "01-book-no-docid.png"
go "$BASE/book/$A?docId=$D1" 3000
Z=$(bareZero); echo "    /book/$A?docId=$D1（已选中）裸 0 节点：$Z"
ckc "知识库页已选中文档时无裸 0 文本" "0 " "$Z "
shot "02-book-with-docid.png"

echo
echo "== 2. 三类文档都没有 → 工作台整段不显示（任务②）=="
go "$BASE/dashboard" 3500
ck "无待办/甘特/日历时工作台不渲染" "0" "$(q "document.querySelectorAll('[data-testid=\"hk-workbench\"]').length")"
ck "文库内搜索卡始终存在" "1" "$(q "document.querySelectorAll('[data-testid=\"hk-dash-search\"]').length")"
shot "03-dashboard-no-workbench.png"

echo
echo "== 3. 播种 待办/甘特/日历 后三卡出现且统计正确（任务②）=="
BASE="$BASE" A="$A" TOKEN="$TOKEN" python3 - <<'PY'
import json, os, datetime, urllib.request
BASE=os.environ["BASE"]; A=os.environ["A"]; tok=os.environ["TOKEN"]
op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def api(method,path,body=None):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path,data=data,method=method)
    r.add_header("Content-Type","application/json"); r.add_header("Authorization","Bearer "+tok)
    with op.open(r,timeout=30) as resp: return json.loads(resp.read().decode())["data"]
today=datetime.date.today(); past=(today-datetime.timedelta(days=3)).isoformat()
todo={"version":1,"items":[
  {"id":"t1","text":"已完成的项","done":True,"due":"","priority":"","note":""},
  {"id":"t2","text":"逾期的项","done":False,"due":past,"priority":"high","note":""},
  {"id":"t3","text":"今天到期","done":False,"due":today.isoformat(),"priority":"medium","note":""},
  {"id":"t4","text":"无期限项","done":False,"due":"","priority":"","note":""},
]}
gantt={"version":1,"tasks":[
  {"id":1,"text":"需求","start":(today-datetime.timedelta(days=10)).isoformat(),"duration":10,"progress":100,"type":"task"},
  {"id":2,"text":"开发","start":today.isoformat(),"duration":10,"progress":50,"type":"task"},
  {"id":3,"text":"测试","start":(today+datetime.timedelta(days=10)).isoformat(),"duration":10,"progress":0,"type":"task"},
],"links":[]}
cal={"version":1,"tasks":[
  {"id":"c1","title":"今日评审","start":today.isoformat()+" 10:00","end":today.isoformat()+" 11:00","done":False,"cancelled":False,"note":""},
  {"id":"c2","title":"已取消的日程","start":today.isoformat()+" 14:00","end":"","done":False,"cancelled":True,"note":""},
]}
for title,dtype,content in [("项目待办","todo",todo),("项目甘特","gantt",gantt),("项目日历","calendar",cal)]:
    d=api("POST",f"/api/books/{A}/docs",{"title":title,"doc_type":dtype,"parent_id":0})
    api("PATCH",f"/api/docs/{d['id']}",{"content":json.dumps(content,ensure_ascii=False)})
print("  seeded 待办(4 项：1 完成 / 1 逾期 / 1 今天到期 / 1 无期限)")
print("        甘特(3 段各 10 天，进度 100/50/0 → 加权平均 50%)")
print("        日历(1 条今日待办 + 1 条已取消)")
PY
go "$BASE/dashboard" 4000
ck "工作台区块已出现" "1" "$(q "document.querySelectorAll('[data-testid=\"hk-workbench\"]').length")"
ck "待办卡已出现" "1" "$(q "document.querySelectorAll('[data-testid=\"hk-wb-todo\"]').length")"
ck "甘特卡已出现" "1" "$(q "document.querySelectorAll('[data-testid=\"hk-wb-gantt\"]').length")"
ck "日历卡已出现" "1" "$(q "document.querySelectorAll('[data-testid=\"hk-wb-calendar\"]').length")"
shot "04-dashboard-workbench.png"
TODO_TXT=$(q "document.querySelector('[data-testid=\"hk-wb-todo\"]').innerText.replace(/\\n/g,' / ')")
echo "    待办卡：$TODO_TXT"
ckc "待办卡标出 2 项未完成（4 项里 1 项已完成）" "2 项未完成" "$TODO_TXT"
ckc "待办卡统计出逾期条目" "已逾期" "$TODO_TXT"
GAN_TXT=$(q "document.querySelector('[data-testid=\"hk-wb-gantt\"]').innerText.replace(/\\n/g,' / ')")
echo "    甘特卡：$GAN_TXT"
ckc "甘特卡给出平均进度" "平均 50%" "$GAN_TXT"
CAL_TXT=$(q "document.querySelector('[data-testid=\"hk-wb-calendar\"]').innerText.replace(/\\n/g,' / ')")
echo "    日历卡：$CAL_TXT"
ckc "日历卡列出今日日程" "今日评审" "$CAL_TXT"
ckn "日历卡不展示已取消的日程" "已取消的日程" "$CAL_TXT"
ORD=$(q "(()=>{const t=[...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid'));
  const i=t.indexOf('hk-workbench'); const j=t.findIndex(x=>x&&x.includes('recent'));
  return 'wb='+i+' recent='+j})()")
echo "    区块顺序：$ORD"
ck "工作台排在最近更新之前" "0" "$(q "(()=>{const t=[...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid'));
  const i=t.indexOf('hk-workbench'); const j=t.findIndex(x=>x&&x.includes('recent'));
  return (i>=0&&j>=0&&i<j)?'0':'1'})()")"

echo
echo "== 4. 文库内搜索卡（任务②）=="
R=$(q "(()=>{const card=document.querySelector('[data-testid=\"hk-dash-search\"]');
  if(!card)return 'no-card';
  const el=card.querySelector('input'); if(!el)return 'no-input';
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(el,'需求'); el.dispatchEvent(new Event('input',{bubbles:true}));
  const btn=card.querySelector('.ant-input-search-button')||card.querySelector('button');
  if(!btn)return 'no-btn'; btn.click(); return 'submitted'})()")
echo "    提交：$R"
"$AB" wait 2500 >/dev/null 2>&1
LOC=$(q "location.pathname+location.search")
echo "    跳转到：$LOC"
ckc "跳到搜索页并带上关键词" "q=%E9%9C%80%E6%B1%82" "$LOC"
shot "05-search.png"

echo
echo "== 5. 右键「移动」：跨知识库 + 多级子目录（任务③）=="
go "$BASE/book/$A" 3500
expandNode "产品库"
ctxDoc "散落文档"
MI=$(menuItems); echo "    文档右键菜单：$MI"
ckc "菜单含「移动」" "移动" "$MI"
ckc "菜单含「复制」" "复制" "$MI"
R=$(clickMenu "移动"); echo "    点击移动：$R"
"$AB" wait 1800 >/dev/null 2>&1
ckc "移动弹窗已弹出" "移动「散落文档」" "$(modalTitles)"
shot "06-move-modal.png"
R=$(pickTestId "移动「散落文档」" "hk-target-book" "归档库"); echo "    选目标库：$R"
"$AB" wait 1500 >/dev/null 2>&1
R=$(pickTreeTestId "移动「散落文档」" "hk-target-parent" "归档子层"); echo "    选多级目录：$R"
"$AB" wait 800 >/dev/null 2>&1
R=$(modalBtn "移动「散落文档」" "移动"); echo "    确认：$R"
"$AB" wait 3000 >/dev/null 2>&1
AF=$(fieldOf "$B" "$D2")
echo "    落库：$AF（期望 book=$B parent=$BC）"
ck "跨库移动到多级子目录" "book=$B parent=$BC" "$AF"
ckn "原库里已不含该文档" "散落文档" "$(docList "$A")"

echo
echo "== 6. 防环：移动目录时不得把自身/子孙列为目标（任务③）=="
go "$BASE/book/$A" 3500
expandNode "产品库"
ctxDoc "设计资料"
R=$(clickMenu "移动"); echo "    点击移动：$R"
"$AB" wait 1800 >/dev/null 2>&1
openSelect "移动「设计资料」" "hk-target-parent" >/dev/null
OPTS=$(treeOptions)
echo "    可选目标：$OPTS"
ckn "目标里不含被移动的目录自身" "设计资料" "$OPTS"
ckn "目标里不含其子孙（子目录）" "子目录" "$OPTS"
ckn "目标里不含其子孙（需求说明）" "需求说明" "$OPTS"
ckc "仍保留其它可选项" "拖拽对象" "$OPTS"
shot "07-move-cycle-guard.png"
closeMenus

echo
echo "== 7. 拖拽：落在目录节点中部 = 成为其子文档（任务③）=="
go "$BASE/book/$A" 3500
expandNode "产品库"
expandNode "设计资料"
DRAG=$(q "(()=>{const rows=[...document.querySelectorAll('.ant-tree-treenode')];
  const srcRow=rows.find(r=>r.textContent.includes('拖拽对象'));
  const dstRow=rows.find(r=>r.textContent.includes('设计资料'));
  if(!srcRow)return 'no-src'; if(!dstRow)return 'no-dst';
  const src=srcRow.querySelector('.ant-tree-node-content-wrapper');
  const dst=dstRow.querySelector('.ant-tree-node-content-wrapper');
  if(!src||!dst)return 'no-wrapper';
  const sb=src.getBoundingClientRect(), db=dst.getBoundingClientRect();
  const x=Math.round(sb.left+20);
  const sy=Math.round(sb.top+sb.height/2);
  const dy=Math.round(db.top+db.height*0.75); // 下半部 → rc-tree 判为「成为子节点」
  const dt=new DataTransfer();
  const ev=(t,el,yy)=>el.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:yy}));
  ev('dragstart',src,sy); ev('dragenter',dst,dy); ev('dragover',dst,dy); ev('drop',dst,dy);
  window.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
  return 'dragged'})()")
echo "    拖拽派发：$DRAG"
"$AB" wait 3000 >/dev/null 2>&1
AF=$(fieldOf "$A" "$D3")
echo "    落库：$AF（期望 book=$A parent=$F1）"
ck "拖到目录中部即成为其子文档" "book=$A parent=$F1" "$AF"
shot "08-after-drag.png"

echo
echo "== 8. 右键「复制」：目录连同子孙递归复制（任务③）=="
go "$BASE/book/$A" 3500
expandNode "产品库"
NB=$(docCount "$A")
ctxDoc "设计资料"
R=$(clickMenu "复制"); echo "    点击复制：$R"
"$AB" wait 1800 >/dev/null 2>&1
ckc "复制弹窗已弹出" "复制「设计资料」" "$(modalTitles)"
shot "09-copy-modal.png"
R=$(modalBtn "复制「设计资料」" "复制"); echo "    确认：$R"
"$AB" wait 3000 >/dev/null 2>&1
AFTER=$(docList "$A"); NA=$(docCount "$A")
echo "    新增文档数：$((NA-NB))（期望 4 = 目录本身 + 3 个子孙）"
echo "    当前目录：$AFTER"
ck "递归复制整棵子树（新增 4 篇）" "4" "$((NA-NB))"
ckc "副本标题带「 副本」后缀" "设计资料 副本" "$AFTER"
ckc "子文档标题不带后缀" "子目录" "$AFTER"
ckc "叶子被一并复制" "需求说明" "$AFTER"

echo
echo "== 9. 结果 =="
echo "  ✅ $PASS  ❌ $FAIL"
echo "  截图目录：$SHOTS"
[ "$FAIL" -eq 0 ] || { echo "E2E_WBDND_FAIL"; exit 1; }
echo "E2E_WBDND_PASS"
