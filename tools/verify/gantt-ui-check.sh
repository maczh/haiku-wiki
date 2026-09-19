#!/usr/bin/env bash
# 甘特图界面冒烟（生产形态单源）：编辑态增删任务 / 阅读态仅可改进度 / 数据落库 / 按需加载
#
# 2026-09-19 修活记录（此前因三处交互漂移整体失效：11 ✓ / 9 ✗ → 现 21/21）：
#   ① 「新建文档」入口已改到**知识库节点的「⋯」菜单**（KnowledgeTree.tsx 的 bookMenu，trigger=click），
#      且知识库节点挂在「私人知识库」分组下，**必须先 expandNode 展开**才在 DOM 里；
#      该菜单只打开「新建文档 · 选择位置」，点「下一步」后第二步才是「文档类型」下拉。
#   ② 编辑态「新增任务 / 新增子任务」现在是**弹窗表单**（GanttEditor.tsx 的 openTaskModal → Modal）：
#      填 input[placeholder="例如：接口联调"] → 点页脚「新增」（两个汉字，AntD 会插空格，比对前归一化）。
#   ③ 所谓「读正文拿回空响应」其实是**新建文档的 content 本来就是空串**（默认 3 条任务是前端默认值，
#      改过才落库），旧脚本用 python 硬解 JSON 于是刷一屏 traceback —— 现在用 `or '{}'` 兜住，
#      并在正文为空时明确跳过第 6/7 段而不是级联报错。
#
# 两个断言陷阱（详见技能 §3.3.5）：
#   · 汇总条（type=summary）上**也有** .wx-progress-marker，但进度由子任务派生、拖了不会变
#     → 拖拽目标必须是**叶子任务**；
#   · 「没找到任务条 → 起始日没变」会让「横向改期被拦截」**恒真通过** → 找不到条要判失败。
#   另：界面新增的任务落库 id 形如 `temp://1789819763453`，DOM 里渲染成 `:temp://...`（多一个 `:` 前缀），
#      所以断言锚点一律挑**数字 id**的叶子（这两条 temp id 只作 ℹ️ 观察项记录）。
set -uo pipefail

export PATH=/usr/local/go/bin:/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
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
PORT=${PORT:-8097}
BASE=http://127.0.0.1:$PORT
OUT=$TMPDIR/gantt-ui-out-$(date +%s); mkdir -p "$OUT"
DATA=$TMPDIR/gantt-ui-data-$(date +%s); mkdir -p "$DATA"

