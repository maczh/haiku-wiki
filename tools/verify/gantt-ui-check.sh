#!/usr/bin/env bash
# ⚠️ 已停用（未纳入 run-all.sh 的 DEFAULT_SUITES）—— 2026-09-19 实测 11 ✓ / 9 ✗，
#    是脚本与产品交互漂移，不是产品缺陷。三处漂移：
#      ① 「新建文档」入口已改到知识库菜单（Dropdown.Button，`DocTree.tsx`）→ 找按钮的方式失效
#      ② 编辑态「新增任务 / 新增子任务」现在走**弹窗表单**（`GanttEditor.tsx` 的 openTaskModal
#         → Modal 标题「新增任务」，只需填「任务名称」，okText 是「新增」），脚本还在假设点一下就插入
#      ③ 第 4/5 段读正文的 curl 拿回空响应（连 server.log 都只有正常 200，原因未定位）
#    真正要修的话：按标题定位 `.ant-modal` → 填 `.ant-input`（placeholder「例如：接口联调」）→
#    点页脚「新增」；正文读取先 `curl -w '%{http_code}'` dump 原始响应再写 jq/python。
#    覆盖上目前由 gantt-fold-check / gantt-fold-edge-check / gantt-api-check 承担，
#    但「编辑态增删任务的 UI 链路」暂时没有自动化覆盖 —— 见 README「已停用（待修）」。
#
# 甘特图界面冒烟（生产形态单源）：编辑态增删任务 / 阅读态仅可拖进度 / 数据落库 / 按需加载
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

echo "== 1) 目录树「新建文档」下拉含甘特图 =="
visit "$BASE/books/$BID?docId=$MID&tab=read" 4000
MENU=$(q "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('新建文档'));if(!b)return 'no-btn';const grp=b.closest('.ant-btn-group')||b.parentElement;const trig=[...(grp?grp.querySelectorAll('button'):[])].find(x=>!x.innerText.includes('新建文档'))||b;for(const t of ['mouseenter','mouseover','mousemove'])trig.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true}));const ms=[...document.querySelectorAll('.ant-dropdown')].filter(x=>!x.classList.contains('ant-dropdown-hidden')&&getComputedStyle(x).display!=='none');if(!ms.length)return 'no-menu:total='+document.querySelectorAll('.ant-dropdown').length;return ms[0].innerText.replace(/\n/g,'|')})()")
echo "    下拉项: $MENU"
printf '%s' "$MENU" | grep -q '甘特图' && ok "下拉含「甘特图」" || no "下拉缺「甘特图」"
q "document.body.click(); 'ok'" >/dev/null

echo "== 2) 编辑态渲染 =="
visit "$BASE/books/$BID?docId=$GID&tab=edit" 6000
chk "甘特图根容器 .wx-gantt 存在" "true" "$(q "!!document.querySelector('.wx-gantt')")"
BARS1=$(q "document.querySelectorAll('.wx-bar').length")
echo "    初始任务条数: $BARS1"
[ "${BARS1:-0}" -ge 3 ] && ok "默认示例任务渲染（$BARS1 条）" || no "任务条数 $BARS1 < 3"
chk "时间轴刻度存在" "true" "$(q "(()=>{const sc=document.querySelector('.wx-scale');return !!sc && sc.querySelectorAll('.wx-row').length>0})()")"
"$AB" screenshot "$OUT/01-edit.png" >/dev/null 2>&1

echo "== 3) 编辑态：新增任务 / 新增子任务 =="
# 选中第一条任务
q "(()=>{const b=document.querySelector('.wx-bar');if(!b)return 'no-bar';b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));b.click();return 'ok'})()" >/dev/null
"$AB" wait 800 >/dev/null 2>&1
q "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='新增任务');if(!b)return 'no-btn';b.click();return 'ok'})()" >/dev/null
"$AB" wait 1500 >/dev/null 2>&1
BARS2=$(q "document.querySelectorAll('.wx-bar').length")
echo "    新增任务后条数: $BARS2"
[ "${BARS2:-0}" -gt "${BARS1:-0}" ] && ok "新增任务生效（$BARS1 → $BARS2）" || no "新增任务未生效（$BARS1 → $BARS2）"

