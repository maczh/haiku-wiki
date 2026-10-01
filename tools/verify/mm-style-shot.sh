#!/usr/bin/env bash
# 思维导图「样式选项」实拍：边框线型（节点样式）、连线线型/连接方式/箭头/连线色彩（基础样式）。
# 同时截一张三级下划线节点的布局图，用来肉眼核对「红框那种左右间距」。
# 单源生产形态：build-embed.sh 产物 + e2e 夹具库。默认端口 8194。
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$HERE/../.."
export HOME=/home/macro TMPDIR=/home/macro/.workbuddy/tmp
export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export XDG_RUNTIME_DIR=/home/macro/.workbuddy/tmp/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars,--window-size=1560,900"
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"
AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser
BIN=/home/macro/.workbuddy/tmp/haiku-wiki
PORT=8194
BASE="http://127.0.0.1:$PORT"
OUT=/home/macro/.workbuddy/tmp/mm-style-shot
mkdir -p "$OUT"

PASS=0; FAIL=0
ok()  { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); echo "  ❌ $1 (want=$3 got=$2)"; fi }
jseval() { "$AB" eval "$1" 2>/dev/null | tr -d '"'; }

DATA=$(mktemp -d /home/macro/.workbuddy/tmp/mm-style-shot.XXXXXX)
cp -r tools/verify/fixtures/e2e-data/. "$DATA"/

# 把 docId=3 换成「海鲜火锅·包厢预订系统」那份导图（红框里就是这种三级下划线结构），
# 这样能按用户的真实数据核对间距。只改临时副本，仓库夹具不动。
python3 - "$DATA/haiku.db" <<'PY'
import json, sqlite3, sys, uuid
db = sys.argv[1]
def n(text, *kids):
    return {"data": {"text": text, "expand": True, "uid": str(uuid.uuid4()), "isActive": False},
            "children": list(kids)}
tree = n("海鲜火锅·包厢预订系统",
    n("预订域",
      n("定金与退订", n("分支主题"), n("分支主题"), n("分支主题")),
      n("预订规则：时段、最低消费、超时释放"),
      n("渠道：电话 / 小程序 / 门店")),
    n("技术选型", n("Go + Gin"), n("Redis 分布式锁"), n("MySQL 分表")),
    n("桌台域", n("包厢/散台模型"), n("桌台状态机：空闲—预订—开台—结账—清台"), n("并台 / 拆台")),
    n("对接 baseServ", n("桌台占用同步"), n("开台消息（MQ）"), n("幂等与重试")),
    n("待办", n("压测：高峰期并发预订"), n("对账：定金流水")))
payload = {"version": 2, "root": dict(tree, smmVersion="0.14.0-fix.3"),
           "layout": "mindMap", "theme": {}}
c = sqlite3.connect(db)
c.execute("update docs set content=? where id=3", (json.dumps(payload, ensure_ascii=False),))
c.commit()
print("fixture doc3 replaced")
PY

cleanup() { "$AB" close >/dev/null 2>&1; fuser -k $PORT/tcp >/dev/null 2>&1; rm -rf "$DATA"; }
trap cleanup EXIT