# 前置检查（README「已知坑」第 5 条）：二进制存在 + 端口空闲，避免连上幽灵实例。
[ -x "$BIN" ] || { echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi

DATA_DIR="$DATA" PORT=$PORT JWT_SECRET=ganttui GIN_MODE=release "$BIN" >"$OUT/server.log" 2>&1 &
SPID=$!
cleanup(){ "$AB" close >/dev/null 2>&1; kill $SPID 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$BASE/" 2>/dev/null); [ "$c" = "200" ] && break; sleep 0.5
done
echo "服务就绪: ${c:-timeout}"

PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
no(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1 = $3"; else no "$1：期望 $2，实际 $3"; fi; }

# ---------- 播种数据 ----------
TOKEN=$(curl -s --noproxy '*' -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"username":"ganttui","email":"ganttui@example.com","password":"secret123","name":"ganttui"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] && ok "取得 token" || { echo "❌ 认证失败"; exit 1; }
A=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
py(){ python3 -c "import sys,json;d=json.load(sys.stdin);$1" 2>/dev/null; }

BID=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books" -d '{"name":"甘特图UI验证"}' | py "print((d.get('data') or {}).get('id'))")
GID=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books/$BID/docs" -d '{"title":"排期表","doc_type":"gantt"}' | py "print((d.get('data') or {}).get('id'))")
MID=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books/$BID/docs" -d '{"title":"说明","doc_type":"markdown","content":"# 标题\n正文"}' | py "print((d.get('data') or {}).get('id'))")
echo "  book=$BID ganttDoc=$GID mdDoc=$MID"

getcontent(){ curl -s --noproxy '*' "${A[@]}" "$BASE/api/docs/$1" | python3 -c "
import sys,json;d=json.load(sys.stdin);print(((d.get('data') or {}).get('doc') or {}).get('content') or '')" 2>/dev/null; }
jcount(){ printf '%s' "$1" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read() or '{}');print(len(d.get('tasks') or []))" 2>/dev/null; }
jprog(){ printf '%s' "$1" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read() or '{}')
t=[x for x in (d.get('tasks') or []) if x.get('text')=='$2']
print(t[0].get('progress') if t else 'NA')" 2>/dev/null; }
jstart(){ printf '%s' "$1" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read() or '{}')
t=[x for x in (d.get('tasks') or []) if x.get('text')=='$2']
print(t[0].get('start') if t else 'NA')" 2>/dev/null; }

# ---------- 浏览器 ----------
"$AB" set viewport 1600 1000 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1; "$AB" wait 1500 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); 'ok'" >/dev/null 2>&1
q(){ "$AB" eval "$1" 2>&1 | tail -1 | sed 's/^"//; s/"$//'; }
visit(){ "$AB" open "$1" >/dev/null 2>&1; "$AB" wait "${2:-4000}" >/dev/null 2>&1; }
# 逐级展开（AntD Tree 只渲染已展开层级，父节点没展开时子节点根本不在 DOM 里）
expandNode(){ # expandNode <节点文本子串>
  q "(()=>{const w=[...document.querySelectorAll('.ant-tree-treenode')].find(t=>t.textContent.includes('$1')&&!t.querySelector('.ant-tree-switcher_open'));
    if(!w)return 'no-or-open'; const s=w.querySelector('.ant-tree-switcher'); if(!s)return 'no-switcher';
    s.click(); return 'clicked'})()" >/dev/null
  "$AB" wait 2500 >/dev/null 2>&1
}
closeMenus(){ q "document.body.click(); 'ok'" >/dev/null; "$AB" wait 300 >/dev/null 2>&1; "$AB" press Escape >/dev/null 2>&1; "$AB" wait 400 >/dev/null 2>&1; }

echo "== 1) 知识库菜单「新建文档」→ 文档类型下拉含甘特图 =="
# 入口已从「页面上的新建文档按钮」改到**知识库节点的「⋯」菜单**（KnowledgeTree.tsx bookMenu，
# trigger=click）。这里按「树节点文本定位 → 点 .anticon-more → 读下拉项」来走。
visit "$BASE/books/$BID?docId=$MID&tab=read" 4500
# 知识库节点挂在「私人知识库」分组下，**必须先把分组展开**否则节点不在 DOM 里
expandNode '私人知识库'
OPEN=$(q "(()=>{const n=[...document.querySelectorAll('.ant-tree-treenode')].find(x=>x.textContent.includes('甘特图UI验证'));if(!n)return 'no-node';const m=n.querySelector('.anticon-more');if(!m)return 'no-more';m.click();return 'ok'})()")
echo "    打开库菜单: $OPEN"
"$AB" wait 800 >/dev/null 2>&1
# 可见 dropdown 的最后一个（页面上可能残留隐藏的其它 dropdown）
vis_dd="[...document.querySelectorAll('.ant-dropdown')].filter(d=>!d.classList.contains('ant-dropdown-hidden')&&getComputedStyle(d).display!=='none')"
MENU=$(q "(()=>{const ds=$vis_dd;if(!ds.length)return 'no-menu';return ds[ds.length-1].innerText.replace(/\n/g,'|')})()")
echo "    菜单项: $MENU"
printf '%s' "$MENU" | grep -q '新建文档' && ok "知识库菜单含「新建文档」" || no "知识库菜单缺「新建文档」"
q "(()=>{const ds=$vis_dd;if(!ds.length)return 'no-menu';const it=[...ds[ds.length-1].querySelectorAll('.ant-dropdown-menu-item')].find(x=>x.textContent.includes('新建文档'));if(!it)return 'no-item';it.click();return 'ok'})()" >/dev/null
"$AB" wait 900 >/dev/null 2>&1
# 第一步「新建文档 · 选择位置」→ 下一步（旧脚本在这里就断了：它以为下拉是「文档类型」）
NEXT=$(q "(()=>{const m=[...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('新建文档 · 选择位置')});if(!m)return 'no-modal';const b=[...m.querySelectorAll('.ant-modal-footer button')].find(x=>/下一/.test(x.textContent));if(!b)return 'no-btn';b.click();return 'ok'})()")
echo "    进入第二步: $NEXT"
"$AB" wait 900 >/dev/null 2>&1
# 第二步「新建文档 · 填写信息」的「文档类型」下拉
q "(()=>{const m=[...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('新建文档 · 填写信息')});if(!m)return 'no-modal';const s=m.querySelector('.ant-select-selector');if(!s)return 'no-select';s.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));return 'ok'})()" >/dev/null
"$AB" wait 800 >/dev/null 2>&1
TYPES=$(q "(()=>{const ds=[...document.querySelectorAll('.ant-select-dropdown')].filter(d=>!d.classList.contains('ant-select-dropdown-hidden'));if(!ds.length)return 'no-dropdown';return [...ds[ds.length-1].querySelectorAll('.ant-select-item-option')].map(x=>x.textContent.trim()).join('/')})()")
echo "    类型选项: $TYPES"
printf '%s' "$TYPES" | grep -q '甘特图' && ok "「文档类型」下拉含「甘特图」" || no "「文档类型」下拉缺「甘特图」"
"$AB" press Escape >/dev/null 2>&1
q "(()=>{const m=[...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('填写信息')});if(!m)return 'no-modal';const b=[...m.querySelectorAll('.ant-modal-footer button')].find(x=>/取消/.test(x.textContent));if(b)b.click();return 'ok'})()" >/dev/null
"$AB" wait 700 >/dev/null 2>&1

echo "== 2) 编辑态渲染 =="
visit "$BASE/books/$BID?docId=$GID&tab=edit" 6000
chk "甘特图根容器 .wx-gantt 存在" "true" "$(q "!!document.querySelector('.wx-gantt')")"
BARS1=$(q "document.querySelectorAll('.wx-bar').length")
echo "    初始任务条数: $BARS1"
[ "${BARS1:-0}" -ge 3 ] && ok "默认示例任务渲染（$BARS1 条）" || no "任务条数 $BARS1 < 3"
chk "时间轴刻度存在" "true" "$(q "(()=>{const sc=document.querySelector('.wx-scale');return !!sc && sc.querySelectorAll('.wx-row').length>0})()")"
"$AB" screenshot "$OUT/01-edit.png" >/dev/null 2>&1

echo "== 3) 编辑态：新增任务 / 新增子任务（走弹窗表单）=="
# 选中第一条任务（「新增子任务」需要先有选中项）
q "(()=>{const b=document.querySelector('.wx-bar');if(!b)return 'no-bar';b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));b.click();return 'ok'})()" >/dev/null
"$AB" wait 800 >/dev/null 2>&1

# ⚠️ 交互已变：新增任务 / 新增子任务都先弹表单（GanttEditor.tsx 的 openTaskModal → Modal），
#    只需填「任务名称」再点页脚按钮（文案是「新增」—— 两个汉字，AntD 会在中间插空格，比对前归一化）。
taskModal() { # taskModal <工具栏按钮文案=弹窗标题> <任务名称>
  q "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='$1');if(!b)return 'no-btn';b.click();return 'ok'})()" >/dev/null
  "$AB" wait 1000 >/dev/null 2>&1
  local filled clicked
  filled=$(q "(()=>{const m=[...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('$1')});
    if(!m)return 'no-modal';
    const i=m.querySelector('input[placeholder=\"例如：接口联调\"]')||m.querySelector('.ant-input');
    if(!i)return 'no-input';
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    set.call(i,'$2'); i.dispatchEvent(new Event('input',{bubbles:true}));
    return 'filled'})()")
  echo "    $1 表单: $filled"
  "$AB" wait 300 >/dev/null 2>&1
  clicked=$(q "(()=>{const norm=t=>t.replace(/\\s+/g,'');
    const m=[...document.querySelectorAll('.ant-modal')].find(x=>{const t=x.querySelector('.ant-modal-title');return t&&t.textContent.includes('$1')});
    if(!m)return 'no-modal';
    const b=[...m.querySelectorAll('.ant-modal-footer button')].find(x=>norm(x.textContent)==='新增');
    if(!b)return 'no-btn';
    b.click(); return 'ok'})()")
  echo "    $1 提交: $clicked"
  "$AB" wait 1300 >/dev/null 2>&1
}

