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
PORT=${PORT:-8131}
BASE=http://127.0.0.1:$PORT
OUT=$TMPDIR/gantt-fold-edge-$(date +%s); mkdir -p "$OUT"
# 前置检查（README「已知坑」第 5 条）：二进制存在 + 端口空闲。
# 端口被别的会话遗留实例占用时，本脚本会连上**别人的**服务、产出看似合理其实无效的结果。
[ -x "$BIN" ] || { echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi
DATA_DIR="$OUT" PORT=$PORT JWT_SECRET=ganttedge GIN_MODE=release "$BIN" >"$OUT/server.log" 2>&1 &
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

TOKEN=$(curl -s --noproxy '*' -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d '{"username":"e2","email":"e2@example.com","password":"secret123","name":"张三"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
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

# ============ 公开分享页（readonly，免登录）============
SLUG=$(curl -s --noproxy '*' "${A[@]}" -X PUT "$BASE/api/docs/$GID/share" -d '{"enabled":true}' | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')
echo "分享 slug=$SLUG"
[ -n "$SLUG" ] || { echo "❌ 分享创建失败"; exit 1; }

# 匿名访客：清掉登录态
"$AB" eval "localStorage.removeItem('hk_token'); 'ok'" >/dev/null 2>&1
"$AB" open "$BASE/doc-share/$SLUG" >/dev/null 2>&1; "$AB" wait 7000 >/dev/null 2>&1
echo "== 公开分享页（只读）=="
R0=$(q "$ROWS"); B0=$(q "$BARS"); GW0=$(q "$GWID"); TW0=$(q "$TWID"); BT0=$(q "$BTTN")
echo "   初始：表格行=$R0 条形=$B0 表格宽=$GW0 时间轴宽=$TW0 按钮=$BT0"
[ "$R0" -ge 5 ] && ok "只读态表格渲染多行（$R0 行）" || no "只读态表格只渲染 $R0 行"
chk "只读态折叠/展开按钮 2 个" "$BT0" "2"

echo "-- 只读态折叠右侧时间轴 --"
q "document.querySelector('.hk-gantt-fold-right').click(); 'ok'" >/dev/null; "$AB" wait 600 >/dev/null
R1=$(q "$ROWS"); TW1=$(q "$TWID"); GW1=$(q "$GWID"); D1=$(q "$FLDISP")
echo "   表格行=$R1(原 $R0) 表格宽=$GW1 时间轴宽=$TW1 display=$D1"
chk "★ 只读态右折叠：表格行数不变" "$R1" "$R0"
[ "$D1" != "none" ] && ok "只读态右折叠：时间轴非 display:none（$D1）" || no "只读态右折叠：时间轴被 display:none"
[ "$TW1" -lt 8 ] && ok "只读态右折叠：时间轴压到 0 宽" || no "只读态右折叠：时间轴宽 $TW1"
[ "$GW1" -gt $((GW0+200)) ] && ok "只读态右折叠：表格铺满（$GW0 -> $GW1）" || no "只读态右折叠：表格未铺满"

echo "-- 折叠态窗口缩放（1600x1000 -> 1180x760）--"
"$AB" set viewport 1180 760 >/dev/null 2>&1; "$AB" wait 1200 >/dev/null
R2=$(q "$ROWS"); TW2=$(q "$TWID"); GW2=$(q "$GWID")
echo "   表格行=$R2 表格宽=$GW2 时间轴宽=$TW2"
# 视口变矮 → 可见窗口本就变小（渲染行数是高度的函数），只要求未退化为 2 行量级
[ "$R2" -ge 15 ] && ok "缩放后：表格仍渲染足量行（$R2 行，未退化）" || no "缩放后：表格仅 $R2 行"
[ "$TW2" -lt 8 ] && ok "缩放后：时间轴仍为 0 宽" || no "缩放后：时间轴宽变为 $TW2"
[ "$GW2" -gt 400 ] && ok "缩放后：表格仍铺满（宽 $GW2）" || no "缩放后：表格宽异常（$GW2）"
"$AB" set viewport 1600 1000 >/dev/null 2>&1; "$AB" wait 900 >/dev/null

echo "-- 快速反复切换（折叠→展开→折叠，各间隔 150ms）--"
q "(function(){var f=document.querySelector('.hk-gantt-fold-right');if(f)f.click();setTimeout(function(){var r=document.querySelector('.hk-gantt-reopen-right');if(r)r.click()},150);setTimeout(function(){var f2=document.querySelector('.hk-gantt-fold-right');if(f2)f2.click()},300);return 'scheduled'})()" >/dev/null
"$AB" wait 1400 >/dev/null
C3=$(q "$RCLS"); R3=$(q "$ROWS"); TW3=$(q "$TWID"); BT3=$(q "$BTTN")
echo "   rightCollapsed=$C3 表格行=$R3 时间轴宽=$TW3 按钮=$BT3"
chk "快速切换后落到折叠态（right-collapsed=true）" "$C3" "true"
chk "快速切换后表格行数不变" "$R3" "$R0"
[ "$TW3" -lt 8 ] && ok "快速切换后时间轴为 0 宽" || no "快速切换后时间轴宽 $TW3"
chk "快速切换后只剩 1 个展开按钮" "$BT3" "1"

echo "-- 极限连点 6 轮（同一 JS 内折叠/展开混合，断言状态自洽不脱sync）--"
q "(function(){for(var i=0;i<6;i++){var a=document.querySelector('.hk-gantt-fold-right');if(a)a.click();var b=document.querySelector('.hk-gantt-reopen-right');if(b)b.click()}return 'ok'})()" >/dev/null
"$AB" wait 1000 >/dev/null
C5=$(q "$RCLS"); TW5=$(q "$TWID"); BT5=$(q "$BTTN"); R5=$(q "$ROWS")
echo "   rightCollapsed=$C5 时间轴宽=$TW5 按钮=$BT5 表格行=$R5"
if { [ "$C5" = "true" ] && [ "$TW5" -lt 8 ] && [ "$BT5" = "1" ]; } || { [ "$C5" = "false" ] && [ "$TW5" -gt 200 ] && [ "$BT5" = "2" ]; }; then
  ok "极限连点后类名/宽度/按钮三者自洽（$C5 / $TW5 / $BT5）"
else
  no "极限连点后状态不自洽（类名=$C5 宽=$TW5 按钮=$BT5）"
fi
chk "极限连点后表格行数不变" "$R5" "$R0"
# 回到折叠态，供后续「展开还原」承接
if [ "$C5" = "false" ]; then q "document.querySelector('.hk-gantt-fold-right').click(); 'ok'" >/dev/null; "$AB" wait 500 >/dev/null; fi

echo "-- 展开还原 --"
q "document.querySelector('.hk-gantt-reopen-right').click(); 'ok'" >/dev/null; "$AB" wait 600 >/dev/null
C4=$(q "$RCLS"); R4=$(q "$ROWS"); TW4=$(q "$TWID"); GW4=$(q "$GWID")
echo "   表格行=$R4 表格宽=$GW4 时间轴宽=$TW4 rightCollapsed=$C4"
chk "只读态展开：去掉 right-collapsed" "$C4" "false"
chk "只读态展开：表格行数不变" "$R4" "$R0"
[ "$TW4" -gt $((TW1+200)) ] && ok "只读态展开：时间轴宽度恢复（$TW1 -> $TW4）" || no "只读态展开：未恢复（$TW4）"

echo "-- 只读态左折叠（时间轴铺满、条形不变）--"
q "document.querySelector('.hk-gantt-fold-left').click(); 'ok'" >/dev/null; "$AB" wait 600 >/dev/null
GW5=$(q "$GWID"); TW5=$(q "$TWID"); B5=$(q "$BARS")
echo "   表格宽=$GW5 时间轴宽=$TW5 条形=$B5(原 $B0)"
[ "$GW5" -lt 8 ] && ok "只读态左折叠：表格收为 0 宽" || no "只读态左折叠：表格宽 $GW5"
chk "只读态左折叠：条形数量不变" "$B5" "$B0"
[ "$TW5" -gt $((TW0+200)) ] && ok "只读态左折叠：时间轴铺满（$TW0 -> $TW5）" || no "只读态左折叠：时间轴宽 $TW5"
"$AB" screenshot "$OUT/readonly-left-collapsed.png" >/dev/null 2>&1
q "document.querySelector('.hk-gantt-reopen-left').click(); 'ok'" >/dev/null; "$AB" wait 500 >/dev/null
"$AB" screenshot "$OUT/readonly-restored.png" >/dev/null 2>&1

echo "-- 控制台错误 --"
ERRS=$("$AB" errors 2>&1 | grep -v '^{}' | grep -ciE 'error|exception' || true)
echo "   错误条数=$ERRS"
[ "$ERRS" = "0" ] && ok "公开分享页全流程无控制台错误" || no "存在 $ERRS 条控制台错误"

echo "截图目录: $OUT"
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo "GANTT_FOLD_EDGE_OK" || echo "GANTT_FOLD_EDGE_FAIL"