PORT=$PORT DATA_DIR="$DATA" JWT_SECRET=mmcheck nohup "$BIN" >"$DATA/server.log" 2>&1 &
TOKEN=""
for i in $(seq 1 40); do
  TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token' 2>/dev/null)
  [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && [ "${#TOKEN}" -gt 20 ] && break
  sleep 0.5
done
if [ "${#TOKEN}" -le 20 ]; then echo "❌ 登录失败"; tail -5 "$DATA/server.log"; exit 1; fi

"$AB" open "$BASE/login" >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token','$TOKEN')" >/dev/null 2>&1
"$AB" open "$BASE/books/1?docId=3&tab=edit" >/dev/null 2>&1
"$AB" wait 4500 >/dev/null 2>&1

# 布局截图走阅读态：没有编辑浮层压在画布上，能看清间距（用户截图也是这个视角）
"$AB" open "$BASE/books/1?docId=3&tab=read" >/dev/null 2>&1
"$AB" wait 3800 >/dev/null 2>&1
SHOT="$OUT/layout-read.png"
"$AB" screenshot "$SHOT" >/dev/null 2>&1
echo "  📷 阅读态布局：$SHOT"

# 间距探针：量出每个节点的屏幕几何（文字右缘 → 父节点左缘的空白是最直观的「左右间距」）
GEO=$(jseval "(() => {
  const out = [];
  for (const g of document.querySelectorAll('.mm-node')) {
    const t = g.querySelector('title');
    const r = g.getBoundingClientRect();
    if (r.width) out.push({ t: t ? t.textContent.split(String.fromCharCode(10))[0] : '', x: Math.round(r.x), w: Math.round(r.width) });
  }
  out.sort((a, b) => a.x - b.x);
  return out.map(o => o.t + '@x' + o.x + '_w' + o.w).join(' ~ ');
})()")
echo "  节点几何（按屏幕 x 排序）："
echo "    $GEO"

# ---------------- 节点样式：边框线型 ----------------
# 回到编辑态做面板操作
"$AB" open "$BASE/books/1?docId=3&tab=edit" >/dev/null 2>&1
"$AB" wait 3000 >/dev/null 2>&1
CLICK_NODESTYLE="(() => {
  const btns = [...document.querySelectorAll('.hk-mm-style-combos .mm-tb-combo')];
  const b = btns.find(x => x.textContent.includes('节点样式'));
  if (b) b.click();
  return !!b;
})()"
FOUND=$(jseval "$CLICK_NODESTYLE")
ok "节点样式入口存在" "$FOUND" "true"
"$AB" wait 400 >/dev/null 2>&1
"$AB" screenshot "$OUT/panel-borderstyle.png" >/dev/null 2>&1
echo "  📷 节点样式面板：$OUT/panel-borderstyle.png"

# 面板内的「边框线型」应有 4 个 chip（实线/虚线/点线/点划线）
CHIPS=$(jseval "(() => {
  const lab = [...document.querySelectorAll('.mm-pop-label')].find(e => e.textContent.trim() === '边框线型');
  if (!lab) return 'no-label';
  const box = lab.nextElementSibling;
  return box ? box.querySelectorAll('.mm-bs-chip').length : 'no-box';
})()")
ok "边框线型 4 项" "$CHIPS" "4"

# ---------------- 基础样式：连线线型 / 连接方式 / 箭头 / 连线色彩 ----------------
CLICK_BASE="(() => {
  const btns = [...document.querySelectorAll('.hk-mm-style-combos .mm-tb-combo')];
  const b = btns.find(x => x.textContent.includes('基础样式'));
  if (b) b.click();
  return !!b;
})()"
FOUND=$(jseval "$CLICK_BASE")
ok "基础样式入口存在" "$FOUND" "true"
"$AB" wait 400 >/dev/null 2>&1
"$AB" screenshot "$OUT/panel-basestyle.png" >/dev/null 2>&1
echo "  📷 基础样式面板：$OUT/panel-basestyle.png"

# agent-browser eval 的输出里中文会被转义，逐组单独取值比拼 JSON 稳
seg_count() {
  jseval "(() => {
    const lab = [...document.querySelectorAll('.mm-pop-label')].find(e => e.textContent.trim() === '$1');
    const box = lab && lab.nextElementSibling;
    return box ? box.querySelectorAll('.mm-shape-chip').length : 'no-box';
  })()"
}
ok "连线线型 3 项" "$(seg_count '连线线型')" "3"
ok "连接方式 3 项" "$(seg_count '连接方式')" "3"
ok "箭头 3 项" "$(seg_count '箭头')" "3"
ok "连线色彩 2 项" "$(seg_count '连线色彩')" "2"