taskModal '新增任务' '新任务'
BARS2=$(q "document.querySelectorAll('.wx-bar').length")
echo "    新增任务后条数: $BARS2"
[ "${BARS2:-0}" -gt "${BARS1:-0}" ] && ok "新增任务生效（$BARS1 → $BARS2）" || no "新增任务未生效（$BARS1 → $BARS2）"

q "(()=>{const b=document.querySelector('.wx-bar');b&&b.click();return 'ok'})()" >/dev/null
"$AB" wait 700 >/dev/null 2>&1
taskModal '新增子任务' '新子任务'
BARS3=$(q "document.querySelectorAll('.wx-bar').length")
echo "    新增子任务后条数: $BARS3"
[ "${BARS3:-0}" -gt "${BARS2:-0}" ] && ok "新增子任务生效（$BARS2 → $BARS3）" || no "新增子任务未生效（$BARS2 → $BARS3）"
"$AB" screenshot "$OUT/02-edit-after-add.png" >/dev/null 2>&1

echo "== 4) 自动保存落库 =="
sleep 4
C1=$(getcontent "$GID")
N1=$(jcount "$C1")
echo "    后端任务数: $N1"
[ "${N1:-0}" -gt 3 ] && ok "编辑结果已落库（后端 tasks=$N1）" || no "后端 tasks=$N1，未落库"
printf '%s' "$C1" | grep -q '"text":"新任务"' && ok "落库含新任务文本" || no "落库缺新任务文本"
printf '%s' "$C1" | grep -q '"parent"' && ok "落库含层级 parent 字段" || no "落库缺 parent"