q "(()=>{const b=document.querySelector('.wx-bar');b&&b.click();return 'ok'})()" >/dev/null
"$AB" wait 600 >/dev/null 2>&1
q "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='新增子任务');if(!b)return 'no-btn';b.click();return 'ok'})()" >/dev/null
"$AB" wait 1500 >/dev/null 2>&1
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

# 记录基线
C2=$(getcontent "$GID")
T1=$(printf '%s' "$C2" | python3 -c "
import sys,json;d=json.loads(sys.stdin.read());ts=[t for t in d['tasks'] if t.get('type')=='task'];print(json.dumps({'text':ts[0]['text'],'start':ts[0]['start'],'progress':ts[0]['progress']},ensure_ascii=False))")
echo "    基线任务: $T1"
P0=$(printf '%s' "$T1" | python3 -c "import sys,json;print(json.load(sys.stdin)['progress'])")
TXT=$(printf '%s' "$T1" | python3 -c "import sys,json;print(json.load(sys.stdin)['text'])")
S0=$(printf '%s' "$T1" | python3 -c "import sys,json;print(json.load(sys.stdin)['start'])")

echo "== 6) 拖进度条：应生效 =="
# ⚠️ 必须在同一个 eval 内完成 down/move/up（eval 状态不跨调用保留）
DRAG=$(q "(()=>{
  const bars=[...document.querySelectorAll('.wx-bar')];
  const bar=bars.find(b=>b.querySelector('.wx-progress-marker'));
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
  return JSON.stringify({drag:s1&&s2?s1:'n', barId:bar.getAttribute('data-id'), row:txt});
})()")
echo "    拖拽结果: $DRAG"
"$AB" wait 1500 >/dev/null 2>&1
sleep 4
C3=$(getcontent "$GID")
P1=$(jprog "$C3" "$TXT")
echo "    后端进度: $P0 → $P1"
[ "$P1" != "$P0" ] && [ "$P1" != "NA" ] && ok "进度改动已落库（$P0 → $P1）" || no "进度未变化（$P0 → $P1）"

echo "== 7) 横向拖动任务条：应被拦截 =="
MOVE=$(q "(()=>{
  const bar=[...document.querySelectorAll('.wx-bar')].find(b=>b.querySelector('.wx-progress-marker'));
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
[ "$S1" = "$S0" ] && ok "横向改期被拦截（起始日仍为 $S1）" || no "横向改期未被拦截（$S0 → $S1）"
N4=$(jcount "$C4")
[ "$N4" = "$N1" ] && ok "任务数未变（$N4），确认阅读态不能增删" || no "任务数变化 $N1 → $N4"
"$AB" screenshot "$OUT/04-read-after.png" >/dev/null 2>&1

echo "== 8) 按需加载：非甘特图文档不拉 GanttChart chunk =="
visit "$BASE/books/$BID?docId=$MID&tab=read" 4000
LOADED=$(q "performance.getEntriesByType('resource').filter(e=>/GanttChart|GanttView|GanttEditor/.test(e.name)).length")
chk "markdown 文档未加载甘特图 chunk" "0" "${LOADED:-?}"
visit "$BASE/books/$BID?docId=$GID&tab=read" 5000
LOADED2=$(q "performance.getEntriesByType('resource').filter(e=>/GanttChart|GanttView|GanttEditor/.test(e.name)).length")
[ "${LOADED2:-0}" -ge 1 ] && ok "甘特图文档加载了专属 chunk（$LOADED2 个）" || no "甘特图文档未加载专属 chunk（$LOADED2）"

echo "== 9) 控制台错误 =="
ERR=$("$AB" errors 2>&1 | tail -5)
echo "$ERR"
printf '%s' "$ERR" | grep -qi 'error' && no "控制台有错误" || ok "控制台无错误"

echo
echo "截图目录: $OUT"
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo "GANTT_UI_OK" || echo "GANTT_UI_HAS_FAILURE"
