#!/usr/bin/env bash
# 回归：编辑/阅读态来回切换时，OnlyOffice 单例 EditorManager 被并发 destroy 重置，
# 残留在途的 create() 恢复后会惰性 openNew() 出「New Document.docx」幽灵 Word 编辑器，
# 顶掉正确的 sheet/word/ppt 编辑器，并把错误的 .docx 引用写进正文。
# 本套件对三种办公文档各做一次「新建 → 保存 → 反复切换 → 再保存」，断言：
#   1) 切换后编辑态挂载的 iframe 必须是对应 app（spreadsheet/word/presentation），绝不退化成 Word；
#   2) 落库正文引用的 filename/ext 必须与 docType 一致。
#
# 前置：先构建出生产形态二进制（tools/build/build-embed.sh）。
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
PORT=${PORT:-18095}
BASE=http://127.0.0.1:$PORT
TS=$(date +%s)
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
FIX=${FIXTURE_DIR:-$HERE/fixtures/e2e-data}
DATA=/home/macro/.workbuddy/tmp/toggle-data-$TS
OUT=/home/macro/.workbuddy/tmp/toggle-out-$TS
BIN=${HAIKU_BIN:-/home/macro/.workbuddy/tmp/haiku-wiki}
mkdir -p "$OUT"
[ -d "$FIX" ] || { echo "❌ 找不到夹具目录 $FIX"; exit 1; }
[ -x "$BIN" ] || { echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/api/books" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi

cp -r "$FIX/." "$DATA/"
DATA_DIR="$DATA" PORT=$PORT JWT_SECRET=e2e-secret-for-verify GIN_MODE=release "$BIN" >"$OUT/server.log" 2>&1 &
SPID=$!
cleanup() { "$AB" close >/dev/null 2>&1; kill "$SPID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 80); do
  code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books" 2>/dev/null)
  [ "$code" != "000" ] && [ -n "$code" ] && break
  sleep 0.25
done
echo "服务就绪：HTTP $code"

TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" \
  -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then echo "❌ 登录失败"; tail -10 "$OUT/server.log"; exit 1; fi
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

"$AB" set viewport 1560 900 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1; "$AB" wait 1500 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', '${TOKEN}'); 'ok'" >/dev/null 2>&1

q()   { "$AB" eval "$1" 2>/dev/null | tail -1; }
clk() { q "(function(){var bs=[].slice.call(document.querySelectorAll('button,a'));var b=bs.find(function(x){return x.innerText.trim()==='$1'});if(!b)return 'no-btn';b.click();return 'ok'})()"; }
iframe_app() { q "(function(){var f=document.querySelector('iframe[name=frameEditor]');if(!f)return 'none';var m=f.src.match(/\\/apps\\/([a-z]+)editor/);return m?m[1]:'no-app'})()" | sed -E 's/^"|"$//g'; }
# 累积崩溃的关键指标：#ONLYOFFICE_ID 容器内残留的 editor iframe 数量（正常恒为 1，bug 下会随切换累积到 2/3/...）
frame_count() { q "(function(){var c=document.getElementById('ONLYOFFICE_ID');if(!c)return '0';return String(c.querySelectorAll('iframe[name=frameEditor]').length)})()" | sed -E 's/^"|"$//g'; }
console_errs() { q "(function(){try{return String((window.__oo_errs||[]).length)}catch(e){return '0'}})()" | sed -E 's/^"|"$//g'; }
# 在页面里挂一个错误收集器（捕获 SDK 抛出的「Unknown error」等未处理异常），用于收尾统计
tap_console() { "$AB" eval "try{window.__oo_errs=[];window.addEventListener('error',function(e){window.__oo_errs.push(String(e.message||e.error||'err'))});window.addEventListener('unhandledrejection',function(e){window.__oo_errs.push('rej:'+String(e.reason))})}catch(e){};'ok'" >/dev/null 2>&1; }
db_ref() { sqlite3 "file:$DATA/haiku.db?mode=ro" "SELECT json_extract(content,'\$.filename'),json_extract(content,'\$.ext') FROM docs WHERE id=$1;"; }

# 累积压力测试轮数（默认值覆盖「反复点几十次」的场景；run-all 里可 STRESS=40 重跑）
STRESS=${STRESS:-30}

pass=0; fail=0
chk() { if [ "$2" = "$3" ]; then echo "  ✅ $1 = $3"; pass=$((pass+1)); else echo "  ❌ $1：期望 $2，实际 $3"; fail=$((fail+1)); fi; }

# docType -> 期望的 iframe app 后缀 / 期望 ext
declare -A APP=( [sheet]=spreadsheet [word]=document [ppt]=presentation )
declare -A EXT=( [sheet]=xlsx [word]=docx [ppt]=pptx )

for DT in sheet word ppt; do
  echo "== $DT 文档 =="
  DOCID=$(curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" "${H[@]}" \
    -d "{\"parent_id\":0,\"title\":\"切换回归-$DT\",\"doc_type\":\"$DT\",\"content\":\"\"}" | jq -r '.data.id')
  "$AB" open "$BASE/books/1?docId=$DOCID&tab=edit" >/dev/null 2>&1
  "$AB" wait 11000 >/dev/null 2>&1
  tap_console
  clk 保存 >/dev/null 2>&1; "$AB" wait 4000 >/dev/null 2>&1   # 强制首保存，落库引用
  for i in 1 2 3 4; do
    clk 阅读 >/dev/null 2>&1; "$AB" wait 4500 >/dev/null 2>&1
    clk 编辑 >/dev/null 2>&1; "$AB" wait 6000 >/dev/null 2>&1
  done
  clk 保存 >/dev/null 2>&1; "$AB" wait 4000 >/dev/null 2>&1   # 切换后再保存
  APPF=$(iframe_app)
  REF=$(db_ref "$DOCID")
  echo "   最终编辑器 app=$APPF  落库引用='$REF'"
  chk "$DT 编辑态挂载正确编辑器" "${APP[$DT]}" "$APPF"
  EXT_OK=$(echo "$REF" | awk -F'|' -v e="${EXT[$DT]}" '{gsub(/ /,"",$2); print ($2==e)?"OK":"BAD"}')
  chk "$DT 落库扩展名与 docType 一致" "OK" "$EXT_OK"
  [ "$APPF" = "${APP[$DT]}" ] && [ "$EXT_OK" = "OK" ] || { echo "   复现了幽灵编辑器 bug！"; }
done

# ---------------------------------------------------------------------------
# 累积压力测试：模拟用户「反复点几十次」——阅读↔编辑来回切 + 三文档来回切。
# 断言：编辑态 #ONLYOFFICE_ID 容器内 editor iframe 恒为 1（绝不累积），
#       且最终仍能正确挂载对应 app（说明没陷入「恒定 Unknown error 打不开」）。
# ---------------------------------------------------------------------------
echo "== 累积压力测试：阅读/编辑来回切换 ×$STRESS =="
STRESS_DOC=$(curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" "${H[@]}" \
  -d '{"parent_id":0,"title":"压力-编辑阅读切换","doc_type":"sheet","content":""}' | jq -r '.data.id')
"$AB" open "$BASE/books/1?docId=$STRESS_DOC&tab=edit" >/dev/null 2>&1
"$AB" wait 11000 >/dev/null 2>&1
tap_console
MAX_FC=0
for ((r=1; r<=STRESS; r++)); do
  clk 阅读 >/dev/null 2>&1; "$AB" wait 2500 >/dev/null 2>&1
  clk 编辑 >/dev/null 2>&1; "$AB" wait 3500 >/dev/null 2>&1
  fc=$(frame_count)
  [ "$fc" -gt "$MAX_FC" ] 2>/dev/null && MAX_FC=$fc
  # 编辑态容器内应恰好 1 个 editor iframe；>1 即命中累积崩溃根因
  if [ "${fc:-0}" != "1" ]; then
    echo "  ❌ 第 $r 轮编辑态残留 iframe 数=$fc（期望 1）"
    fail=$((fail+1))
    [ "$fc" = "0" ] && echo "     （编辑器未挂载——可能已陷入恒定 Unknown error）"
  fi
done
chk "压力-编辑阅读切换 容器 iframe 无累积" "1" "$MAX_FC"
echo "    最高残留 iframe 数=$MAX_FC（期望 1）"

echo "== 累积压力测试：文档来回切换（sheet→word→ppt）×$STRESS =="
CYCS=(sheet word ppt)
MAX_FC2=0
for ((r=1; r<=STRESS; r++)); do
  DTN=${CYCS[$(( (r-1) % 3 ))]}
  CDOC=$(curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" "${H[@]}" \
    -d "{\"parent_id\":0,\"title\":\"压力-文档切换-$r\",\"doc_type\":\"$DTN\",\"content\":\"\"}" | jq -r '.data.id')
  "$AB" open "$BASE/books/1?docId=$CDOC&tab=edit" >/dev/null 2>&1
  "$AB" wait 4500 >/dev/null 2>&1
  fc=$(frame_count)
  [ "$fc" -gt "$MAX_FC2" ] 2>/dev/null && MAX_FC2=$fc
  if [ "${fc:-0}" != "1" ]; then
    echo "  ❌ 文档切换第 $r 轮（$DTN）残留 iframe 数=$fc（期望 1）"
    fail=$((fail+1))
  fi
done
chk "压力-文档切换 容器 iframe 无累积" "1" "$MAX_FC2"
echo "    最高残留 iframe 数=$MAX_FC2（期望 1）"

# 收尾：压力后仍应能正确挂载（取一个文档进入编辑态，断言 app 与 ext 正确）
FINAL_DOC=$(curl --noproxy '*' -s -X POST "$BASE/api/books/1/docs" "${H[@]}" \
  -d '{"parent_id":0,"title":"压力-终检","doc_type":"word","content":""}' | jq -r '.data.id')
"$AB" open "$BASE/books/1?docId=$FINAL_DOC&tab=edit" >/dev/null 2>&1
"$AB" wait 11000 >/dev/null 2>&1
FAPP=$(iframe_app)
chk "压力后编辑态仍挂载正确编辑器(word)" "${APP[word]}" "$FAPP"
CE=$(console_errs)
echo "    页面捕获控制台错误数=$CE"

echo "== 结果：通过 $pass 项，失败 $fail 项 =="
echo "    累计压力测试期间页面捕获控制台错误数=$CE（仅参考，不计入失败判定）"
echo "PASS=$pass FAIL=$fail"
[ "$fail" = "0" ]
