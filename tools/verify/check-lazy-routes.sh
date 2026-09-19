#!/usr/bin/env bash
# 实证「路由级按需加载」：访问 /login 时不应下载书架/知识库页面代码。
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
OUT=/home/macro/.workbuddy/tmp/lazy-out-$TS
mkdir -p "$OUT"

DATA_DIR="$DATA" PORT=8080 JWT_SECRET=e2e-secret-for-verify GIN_MODE=release \
  "$TMPDIR/haiku-wiki" >"$OUT/server.log" 2>&1 &
SPID=$!
cleanup() { "$AB" close >/dev/null 2>&1; kill "$SPID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 80); do
  c=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books"); [ "$c" != "000" ] && break; sleep 0.25
done
TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
[ -z "$TOKEN" ] || [ "$TOKEN" = "null" ] && { echo "❌ 登录失败"; exit 1; }

"$AB" set viewport 1560 900 >/dev/null 2>&1

# 入口 chunk 的真实文件名只认 index.html 引用的那个
# （dist 里存在多个形如 index-*.js 的内部共享 chunk，不能只用前缀匹配）
ENTRY=$(curl --noproxy '*' -s "$BASE/" | grep -o 'assets/index-[A-Za-z0-9._-]*\.js' | head -1)
echo "入口 chunk（来自 index.html）：$ENTRY"

# 本机 /dev/fd 被沙箱拦截，comm 不能用进程替换，改用临时文件
diff_added() { # $1=旧清单 $2=新清单
  grep -Fxv -f "$1" "$2" || true
}

# ---------- 1) 冷启动访问 /login ----------
"$AB" open "$BASE/login" >/dev/null 2>&1
"$AB" wait 3500 >/dev/null 2>&1
"$AB" network requests >"$OUT/net-login.txt" 2>&1
grep -o 'assets/[A-Za-z0-9._-]*\.js' "$OUT/net-login.txt" | sort -u > "$OUT/js-login.txt"
LOGIN_JS=$(cat "$OUT/js-login.txt")
echo "== /login 实际下载的 JS chunk =="
sed 's/^/   /' "$OUT/js-login.txt"

pass=0; fail=0
chk() { if [ "$2" = "$3" ]; then echo "  ✅ $1 = $2"; pass=$((pass+1)); else echo "  ❌ $1 = $2（期望 $3）"; fail=$((fail+1)); fi; }

echo "== 断言：/login 只加载登录页相关 chunk =="
chk "入口 chunk 已加载"                  "$(grep -Fxc "$ENTRY" "$OUT/js-login.txt")" "1"
chk "LoginPage chunk 已加载"             "$(grep -c 'LoginPage-' "$OUT/js-login.txt")"  "1"
chk "DashboardPage chunk 未下载"        "$(grep -c 'DashboardPage-' "$OUT/js-login.txt")" "0"
chk "BookPage chunk 未下载"              "$(grep -c 'BookPage-' "$OUT/js-login.txt")"   "0"
chk "SettingsPage chunk 未下载"          "$(grep -c 'SettingsPage-' "$OUT/js-login.txt")" "0"
chk "TrashPage chunk 未下载"             "$(grep -c 'TrashPage-' "$OUT/js-login.txt")"  "0"
chk "MindmapEditor chunk 未下载"         "$(grep -c 'MindmapEditor-' "$OUT/js-login.txt")" "0"

# ---------- 2) 注入登录态 → 访问书架 ----------
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); 'ok'" >/dev/null 2>&1
"$AB" open "$BASE/" >/dev/null 2>&1
"$AB" wait 3500 >/dev/null 2>&1
"$AB" network requests >"$OUT/net-shelf.txt" 2>&1
grep -o 'assets/[A-Za-z0-9._-]*\.js' "$OUT/net-shelf.txt" | sort -u > "$OUT/js-shelf.txt"
echo "== 进入书架后新增的 chunk =="
diff_added "$OUT/js-login.txt" "$OUT/js-shelf.txt" | sed 's/^/   /'

echo "== 断言：书架页按需补载 =="
chk "DashboardPage chunk 已加载"        "$(grep -c 'DashboardPage-' "$OUT/js-shelf.txt")" "1"
chk "BookPage chunk 仍未下载"            "$(grep -c 'BookPage-' "$OUT/js-shelf.txt")"   "0"
chk "MindmapEditor chunk 仍未下载"       "$(grep -c 'MindmapEditor-' "$OUT/js-shelf.txt")" "0"

# ---------- 3) 进入知识库文档页 ----------
"$AB" open "$BASE/books/1?docId=3&tab=edit" >/dev/null 2>&1
"$AB" wait 5000 >/dev/null 2>&1
"$AB" network requests >"$OUT/net-book.txt" 2>&1
grep -o 'assets/[A-Za-z0-9._-]*\.js' "$OUT/net-book.txt" | sort -u > "$OUT/js-book.txt"
echo "== 进入知识库后新增的 chunk =="
diff_added "$OUT/js-shelf.txt" "$OUT/js-book.txt" | sed 's/^/   /'

echo "== 断言：知识库页才加载编辑器 =="
chk "BookPage chunk 已加载"              "$(grep -c 'BookPage-' "$OUT/js-book.txt")"   "1"
chk "MindmapEditor chunk 已加载"         "$(grep -c 'MindmapEditor-' "$OUT/js-book.txt")" "1"
chk "MindmapView(阅读器) chunk 未加载"    "$(grep -c 'MindmapView-' "$OUT/js-book.txt")" "0"

echo "== 非本地请求（应为 0） =="
grep -ohE 'https?://[^ "'"'"']+' "$OUT/net-login.txt" "$OUT/net-shelf.txt" "$OUT/net-book.txt" 2>/dev/null \
  | grep -vE '127\.0\.0\.1|localhost' | sort -u > "$OUT/nonlocal.txt" || true
chk "非本地请求条数" "$(wc -l < "$OUT/nonlocal.txt")" "0"
sed 's/^/   /' "$OUT/nonlocal.txt"

echo "======== 结果：通过 $pass 项，失败 $fail 项 ========"
echo "输出目录：$OUT"
[ "$fail" -eq 0 ] || exit 1