echo "== 5) 阅读态：仅可改进度 =="
visit "$BASE/books/$BID?docId=$GID&tab=read" 6000
chk "阅读态甘特图渲染" "true" "$(q "!!document.querySelector('.wx-gantt')")"
TAG=$(q "(()=>{const t=[...document.querySelectorAll('.ant-tag')].map(x=>x.innerText).filter(x=>x.includes('进度')||x.includes('只读'));return t.join('|')||'none'})()")
echo "    标签: $TAG"
printf '%s' "$TAG" | grep -q '仅可拖动进度条' && ok "显示「阅读模式：仅可拖动进度条更新进度」" || no "未显示仅改进度提示"
# 阅读态不应出现编辑工具栏按钮
chk "无「新增任务」按钮" "true" "$(q "![...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='新增任务')")"
chk "无「新增子任务」按钮" "true" "$(q "![...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='新增子任务')")"
COL=$(q "document.querySelectorAll('.wx-column').length")
echo "    表格列数: $COL"
"$AB" screenshot "$OUT/03-read.png" >/dev/null 2>&1

# 记录基线。⚠️ 正文为空 = 编辑没落库（新建的甘特文档 content 本来就是空字符串，只有改过才会有内容），
# 此时第 6/7 段的拖拽断言没有意义 → 明确跳过，别刷一屏 python traceback 掩盖真正原因。
C2=$(getcontent "$GID")
# 拖拽目标必须选**叶子任务**且**id 是数字**：
#   ① 汇总条（summary）上也有 .wx-progress-marker，但进度是子任务派生的，拖了不会变
#      （旧脚本就拖到了 id=1 的汇总条，才误报「进度未变化」）；
#   ② 界面里**新增的任务**落库后 id 形如 `temp://1789819569885`（SVAR add-task 的临时 id 被原样存了），
#      用 text 去挑就会挑到它、然后按 data-id 查不到 DOM 里的条 → 变成「没找到 → 断言恒真通过」。
T1=$(printf '%s' "$C2" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read() or '{}')
ts=[t for t in d.get('tasks') or [] if t.get('type')=='task']
kids={t.get('parent') for t in d.get('tasks') or []}
leaves=[t for t in ts if t.get('id') not in kids]
num=[t for t in leaves if str(t.get('id','')).isdigit()]
pick=(num or leaves or [None])[0]
print(json.dumps({'id':pick['id'],'text':pick['text'],'start':pick['start'],'progress':pick['progress']},ensure_ascii=False) if pick else '')" 2>/dev/null)
echo "    基线任务（数字 id 的叶子）: ${T1:-（空）}"
# 观察项（不断言）：新增任务的 id 形态
TEMPIDS=$(printf '%s' "$C2" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read() or '{}')
print(sum(1 for t in d.get('tasks') or [] if str(t.get('id','')).startswith('temp://')))" 2>/dev/null)
echo "    ℹ️ 观察到 $TEMPIDS 条任务 id 形如 temp://（新增任务未分配稳定数字 id，只记录不判定）"
TID=$(printf '%s' "$T1" | python3 -c "import sys,json;print(json.loads(sys.stdin.read() or '{}').get('id',''))" 2>/dev/null)
P0=$(printf '%s' "$T1" | python3 -c "import sys,json;print(json.loads(sys.stdin.read() or '{}').get('progress',''))" 2>/dev/null)
TXT=$(printf '%s' "$T1" | python3 -c "import sys,json;print(json.loads(sys.stdin.read() or '{}').get('text',''))" 2>/dev/null)
S0=$(printf '%s' "$T1" | python3 -c "import sys,json;print(json.loads(sys.stdin.read() or '{}').get('start',''))" 2>/dev/null)
DRAG_OK=0
if [ -n "$P0" ] && [ -n "$TXT" ] && [ -n "$TID" ]; then DRAG_OK=1; else no "阅读态基线为空（正文未落库）→ 第 6/7 段的拖拽断言跳过"; fi