# ---------------- 落库：切换连线线型 / 箭头 / 单色，并保存后回读 ----------------
PICK_LINEPATTERN="(() => {
  const lab = [...document.querySelectorAll('.mm-pop-label')].find(e => e.textContent.trim() === '连线线型');
  const box = lab && lab.nextElementSibling;
  const b = box && [...box.querySelectorAll('.mm-shape-chip')].find(x => x.textContent.trim() === '虚线');
  if (b) { b.click(); return 'dashed'; }
  return 'none';
})()"
echo "  点击虚线 → $(jseval "$PICK_LINEPATTERN")"
"$AB" wait 600 >/dev/null 2>&1

PICK_ARROW="(() => {
  const lab = [...document.querySelectorAll('.mm-pop-label')].find(e => e.textContent.trim() === '箭头');
  const box = lab && lab.nextElementSibling;
  const b = box && [...box.querySelectorAll('.mm-shape-chip')].find(x => x.textContent.trim() === '向外箭头');
  if (b) { b.click(); return 'outward'; }
  return 'none';
})()"
echo "  点击向外箭头 → $(jseval "$PICK_ARROW")"
"$AB" wait 600 >/dev/null 2>&1

PICK_SINGLE="(() => {
  const lab = [...document.querySelectorAll('.mm-pop-label')].find(e => e.textContent.trim() === '连线色彩');
  const box = lab && lab.nextElementSibling;
  const b = box && [...box.querySelectorAll('.mm-shape-chip')].find(x => x.textContent.trim() === '单色');
  if (b) { b.click(); return 'single'; }
  return 'none';
})()"
echo "  点击单色 → $(jseval "$PICK_SINGLE")"
"$AB" wait 600 >/dev/null 2>&1
"$AB" screenshot "$OUT/applied-link.png" >/dev/null 2>&1
echo "  📷 应用后：$OUT/applied-link.png"

# 自动保存 3s 防抖 → 等满再刷新，确认样式**刷新后仍是选中态**（即真的落库回显）。
# ⚠️ 这里不再读 `#hk-mindmap-base-probe`：全仓前端代码里根本没有这个元素
# （探针只存在于旧版脚本），导致「是否落库」这项一直恒为 noprobe、什么也没验到。
# 真正的跨模式落库/渲染断言在 mm-xmode-check.sh。
jseval "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('保存')); if(b) b.click(); return 'saved'; })()" >/dev/null 2>&1
"$AB" wait 4200 >/dev/null 2>&1
"$AB" open "$BASE/books/1?docId=3&tab=edit" >/dev/null 2>&1
"$AB" wait 4500 >/dev/null 2>&1
# 刷新后 popover 是收起的，必须先点开「基础样式」，否则 .mm-pop-label 根本不在 DOM 里
"$AB" eval "(() => { const b=[...document.querySelectorAll('.hk-mm-style-combos .mm-tb-combo')].find(x=>x.textContent.includes('基础样式')); if(b){b.click();return 'ok';} return 'no'; })()" >/dev/null 2>&1
"$AB" wait 600 >/dev/null 2>&1
BASE_ON=$(jseval "(() => {
  const lab=[...document.querySelectorAll('.mm-pop-label')].find(e=>e.textContent.trim()==='连线线型');
  const box=lab && lab.nextElementSibling;
  const b=box && [...box.querySelectorAll('.mm-shape-chip')].find(x=>x.textContent.trim()==='虚线');
  return b && b.className.includes('is-on') ? '1' : '0';
})()")
ok "刷新后连线线型仍为虚线(落库回显)" "$BASE_ON" "1"
"$AB" wait 400 >/dev/null 2>&1
BACK=$(jseval "(() => {
  const box = document.querySelector('#hk-mindmap-base-probe');
  return box ? box.getAttribute('data-base') : 'noprobe';
})()")
echo "  探针（前端已无此元素，仅供参考）：${BACK}"

echo ""
echo "==== 结果：PASS=$PASS FAIL=$FAIL ===="
if [ "$FAIL" -eq 0 ]; then echo "MM_STYLE_SHOT_PASS"; else echo "MM_STYLE_SHOT_FAIL"; fi
