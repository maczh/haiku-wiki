#!/usr/bin/env bash
# 校验路由级懒加载的**占位与落位**：无布局壳的路由（/login、/register、/share/:slug）
# 与有布局壳的路由（AppLayout 内）在 `LazyBoundary fill`（height:100%）下的表现不同，
# 需要确认最终页面正常渲染、没有卡在加载占位。
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
BASE=http://127.0.0.1:8080
# 演示数据：默认取**仓库内夹具的临时副本**（服务端会写库，夹具本身不能被改动）
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [ -n "${E2E_DATA:-}" ]; then
  DATA=$E2E_DATA
else
  DATA=$TMPDIR/e2e-data-$(date +%s)
  cp -r "$HERE/fixtures/e2e-data/." "$DATA/"
fi
TS=$(date +%s)
OUT=/home/macro/.workbuddy/tmp/route-out-$TS
mkdir -p "$OUT"

DATA_DIR="$DATA" PORT=8080 JWT_SECRET=e2e-secret-for-verify GIN_MODE=release \
  "$TMPDIR/haiku-wiki" >"$OUT/server.log" 2>&1 &
SPID=$!
cleanup() { "$AB" close >/dev/null 2>&1; kill "$SPID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 80); do
  c=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books"); [ "$c" != "000" ] && break; sleep 0.25
done

pass=0; fail=0
chk() { if [ "$2" = "$3" ]; then echo "  ✅ $1 = $2"; pass=$((pass+1)); else echo "  ❌ $1 = $2（期望 $3）"; fail=$((fail+1)); fi; }

"$AB" set viewport 1560 900 >/dev/null 2>&1

# ---------- /login（BlankLayout，父级 minHeight 而非 height）----------
"$AB" open "$BASE/login" >/dev/null 2>&1; "$AB" wait 2500 >/dev/null 2>&1
G=$( "$AB" eval "(function(){var f=document.querySelector('form');var i=document.querySelectorAll('input').length;var s=document.querySelector('.ant-spin');return [!!f,i,!!s].join('|')})()" 2>/dev/null | tr -d "\"" )
echo "== /login（无布局壳） =="; echo "   form|inputs|spinning = $G"
chk "登录表单已渲染"        "$(echo "$G" | cut -d'|' -f1)" "true"
chk "输入框数 >= 2"         "$([ "$(echo "$G" | cut -d'|' -f2)" -ge 2 ] && echo true || echo false)" "true"
chk "未卡在加载占位"        "$(echo "$G" | cut -d'|' -f3)" "false"
"$AB" screenshot "$OUT/01-login.png" >/dev/null 2>&1

# ---------- /register ----------
"$AB" open "$BASE/register" >/dev/null 2>&1; "$AB" wait 2500 >/dev/null 2>&1
G=$( "$AB" eval "(function(){var f=document.querySelector('form');var i=document.querySelectorAll('input').length;var s=document.querySelector('.ant-spin');return [!!f,i,!!s].join('|')})()" 2>/dev/null | tr -d "\"" )
echo "== /register（无布局壳） =="; echo "   form|inputs|spinning = $G"
chk "注册表单已渲染"        "$(echo "$G" | cut -d'|' -f1)" "true"
chk "未卡在加载占位"        "$(echo "$G" | cut -d'|' -f3)" "false"
"$AB" screenshot "$OUT/02-register.png" >/dev/null 2>&1

# ---------- 未知路由应重定向到 / 再跳登录 ----------
"$AB" open "$BASE/no-such-page" >/dev/null 2>&1; "$AB" wait 2500 >/dev/null 2>&1
URL=$("$AB" eval "location.pathname" 2>/dev/null | tr -d '"' )
echo "== 未知路由 /no-such-page =="; echo "   最终 pathname = $URL"
chk "已重定向"              "$URL" "/login"

# ---------- 登录态下 AppLayout 内路由：占位应为确定高度（不塌陷） ----------
TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); 'ok'" >/dev/null 2>&1
for r in "/" "/search?q=%E5%AF%BC%E5%87%BA" "/trash" "/settings"; do
  "$AB" open "$BASE$r" >/dev/null 2>&1; "$AB" wait 3000 >/dev/null 2>&1
  G=$( "$AB" eval "(function(){var m=document.querySelector('main');var s=document.querySelector('.ant-spin');return [m?Math.round(m.getBoundingClientRect().height):-1, !!s].join('|')})()" 2>/dev/null | tr -d "\"" )
  MH=$(echo "$G" | cut -d'|' -f1); SP=$(echo "$G" | cut -d'|' -f2)
  echo "== $r =="; echo "   main 高度=$MH 占位中=$SP"
  chk "main 高度 > 400"     "$([ "$MH" -gt 400 ] && echo true || echo false)" "true"
  chk "未卡在加载占位"      "$SP" "false"
done

echo "== 控制台错误 =="
"$AB" errors 2>&1 | tail -5 | sed 's/^/  /'

echo "======== 结果：通过 $pass 项，失败 $fail 项 ========"
echo "输出目录：$OUT"
[ "$fail" -eq 0 ] || exit 1
