#!/usr/bin/env bash
# 甘特图 左表格/右时间轴 折叠验证（v8：改用 SVAR 原生 displayMode）
#
# 核心回归点：折叠右侧时间轴后，左侧表格**不得丢行**
#   —— 旧实现用 display:none 藏时间轴，导致其可见区测量归零、左表格行数 12 → 2。
set -uo pipefail
export PATH=/usr/local/go/bin:/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro TMPDIR=/home/macro/.workbuddy/tmp
export XDG_RUNTIME_DIR=$TMPDIR/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars,--window-size=1600,1000"
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR"
AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser
BIN=$TMPDIR/haiku-wiki
BASE=http://127.0.0.1:8112
PORT=8112
OUT=$TMPDIR/gantt-fold-check-$(date +%s); mkdir -p "$OUT"
DATA_DIR="$OUT" PORT=$PORT JWT_SECRET=ganttfold GIN_MODE=release "$BIN" >"$OUT/server.log" 2>&1 &
SPID=$!
cleanup(){ "$AB" close >/dev/null 2>&1; kill $SPID 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT
for _ in $(seq 1 60); do c=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$BASE/"); [ "$c" = "200" ] && break; sleep 0.5; done
echo "服务就绪: $c"
q(){ "$AB" eval "$1" 2>&1 | grep -v '^{}' | tail -1 | sed -e 's/^"//' -e 's/"$//'; }
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
no(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
chk(){ [ "$2" = "$3" ] && ok "$1（$2）" || no "$1：期望 $3 实际 $2"; }

TOKEN=$(curl -s --noproxy '*' -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d '{"username":"f2","email":"f2@example.com","password":"secret123","name":"张三"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
A=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
BID=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books" -d '{"name":"b"}' | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('id'))")
GID=$(curl -s --noproxy '*' "${A[@]}" -X POST "$BASE/api/books/$BID/docs" -d '{"title":"x","doc_type":"gantt"}' | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('id'))")
TODAY=$(date +%F)
# 30 个任务（4 个展开的汇总父 + 子）：既多于视口行数（可滚动），又用于暴露「折叠后丢行」
CONTENT=$(python3 - "$TODAY" <<'EOF'
import sys, json
from datetime import date, timedelta
today = date.fromisoformat(sys.argv[1]); d = lambda n: (today + timedelta(days=n)).isoformat()
tasks = [{"id":1,"text":"IoT系统","start":d(-10),"duration":180,"progress":70,"type":"summary","parent":0,"priority":5,"assignees":["念小义"],"details":"父任务","open":True}]
specs = [("云端",0),("门店端",0),
         ("RIS点餐系统",0),("后端",4),("菜品模块",4),("订单模块",4),("前厅模块",4),("支付模块",4),("报表模块",4),
         ("数据中台",0),("采集",8),("清洗",8),("指标",8),("血缘",8),("质量",8),
         ("门店小程序",0),("下单",16),("支付",16),("配送",16),("评价",16),("会员",16),("优惠券",16)]
i = 2
for name, parent in specs:
    tasks.append({"id":i,"text":name,"start":d(-5+i),"duration":10+(i%9),"progress":(i*7)%100,"type":"task","parent":parent,"priority":(i%10)+1,"assignees":["张良福","李四","王五"],"details":name+" 的说明"})
    i += 1
for t in tasks:
    if t["id"] in (4, 8, 16): t["type"] = "summary"; t["open"] = True
print(json.dumps({"version":1,"tasks":tasks,"links":[]}, ensure_ascii=False))
EOF
)
curl -s --noproxy '*' "${A[@]}" -X PATCH "$BASE/api/docs/$GID" -d "$(python3 -c "import json,sys;print(json.dumps({'content':sys.argv[1],'source':'manual'}))" "$CONTENT")" >/dev/null

"$AB" set viewport 1600 1000 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1; "$AB" wait 1500 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); 'ok'" >/dev/null 2>&1

# 通用取值（选择器均以真实 DOM 探针确认过）
ROWS="document.querySelectorAll('.hk-gantt .wx-table .wx-body .wx-row').length"
BARS="document.querySelectorAll('.hk-gantt .wx-bar').length"
TWID="Math.round(parseFloat(getComputedStyle(document.querySelector('.hk-gantt .wx-layout > .wx-content')).width))"
GWID="Math.round(parseFloat(getComputedStyle(document.querySelector('.hk-gantt .wx-layout > .wx-table-container')).width))"
FLDISP="getComputedStyle(document.querySelector('.hk-gantt .wx-layout > .wx-content')).display"
GCLS="document.querySelector('.hk-gantt').classList.contains('hk-gantt-left-collapsed')"
RCLS="document.querySelector('.hk-gantt').classList.contains('hk-gantt-right-collapsed')"
BTTN="document.querySelectorAll('.hk-gantt-fold, .hk-gantt-reopen').length"

# ============ 阅读模式（用户截图场景）============
echo "== 阅读模式（progress，30 个任务）=="
"$AB" open "$BASE/books/$BID?docId=$GID&tab=read" >/dev/null 2>&1; "$AB" wait 7000 >/dev/null 2>&1
R0=$(q "$ROWS"); B0=$(q "$BARS"); GW0=$(q "$GWID"); TW0=$(q "$TWID"); BT0=$(q "$BTTN")
SC=$(q "(()=>{const g=document.querySelector('.hk-gantt .wx-gantt');return g?[g.scrollHeight,g.clientHeight].join('/'):'-'})()")
echo "   初始：表格行=$R0 条形=$B0 表格宽=$GW0 时间轴宽=$TW0 按钮=$BT0 滚动域(h/视)=$SC"
[ "$R0" -ge 5 ] && ok "初始表格渲染多行（虚拟化生效，$R0 行）" || no "初始表格只渲染 $R0 行"
chk "初始折叠/展开按钮 2 个" "$BT0" "2"

hoverbar(){ q "(()=>{const bar=document.querySelector('.hk-gantt .wx-bar[data-id=\"$1\"]');if(!bar)return 'no-bar';const r=bar.getBoundingClientRect();if(r.width<2||r.height<2)return 'degenerate';const cx=r.left+r.width/2,cy=r.top+r.height/2;const top=document.elementFromPoint(cx,cy);if(!top)return 'no-top';top.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:cx,clientY:cy}));return 'ok'})()"; }

echo "-- 常态悬停气泡（v6 基线）--"
H=$(hoverbar 2); "$AB" wait 400 >/dev/null
TIP=$(q "(()=>{const t=document.querySelector('.hk-gantt-tip');return t?('TIP:'+t.querySelector('.hk-gantt-tip-title').innerText):'no-tip'})()")
echo "   hover=$H -> $TIP"
printf '%s' "$TIP" | grep -q '^TIP:' && ok "常态悬停气泡正常" || no "常态悬停气泡异常（$H）"

echo "-- 折叠右侧时间轴 --"
q "document.querySelector('.hk-gantt-fold-right').click(); 'ok'" >/dev/null; "$AB" wait 500 >/dev/null
R1=$(q "$ROWS"); B1=$(q "$BARS"); TW1=$(q "$TWID"); GW1=$(q "$GWID"); D1=$(q "$FLDISP"); C1=$(q "$RCLS"); BO1=$(q "!!document.querySelector('.hk-gantt-reopen-right')")
echo "   表格行=$R1(原 $R0) 表格宽=$GW1 时间轴宽=$TW1 时间轴display=$D1 rightCollapsed=$C1 展开按钮=$BO1"
chk "右折叠：根加 hk-gantt-right-collapsed" "$C1" "true"
chk "★ 右折叠：左侧表格行数不变（原缺陷 12→2）" "$R1" "$R0"
[ "$D1" != "none" ] && ok "右折叠：时间轴未被 display:none 藏起（原缺陷根因，$D1）" || no "右折叠：时间轴仍被 display:none 隐藏"
[ "$TW1" -lt 8 ] && ok "右折叠：时间轴被压到 0 宽（$TW0 -> $TW1）" || no "右折叠：时间轴未收起（宽 $TW1）"
[ "$GW1" -gt $((GW0+200)) ] && ok "右折叠：左表格铺满剩余宽度（$GW0 -> $GW1）" || no "右折叠：左表格未铺满（$GW0 -> $GW1）"
chk "右折叠：出现「展开右侧时间轴」按钮" "$BO1" "true"
"$AB" screenshot "$OUT/read-right-collapsed.png" >/dev/null 2>&1

echo "-- 折叠态纵向滚动仍可用（行虚拟化未失效）--"
BEFORE_FIRST=$(q "(()=>{const r=document.querySelector('.hk-gantt .wx-table .wx-body .wx-row');return r?r.innerText.trim().replace(/\s+/g,' '):'-'})()")
ST=$(q "(()=>{const g=document.querySelector('.hk-gantt .wx-gantt');g.scrollTop=400;g.dispatchEvent(new Event('scroll'));return Math.round(g.scrollTop)+'/'+g.scrollHeight})()")
"$AB" wait 600 >/dev/null
AFTER_FIRST=$(q "(()=>{const r=document.querySelector('.hk-gantt .wx-table .wx-body .wx-row');return r?r.innerText.trim().replace(/\s+/g,' '):'-'})()")
RSC=$(q "$ROWS")
echo "   scrollTop/h=$ST 首行 '$BEFORE_FIRST' -> '$AFTER_FIRST'，行数=$RSC"
[ "$BEFORE_FIRST" != "$AFTER_FIRST" ] && ok "折叠态滚动后首行内容变化（纵向滚动可用）" || no "折叠态滚动无效（首行未变，scrollTop=$ST）"
[ "$RSC" -ge 15 ] && ok "折叠态滚动后仍渲染足量行（$RSC 行，未退化为 2 行）" || no "折叠态滚动后行数异常（$RSC 行）"
STV=$(printf '%s' "$ST" | cut -d/ -f1)
[ "$STV" -gt 0 ] && ok "折叠态滚动真实生效（scrollTop=$STV）" || no "折叠态 scrollTop 仍为 0（无内部滚动）"
q "(()=>{const g=document.querySelector('.hk-gantt .wx-gantt');g.scrollTop=0;g.dispatchEvent(new Event('scroll'));return 1})()" >/dev/null
"$AB" wait 400 >/dev/null

echo "-- 展开右侧时间轴 --"
q "document.querySelector('.hk-gantt-reopen-right').click(); 'ok'" >/dev/null; "$AB" wait 500 >/dev/null
R2=$(q "$ROWS"); B2=$(q "$BARS"); TW2=$(q "$TWID"); C2=$(q "$RCLS"); BT2=$(q "$BTTN")
echo "   表格行=$R2 条形=$B2(原 $B0) 时间轴宽=$TW2 rightCollapsed=$C2 按钮=$BT2"
chk "展开右：去掉 right-collapsed" "$C2" "false"
chk "展开右：表格行数不变" "$R2" "$R0"
chk "展开右：条形数量不变" "$B2" "$B0"
[ "$TW2" -gt $((TW1+200)) ] && ok "展开右：时间轴宽度恢复（$TW1 -> $TW2）" || no "展开右：时间轴未恢复（$TW1 -> $TW2）"
chk "展开右：恢复两个折叠按钮" "$BT2" "2"

echo "-- 折叠左侧表格（气泡仍须可用：条形可见）--"
q "document.querySelector('.hk-gantt-fold-left').click(); 'ok'" >/dev/null; "$AB" wait 500 >/dev/null
C3=$(q "$GCLS"); GW3=$(q "$GWID"); TW3=$(q "$TWID"); B3=$(q "$BARS"); BO3=$(q "!!document.querySelector('.hk-gantt-reopen-left')")
echo "   表格宽=$GW3 时间轴宽=$TW3 条形=$B3 leftCollapsed=$C3 展开按钮=$BO3"
chk "左折叠：根加 hk-gantt-left-collapsed" "$C3" "true"
[ "$GW3" -lt 8 ] && ok "左折叠：表格宽度收为 0（$GW0 -> $GW3）" || no "左折叠：表格未收起（宽 $GW3）"
[ "$TW3" -gt $((TW0+200)) ] && ok "左折叠：时间轴铺满（$TW0 -> $TW3）" || no "左折叠：时间轴未铺满（$TW0 -> $TW3）"
chk "左折叠：条形数量不变" "$B3" "$B0"
chk "左折叠：出现「展开左侧表格」按钮" "$BO3" "true"
H2=$(hoverbar 2); "$AB" wait 400 >/dev/null
TIP2=$(q "(()=>{const t=document.querySelector('.hk-gantt-tip');return t?('TIP:'+t.querySelector('.hk-gantt-tip-title').innerText):'no-tip'})()")
echo "   hover=$H2 -> $TIP2"
printf '%s' "$TIP2" | grep -q '^TIP:' && ok "左折叠态悬停气泡正常（v6 无回归）" || no "左折叠态悬停气泡异常（$H2）"
"$AB" screenshot "$OUT/read-left-collapsed.png" >/dev/null 2>&1

echo "-- 展开左侧表格 --"
q "document.querySelector('.hk-gantt-reopen-left').click(); 'ok'" >/dev/null; "$AB" wait 500 >/dev/null
C4=$(q "$GCLS"); R4=$(q "$ROWS"); GW4=$(q "$GWID")
echo "   表格行=$R4 表格宽=$GW4 leftCollapsed=$C4"
chk "展开左：去掉 left-collapsed" "$C4" "false"
chk "展开左：表格行数不变" "$R4" "$R0"
[ "$GW4" -gt $((GW3+200)) ] && ok "展开左：表格宽度恢复（$GW3 -> $GW4）" || no "展开左：表格未恢复（$GW3 -> $GW4）"

# ============ 编辑模式 ============
echo "== 编辑模式（edit，含 add-task 列）=="
"$AB" open "$BASE/books/$BID?docId=$GID&tab=edit" >/dev/null 2>&1; "$AB" wait 7000 >/dev/null 2>&1
ER0=$(q "$ROWS"); EB0=$(q "$BARS"); EGW0=$(q "$GWID"); ETW0=$(q "$TWID")
echo "   初始：表格行=$ER0 条形=$EB0 表格宽=$EGW0 时间轴宽=$ETW0"
[ "$ER0" -ge 5 ] && ok "编辑态初始渲染多行（$ER0 行）" || no "编辑态初始只渲染 $ER0 行"
q "document.querySelector('.hk-gantt-fold-left').click(); 'ok'" >/dev/null; "$AB" wait 500 >/dev/null
EGW1=$(q "$GWID"); ETW1=$(q "$TWID")
echo "   左折叠后：表格宽=$EGW1 时间轴宽=$ETW1"
[ "$EGW1" -lt 4 ] && ok "编辑态左折叠：37px「+」列残留被收干净（宽 $EGW1）" || no "编辑态左折叠：残留 $EGW1 px"
q "document.querySelector('.hk-gantt-reopen-left').click(); 'ok'" >/dev/null; "$AB" wait 500 >/dev/null
q "document.querySelector('.hk-gantt-fold-right').click(); 'ok'" >/dev/null; "$AB" wait 500 >/dev/null
ER1=$(q "$ROWS"); ETW2=$(q "$TWID")
echo "   右折叠后：表格行=$ER1(原 $ER0) 时间轴宽=$ETW2"
chk "★ 编辑态右折叠：表格行数不变" "$ER1" "$ER0"
"$AB" screenshot "$OUT/edit-right-collapsed.png" >/dev/null 2>&1

echo "-- 控制台错误 --"
ERRS=$("$AB" errors 2>&1 | grep -v '^{}' | grep -ciE 'error|exception' || true)
echo "   错误条数=$ERRS"
[ "$ERRS" = "0" ] && ok "全流程无控制台错误" || no "存在 $ERRS 条控制台错误"

echo "截图目录: $OUT"
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo "GANTT_FOLD_OK" || echo "GANTT_FOLD_FAIL"
