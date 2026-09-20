#!/usr/bin/env bash
# Mermaid 八种图 × 两种场景（编辑态 / 阅读态）渲染验证。
#
# 覆盖：flowchart / sequenceDiagram / classDiagram / gantt / erDiagram /
#       timeline / pie / mindmap —— 需求 P0-6 点名的全部类型。
#
# 判定：每个 mermaid 代码块渲染成功时，Vditor 会把 <svg> 注入该容器并把
#       data-processed 置为 "true"；渲染失败时会写入一段错误文本而**不产生** svg。
#       所以「容器有 svg」就是成功判据（不需要匹配错误文案）。
#
# 数据：仓库夹具 fixtures/e2e-data 的临时副本（服务端会写库，夹具本体不变）。
set -uo pipefail

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro
export TMPDIR=/home/macro/.workbuddy/tmp
export XDG_RUNTIME_DIR=/home/macro/.workbuddy/tmp/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars,--window-size=1560,900"
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR"

AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PORT=${PORT:-18086}
BASE=http://127.0.0.1:$PORT
BIN=${BIN:-/home/macro/.workbuddy/tmp/haiku-wiki}
TS=$(date +%s)
OUT=$TMPDIR/mermaid-out-$TS
mkdir -p "$OUT"

DATA=$TMPDIR/mermaid-data-$TS
cp -r "$HERE/fixtures/e2e-data/." "$DATA/"

# ---------- 八种图样例 ----------
MD=$TMPDIR/mermaid-sample-$TS.md
cat > "$MD" <<'MDEOF'
# Mermaid 八种图验证

## 1 流程图 flowchart

```mermaid
flowchart LR
  A[开始] --> B{是否有空包厢}
  B -->|是| C[开台]
  B -->|否| D[排队等位]
  C --> E[点单]
  D --> E
```

## 2 时序图 sequenceDiagram

```mermaid
sequenceDiagram
  actor Op as 服务员
  participant FE as 前端POS
  participant OM as 订单模块
  Op->>FE: 扫码开台
  FE->>OM: 创建订单
  OM-->>FE: 返回订单号
  FE-->>Op: 显示成功
```

## 3 类图 classDiagram

```mermaid
classDiagram
  class 订单 {
    +String 订单号
    +int 金额
    +开台()
    +结账()
  }
  class 支付 {
    +String 流水号
    +支付()
  }
  订单 --> 支付 : 使用
```

## 4 甘特图 gantt

```mermaid
gantt
  title 门店系统上线计划
  dateFormat YYYY-MM-DD
  section 设计
  需求调研 :a1, 2026-01-01, 7d
  原型评审 :a2, after a1, 3d
  section 开发
  后端开发 :a3, after a2, 14d
  前端开发 :a4, after a2, 12d
```

## 5 ER 图 erDiagram

```mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : 下单
  ORDER ||--|{ LINE_ITEM : 包含
  CUSTOMER {
    string 姓名
    string 手机号
  }
  ORDER {
    string 订单号
    int 金额
  }
```

## 6 时间线 timeline

```mermaid
timeline
  title 项目里程碑
  2026-01 : 立项
  2026-03 : 内测
  2026-06 : 上线
```

## 7 饼图 pie

```mermaid
pie title 订单渠道占比
  "门店" : 45
  "外卖" : 30
  "小程序" : 25
```

## 8 思维导图 mindmap

```mermaid
mindmap
  root((火锅业务))
    门店
      直营
      加盟
    供应链
      采购
      仓储
    会员
      等级
      积分
```
MDEOF

# ---------- 起服务 ----------
CONF_DIR="$(cd "$HERE/../.." && pwd)/conf" DATA_DIR="$DATA" PORT=$PORT DB_DRIVER=sqlite GIN_MODE=release \
  "$BIN" > "$OUT/server.log" 2>&1 &
SRV=$!
cleanup() { kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; }
trap cleanup EXIT

for i in $(seq 1 40); do
  c=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books")
  [ "$c" != "000" ] && break
  sleep 0.25
done

TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then echo "❌ 登录失败"; exit 1; fi

# ---------- 建文档 ----------
DOC=$(curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"title":"Mermaid八图","doc_type":"markdown"}' | jq -r '.data.id')
python3 - "$MD" > "$TMPDIR/mermaid-body-$TS.json" <<'PY'
import json, sys
print(json.dumps({"content": open(sys.argv[1]).read()}))
PY
curl --noproxy '*' -s -X PATCH "$BASE/api/docs/$DOC" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data @"$TMPDIR/mermaid-body-$TS.json" > /dev/null

