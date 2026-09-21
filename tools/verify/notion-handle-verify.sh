#!/usr/bin/env bash
# 块手柄三连修的浏览器实测回归：BUG1 左移消失 / BUG2 指错块 / BUG3 「样式」菜单写字面文字。
# 自起 haiku-wiki（embed 二进制）于空闲端口，用 agent-browser + 系统 Chrome 真验。
# 依赖：node(managed) / Go / agent-browser / 系统 Chrome / sqlite3(python3)。
set -uo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SKIP_BUILD=${SKIP_BUILD:-0}

# ===== 环境（与 build-embed.sh 一致）=====
export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:/usr/local/go/bin:/home/macro/.workbuddy/binaries/go/bin:$PATH
export HOME=/home/macro TMPDIR=/home/macro/.workbuddy/tmp
export GOPATH=/home/macro/.workbuddy/go GOMODCACHE=/home/macro/.workbuddy/go/pkg/mod GOCACHE=/home/macro/.workbuddy/go/cache
export GOPROXY=https://goproxy.cn,direct GOSUMDB=off GOTOOLCHAIN=local
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export XDG_RUNTIME_DIR=/home/macro/.workbuddy/tmp/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars,--window-size=1560,900"
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"
AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser
BIN=/home/macro/.workbuddy/tmp/haiku-wiki
E2E_DATA=${E2E_DATA:-$REPO/tools/verify/fixtures/e2e-data}
# e2e@example.com / secret123 的 bcrypt hash（注入到夹具副本，保证登录）
E2E_HASH='$2a$10$XCGnlqrna6.Fj2XP3rY6becUvt.yNDtnz2GlcIAdMQgSAywYR98NC'

# ===== 构建 embed（除非已跳过）=====
if [ "$SKIP_BUILD" != "1" ]; then
  echo "== 构建 embed =="
  export CODEBUDDY_SAFE_DELETE_ENABLED=0
  bash "$REPO/tools/build/build-embed.sh" 2>&1 | tail -4
fi

# ===== 探测空闲端口 =====
PORT=18095
while :; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 1 "http://127.0.0.1:$PORT/" 2>/dev/null)
  [ "$code" = "000" ] && break
  PORT=$((PORT + 1))
  [ "$PORT" -gt 19000 ] && { echo "❌ 找不到空闲端口"; exit 1; }
done
echo "✓ 使用端口 $PORT"

# ===== 准备数据（夹具副本 + 注入 e2e 密码）=====
DATADIR=$(mktemp -d "$TMPDIR/hk-e2e-XXXX")
cp -r "$E2E_DATA/." "$DATADIR/"
python3 - "$DATADIR/haiku.db" "$E2E_HASH" <<'PY'
import sqlite3, sys
db, h = sys.argv[1], sys.argv[2]
c = sqlite3.connect(db)
c.execute("UPDATE users SET password_hash=? WHERE email='e2e@example.com'", (h,))
c.commit(); c.close()
print("  ✅ e2e 密码 hash 已注入", db)
PY