if [ "$DRAG_OK" = "1" ]; then

echo "== 6) 拖进度条：应生效 =="
# ⚠️ 必须在同一个 eval 内完成 down/move/up（eval 状态不跨调用保留）
DRAG=$(q "(()=>{
  const bars=[...document.querySelectorAll('.wx-bar')];
  const bar=bars.find(b=>b.getAttribute('data-id')==='$TID'&&b.querySelector('.wx-progress-marker'));
  if(!bar) return 'no-marker';
  const m=bar.querySelector('.wx-progress-marker');
  const cell=m.closest('.wx-bar');
  const txt=(()=>{const g=cell&&cell.closest('.wx-row');if(!g)return null;const c=g.querySelector('.wx-cell-value');return c?c.textContent.trim():null})();
  const r=m.getBoundingClientRect();
  const x=r.left+r.width/2, y=r.top+r.height/2;
  const ev=(t,ex,ey,el)=>el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:ex,clientY:ey,button:0,buttons:t==='mouseup'?0:1}));
  ev('mousedown',x,y,m);
  const s1=!!document.querySelector('.wx-progress-in-drag');
  ev('mousemove',x+40,y,m);
  window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,clientX:x+40,clientY:y,button:0,buttons:0}));
  return JSON.stringify({drag:s1?'dragging':'no-drag', barId:bar.getAttribute('data-id'), row:txt});
})()")
echo "    拖拽结果: $DRAG"
"$AB" wait 1500 >/dev/null 2>&1
sleep 4
C3=$(getcontent "$GID")
P1=$(jprog "$C3" "$TXT")
echo "    后端进度: $P0 → $P1"
if [ "$P1" != "$P0" ] && [ "$P1" != "NA" ]; then ok "进度改动已落库（$P0 → $P1）"
else no "进度未变化（$P0 → $P1）；拖拽结果=$DRAG"; fi