"$AB" set viewport 1560 900 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1
"$AB" wait 1500 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', '$TOKEN'); 'ok'" >/dev/null 2>&1
"$AB" errors --clear >/dev/null 2>&1

pass=0; fail=0
q() { "$AB" eval "$1" 2>&1 | tail -1 | sed 's/^"//; s/"$//'; }

# 逐图判定（兼容两种容器排布）：
#  · 阅读态：每个图 1 个容器，容器内有 svg → 成功；
#  · 编辑态（Vditor IR）：每个图 **2 个**容器 —— 可编辑的源码块 + 渲染出的预览块，
#    后者才有 svg。因此对第 i 个图，只要它那组容器里有任意一个带 svg 即算成功。
# 另：mermaid 渲染失败时会往容器里写一段带 `text-align: left` 的错误块，一并统计。
PROBE="(function(){
 var ns=[].slice.call(document.querySelectorAll('.language-mermaid'));
 var g=Math.max(1,Math.round(ns.length/8));
 var out=[];
 for(var i=0;i<8;i++){
   var ok=false, err=false;
   for(var k=i*g;k<(i+1)*g && k<ns.length;k++){
     if(ns[k].querySelector('svg')) ok=true;
     if((ns[k].innerHTML||'').indexOf('text-align: left')>=0) err=true;
   }
   out.push(err?'ERR':(ok?'ok':'NO-SVG'));
 }
 return out.join(',');
})()"

# 每种图的「标志文字」是否真的出现在渲染产物里。
# 这条是给 `<foreignObject>` 问题的回归哨兵：DOMPurify 若整体清洗含 mermaid 产物的
# DOM，会连 `<foreignObject>` 及其文字一起删掉 —— 结果是「图还在、文字全丢、无报错」。
# 仅有 svg 不能证明文字还在，所以逐类型断言标志文字。
TEXT_PROBE="(function(){
 var ns=[].slice.call(document.querySelectorAll('.language-mermaid'));
 var g=Math.max(1,Math.round(ns.length/8));
 var marks=['开台','前端POS','订单','门店系统上线计划','CUSTOMER','项目里程碑','门店','火锅业务'];
 var out=[];
 for(var i=0;i<marks.length;i++){
   var found=false;
   for(var k=i*g;k<(i+1)*g && k<ns.length;k++){
     var svg=ns[k].querySelector('svg');
     if(svg && (svg.textContent||'').indexOf(marks[i])>=0){ found=true; break; }
   }
   out.push(found?'ok':'NO-TEXT');
 }
 return out.join(',');
})()"

check() { # 场景名 等待毫秒
  local label=$1
  "$AB" wait "${2:-8000}" >/dev/null 2>&1
  local n res txt
  n=$(q "document.querySelectorAll('.language-mermaid').length")
  res=$(q "$PROBE")
  txt=$(q "$TEXT_PROBE")
  echo "  -- $label --"
  echo "     容器数: $n   逐图(1..8): $res"
  echo "     标志文字: $txt"
  local i one
  for i in 0 1 2 3 4 5 6 7; do
    one=$(echo "$res" | cut -d, -f$((i+1)))
    case "$one" in
      ok)  echo "     ✅ 第 $((i+1)) 图 渲染"; pass=$((pass+1));;
      ERR) echo "     ❌ 第 $((i+1)) 图语法/渲染报错"; fail=$((fail+1));;
      *)   echo "     ❌ 第 $((i+1)) 图未产出 svg"; fail=$((fail+1));;
    esac
    local t
    t=$(echo "$txt" | cut -d, -f$((i+1)))
    if [ "$t" = "ok" ]; then echo "     ✅ 第 $((i+1)) 图 文字保留"; pass=$((pass+1));
    else echo "     ❌ 第 $((i+1)) 图 标志文字丢失（foreignObject 被清）"; fail=$((fail+1)); fi
  done
}

echo "======== 编辑态 ========"
"$AB" open "$BASE/books/1?docId=$DOC&tab=edit" >/dev/null 2>&1
check "Vditor 编辑"
"$AB" screenshot "$OUT/edit.png" >/dev/null 2>&1

echo "======== 阅读态 ========"
"$AB" open "$BASE/books/1?docId=$DOC&tab=read" >/dev/null 2>&1
check "Markdown 阅读"
"$AB" screenshot "$OUT/read.png" >/dev/null 2>&1

echo "======== 控制台错误 ========"
"$AB" errors 2>&1 | head -8

echo
echo "PASS=$pass FAIL=$fail"
echo "截图: $OUT/edit.png / $OUT/read.png"
echo "服务日志: $OUT/server.log"
[ "$fail" -eq 0 ] && echo "RESULT: ALL_OK" || echo "RESULT: FAILED"
[ "$fail" -eq 0 ]