# ===== 起服（后台，退出时回收）=====
cleanup() { [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null; }
trap cleanup EXIT
DATA_DIR="$DATADIR" DB_DRIVER=sqlite PORT="$PORT" JWT_SECRET=testsecret "$BIN" > "$TMPDIR/hk-e2e-server.log" 2>&1 &
SRV_PID=$!
for i in $(seq 1 20); do
  sleep 0.5
  curl -s -o /dev/null --noproxy '*' --max-time 1 "http://127.0.0.1:$PORT/" 2>/dev/null | grep -q 200 && break
done
echo "== 登录取 token =="
TOKEN=$(curl -s --noproxy '*' -X POST "http://127.0.0.1:$PORT/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"account":"e2e@example.com","password":"secret123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
[ -z "$TOKEN" ] && { echo "❌ 登录失败"; exit 1; }
BASE="http://127.0.0.1:$PORT"

# ===== eval JS（内联，避免依赖临时文件）=====
read -r -d '' EVAL_A <<'JSA'
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const host = document.querySelector('.vditor');
  const reset = document.querySelector('.vditor-ir .vditor-reset');
  if (!reset) return 'NO_RESET:' + (host ? 'has-vditor' : 'no-vditor');
  const blocks = Array.from(reset.querySelectorAll('[data-block]'));
  out.blockCount = blocks.length;
  if (blocks.length < 2) return JSON.stringify(out);
  const move = (x, y) => reset.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
  const handleRect = () => { const h = document.querySelector('[aria-label="段落操作菜单"]'); if (!h) return null; const hr = host.getBoundingClientRect(); const r = h.getBoundingClientRect(); return { top: r.top - hr.top, left: r.left - hr.left }; };
  const hr0 = host.getBoundingClientRect();
  const b0 = blocks[0].getBoundingClientRect();
  const b1 = blocks[1].getBoundingClientRect();
  move(b0.left + b0.width / 2, b0.top + b0.height / 2); await sleep(200);
  out.bug1_textVisible = !!handleRect();
  move(b0.left - 30, b0.top + b0.height / 2); await sleep(200);
  const hg = handleRect();
  out.bug1_gutterVisible = !!hg;
  out.bug1_gutterMatchesB0 = hg ? Math.abs(hg.top - (b0.top - hr0.top)) <= 3 : false;
  move(b0.left + b0.width / 2, b0.top - 200); await sleep(200);
  out.bug1_awayHidden = !handleRect();
  move(b1.left + b1.width / 2, b1.top + b1.height / 2); await sleep(200);
  const hb1 = handleRect();
  out.bug2_lockedToB1 = hb1 ? Math.abs(hb1.top - (b1.top - hr0.top)) <= 3 : false;
  out.bug2_movedFromB0 = hb1 ? Math.abs(hb1.top - (b0.top - hr0.top)) > 3 : false;
  return JSON.stringify(out);
})()
JSA
read -r -d '' EVAL_HOVER <<'JSH'
(async () => {
  const reset = document.querySelector('.vditor-ir .vditor-reset');
  if (!reset) return 'NO_RESET';
  const blocks = Array.from(reset.querySelectorAll('[data-block]'));
  if (!blocks.length) return 'NO_BLOCKS';
  const b = blocks[0].getBoundingClientRect();
  reset.dispatchEvent(new MouseEvent('mousemove', { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  const h = document.querySelector('[aria-label="段落操作菜单"]');
  const b0 = blocks[0];
  return JSON.stringify({ handleShown: !!h, b0Text: b0 ? b0.textContent.slice(0, 50) : null, b0HasHeading: !!(b0 && b0.querySelector('.vditor-ir__marker--heading')), blockCount: blocks.length });
})()
JSH
read -r -d '' EVAL_VERIFY <<'JSV'
(async () => {
  const reset = document.querySelector('.vditor-ir .vditor-reset');
  if (!reset) return 'NO_RESET';
  const blocks = Array.from(reset.querySelectorAll('[data-block]'));
  const out = { blockCount: blocks.length };
  const b0 = blocks[0];
  const marker = b0 ? b0.querySelector('.vditor-ir__marker--heading') : null;
  out.b0HasHeading = !!marker;
  out.b0MarkerText = marker ? marker.textContent : null;
  out.b0Text = b0 ? b0.textContent.slice(0, 50) : null;
  out.literalBlocks = blocks.map((b) => b.textContent.trim()).filter((t) => t === '正文' || t === '标题').length;
  out.pass = out.literalBlocks === 0;
  return JSON.stringify(out);
})()
JSV
ref_for() { echo "$1" | grep -E "menuitem.*$2" | grep -oE 'ref=e[0-9]+' | grep -oE 'e[0-9]+' | head -1; }
parse_json() { python3 -c "import sys,json; s=sys.stdin.read().strip()
if s.startswith('\"') and s.endswith('\"'): s=s[1:-1]
s=s.replace('\\\\\"','\"'); d=json.loads(s); $1"; }

# ===== 开浏览器跑验证 =====
"$AB" open "$BASE/login" 2>&1 | tail -1
"$AB" eval "localStorage.setItem('hk_token','$TOKEN'); 'ok'" 2>&1 | tail -1
"$AB" open "$BASE/books/1?docId=1&tab=edit" 2>&1 | tail -1
"$AB" eval "localStorage.setItem('hk_token','$TOKEN'); 'ok'" 2>&1 | tail -1
"$AB" wait 3500

echo "== EVAL A（BUG1/BUG2 悬停几何）=="
RA=$("$AB" eval "$EVAL_A" 2>/dev/null)
echo "$RA" | parse_json "print('  blockCount=',d.get('blockCount'));print('  BUG1 textVisible=',d.get('bug1_textVisible'),' gutterVisible=',d.get('bug1_gutterVisible'),' gutterMatchesB0=',d.get('bug1_gutterMatchesB0'),' awayHidden=',d.get('bug1_awayHidden'));print('  BUG2 lockedToB1=',d.get('bug2_lockedToB1'),' movedFromB0=',d.get('bug2_movedFromB0'))" 2>&1 || echo "  (解析失败: $RA)"

echo "== BUG3：菜单「样式 → 正文」真实点击 =="
RH=$("$AB" eval "$EVAL_HOVER" 2>/dev/null)
echo "  hover结果: $RH"
"$AB" click "[aria-label='段落操作菜单']" 2>&1 | tail -1
"$AB" wait 600
S1=$("$AB" snapshot -i 2>/dev/null)
RS=$(ref_for "$S1" "样式")
echo "  REF_STYLE=$RS"
if [ -n "$RS" ]; then
  "$AB" hover "@$RS" 2>&1 | tail -1
  "$AB" wait 800
  S2=$("$AB" snapshot -i 2>/dev/null)
  RZ=$(ref_for "$S2" "正文")
  echo "  REF_ZHENGWEN=$RZ"
  if [ -n "$RZ" ]; then "$AB" click "@$RZ" 2>&1 | tail -1; "$AB" wait 800; fi
fi
RV=$("$AB" eval "$EVAL_VERIFY" 2>/dev/null)
echo "  verify结果: $RV"
echo "$RV" | parse_json "conv=(d.get('b0HasHeading')==False); clean=(d.get('literalBlocks')==0 and d.get('blockCount')==8); print('  b0HasHeading=',d.get('b0HasHeading'),' literalBlocks=',d.get('literalBlocks'),' blockCount=',d.get('blockCount')); print('  >> BUG3', 'FIXED' if (conv and clean) else '需复核')" 2>&1 || echo "  (解析失败: $RV)"

"$AB" screenshot "$TMPDIR/notion-editor.png" 2>&1 | tail -1
"$AB" close 2>&1 | tail -1
echo "DONE"