echo "== 7) 横向拖动任务条：应被拦截 =="
MOVE=$(q "(()=>{
  const bar=[...document.querySelectorAll('.wx-bar')].find(b=>b.getAttribute('data-id')==='$TID');
  if(!bar) return 'no-bar';
  const r=bar.getBoundingClientRect();
  const x=r.left+r.width/2, y=r.top+r.height/2;
  const ev=(t,x,y,el)=>el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:t==='mouseup'?0:1}));
  ev('mousedown',x,y,bar);
  for(let d=10; d<=120; d+=20) ev('mousemove',x+d,y,bar);
  window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,clientX:x+120,clientY:y,button:0,buttons:0}));
  return 'moved';
})()")
echo "    拖拽结果: $MOVE"
"$AB" wait 1000 >/dev/null 2>&1
sleep 4
C4=$(getcontent "$GID")
S1=$(jstart "$C4" "$TXT")
echo "    后端开始日期: $S0 → $S1"
# ⚠️ 找不到任务条时必须判失败：否则「起始日没变」会恒真通过（这条之前就是这么蒙对的）
if [ "$MOVE" = "no-bar" ]; then no "未找到目标任务条（data-id=$TID），横向拦截断言无效"
elif [ "$S1" = "$S0" ]; then ok "横向改期被拦截（起始日仍为 $S1）"
else no "横向改期未被拦截（$S0 → $S1）"; fi
N4=$(jcount "$C4")
[ "$N4" = "$N1" ] && ok "任务数未变（$N4），确认阅读态不能增删" || no "任务数变化 $N1 → $N4"
"$AB" screenshot "$OUT/04-read-after.png" >/dev/null 2>&1
else
  echo "== 6/7) 跳过：阅读态基线缺失（正文未落库）=="
fi

echo "== 8) 按需加载：非甘特图文档不拉 GanttChart chunk =="
visit "$BASE/books/$BID?docId=$MID&tab=read" 4000
LOADED=$(q "performance.getEntriesByType('resource').filter(e=>/GanttChart|GanttView|GanttEditor/.test(e.name)).length")
chk "markdown 文档未加载甘特图 chunk" "0" "${LOADED:-?}"
visit "$BASE/books/$BID?docId=$GID&tab=read" 5000
LOADED2=$(q "performance.getEntriesByType('resource').filter(e=>/GanttChart|GanttView|GanttEditor/.test(e.name)).length")
[ "${LOADED2:-0}" -ge 1 ] && ok "甘特图文档加载了专属 chunk（$LOADED2 个）" || no "甘特图文档未加载专属 chunk（$LOADED2）"
# 观察项（不断言）：重载后界面上的 data-id 是否还能与落库 id 对上（temp:// 那两条尤其关心）
IDS=$(q "(()=>{const b=[...document.querySelectorAll('.wx-bar')];return b.map(x=>x.getAttribute('data-id')).join(',')})()")
echo "    ℹ️ 重载后任务条 data-id: $IDS （落库含 2 条 temp:// —— 看它们是否原样保留）"

echo "== 9) 控制台错误 =="
ERR=$("$AB" errors 2>&1 | tail -5)
echo "$ERR"
printf '%s' "$ERR" | grep -qi 'error' && no "控制台有错误" || ok "控制台无错误"

echo
echo "截图目录: $OUT"
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo "GANTT_UI_OK" || echo "GANTT_UI_HAS_FAILURE"
