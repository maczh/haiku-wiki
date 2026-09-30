#!/usr/bin/env bash
# 思维导图「基础样式跨模式一致」校验。
#
# 背景：连线线型（实线/虚线/从粗到细）、箭头、连线色彩、节点边框线型写在 `theme.__baseStyle`
# 里由编辑器落库。阅读模式 / H5 / 分享三条链路此前用的是 `smmThemeToBase()`（只搬运旧键，
# 读不到 __baseStyle），导致编辑态设的样式在三种模式下全部退回默认。本套件就是盯死这件事：
#   编辑态设样式 → 保存 → 三个只读端都必须渲染出**同一套**样式，且 taper 粗细端 = 8 / 2。
#
# 单源生产形态：build-embed.sh 产物 + e2e 夹具库。默认端口 8195。
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
PORT=8195
BASE="http://127.0.0.1:$PORT"
OUT=/home/macro/.workbuddy/tmp/mm-xmode-check
mkdir -p "$OUT"

PASS=0; FAIL=0
ok()  { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); echo "  ❌ $1 (want=$3 got=$2)"; fi }
say() { echo "── $1"; }
jseval() { "$AB" eval "$1" 2>/dev/null | tr -d '"'; }

DATA=$(mktemp -d /home/macro/.workbuddy/tmp/mm-xmode.XXXXXX)
cp -r tools/verify/fixtures/e2e-data/. "$DATA"/

# docId=3 换成一份带多级的导图（要够多条连线才能验 taper / 箭头）
python3 - "$DATA/haiku.db" <<'PY'
import json, sqlite3, sys, uuid
def n(text, *kids):
    return {"data": {"text": text, "expand": True, "uid": str(uuid.uuid4()), "isActive": False},
            "children": list(kids)}
tree = n("跨模式样式校验",
    n("连线", n("粗到细", n("a"), n("b")), n("虚线"), n("实线")),
    n("节点", n("边框线型"), n("圆角"), n("填充")),
    n("分享", n("阅读"), n("H5")))
payload = {"version": 2, "root": dict(tree, smmVersion="0.14.0-fix.3"),
           "layout": "mindMap", "theme": {}}
c = sqlite3.connect(sys.argv[1])
c.execute("update docs set content=? where id=3", (json.dumps(payload, ensure_ascii=False),))
c.commit()
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
AUTH="Authorization: Bearer $TOKEN"

say "1) 编辑态：设 从粗到细 + 向外箭头 + 单色 + 节点边框虚线"
"$AB" open "$BASE/login" >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token','$TOKEN')" >/dev/null 2>&1
"$AB" open "$BASE/books/1?docId=3&tab=edit" >/dev/null 2>&1
"$AB" wait 4500 >/dev/null 2>&1

# ⚠️ agent-browser 的 eval 里直接写中文会被转义 → 一律用「标签文本 + 下一个兄弟 .mm-shape-chip」
# 的写法（与 mm-style-shot.sh 同一套路），逐项单独求值。
# 点开 popover：顶部 combo 的中文写在双引号内，与既有套件一致。
"$AB" eval "(() => { const b=[...document.querySelectorAll('.hk-mm-style-combos .mm-tb-combo')].find(x=>x.textContent.includes('节点样式')); if(b){b.click();return 'ok';} return 'no'; })()" >/dev/null 2>&1
"$AB" wait 400 >/dev/null 2>&1
"$AB" eval "(() => { const b=[...document.querySelectorAll('.mm-bs-chip')].find(x=>x.textContent.includes('虚线')); if(b){b.click();return 'ok';} return 'no'; })()" >/dev/null 2>&1
"$AB" wait 500 >/dev/null 2>&1
ok "边框线型=虚线已点" "$(jseval "(() => { const b=[...document.querySelectorAll('.mm-bs-chip')].find(x=>x.textContent.includes('虚线')); return b && b.className.includes('is-on') ? 'on' : 'off'; })()")" "on"

"$AB" eval "(() => { const b=[...document.querySelectorAll('.hk-mm-style-combos .mm-tb-combo')].find(x=>x.textContent.includes('基础样式')); if(b){b.click();return 'ok';} return 'no'; })()" >/dev/null 2>&1
"$AB" wait 400 >/dev/null 2>&1
# 连线线型 = 从粗到细（第 3 项，索引 2）
"$AB" eval "(() => {
  const lab=[...document.querySelectorAll('.mm-pop-label')].find(e=>e.textContent.trim()==='连线线型');
  const box=lab && lab.nextElementSibling;
  const b=box && [...box.querySelectorAll('.mm-shape-chip')].find(x=>x.textContent.trim()==='从粗到细');
  if(b){b.click();return 'ok';} return 'no';
})()" >/dev/null 2>&1
"$AB" wait 600 >/dev/null 2>&1
ok "连线线型=从粗到细已点" "$(jseval "(() => {
  const lab=[...document.querySelectorAll('.mm-pop-label')].find(e=>e.textContent.trim()==='连线线型');
  const box=lab && lab.nextElementSibling;
  const b=box && [...box.querySelectorAll('.mm-shape-chip')].find(x=>x.textContent.trim()==='从粗到细');
  return b && b.className.includes('is-on') ? 'on' : 'off';
})()")" "on"

# 箭头 = 向外箭头
"$AB" eval "(() => {
  const lab=[...document.querySelectorAll('.mm-pop-label')].find(e=>e.textContent.trim()==='箭头');
  const box=lab && lab.nextElementSibling;
  const b=box && [...box.querySelectorAll('.mm-shape-chip')].find(x=>x.textContent.trim()==='向外箭头');
  if(b){b.click();return 'ok';} return 'no';
})()" >/dev/null 2>&1
"$AB" wait 600 >/dev/null 2>&1
ok "箭头=向外已点" "$(jseval "(() => {
  const lab=[...document.querySelectorAll('.mm-pop-label')].find(e=>e.textContent.trim()==='箭头');
  const box=lab && lab.nextElementSibling;
  const b=box && [...box.querySelectorAll('.mm-shape-chip')].find(x=>x.textContent.trim()==='向外箭头');
  return b && b.className.includes('is-on') ? 'on' : 'off';
})()")" "on"

# 连线色彩 = 单色
"$AB" eval "(() => {
  const lab=[...document.querySelectorAll('.mm-pop-label')].find(e=>e.textContent.trim()==='连线色彩');
  const box=lab && lab.nextElementSibling;
  const b=box && [...box.querySelectorAll('.mm-shape-chip')].find(x=>x.textContent.trim()==='单色');
  if(b){b.click();return 'ok';} return 'no';
})()" >/dev/null 2>&1
"$AB" wait 600 >/dev/null 2>&1
ok "连线色彩=单色已点" "$(jseval "(() => {
  const lab=[...document.querySelectorAll('.mm-pop-label')].find(e=>e.textContent.trim()==='连线色彩');
  const box=lab && lab.nextElementSibling;
  const b=box && [...box.querySelectorAll('.mm-shape-chip')].find(x=>x.textContent.trim()==='单色');
  return b && b.className.includes('is-on') ? 'on' : 'off';
})()")" "on"

"$AB" screenshot "$OUT/editor-applied.png" >/dev/null 2>&1
echo "  📷 编辑态应用后：$OUT/editor-applied.png"

say "2) 落库检查（API 回读 content 里的 __baseStyle）"
# 自动保存是 3s 防抖，点完 chip 要等满 debounce 再回读
"$AB" wait 4500 >/dev/null 2>&1
CONTENT=$(curl --noproxy '*' -s "$BASE/api/docs/3" -H "$AUTH" | jq -r '.data.doc.content // ""')
echo "  content 长度=${#CONTENT}"
for k in '"linkPattern":"taper"' '"linkArrow":"outward"' '"linkColorMode":"single"' '"borderStyle":"dashed"'; do
  if case "$CONTENT" in *"$k"*) true;; *) false;; esac; then ok "落库含 $k" "yes" "yes"
  else ok "落库含 $k" "yes" "NO"; fi
done
if [ "${#CONTENT}" -eq 0 ]; then echo "  ⚠️  取不到 content：$(curl --noproxy '*' -s "$BASE/api/docs/3" -H "$AUTH" | head -c 300)"; fi
echo "  content 片段：$(echo "$CONTENT" | head -c 400)"

say "3) 阅读模式（桌面）必须渲染出同一套样式"
"$AB" open "$BASE/books/1?docId=3&tab=read" >/dev/null 2>&1
"$AB" wait 4000 >/dev/null 2>&1
"$AB" screenshot "$OUT/read-mode.png" >/dev/null 2>&1
# taper 走填充带：.mm-link 下 stroke=none 的 path 是变宽填充，普通线型不会出现
ok "阅读·taper 填充带存在" "$(jseval "document.querySelectorAll('.mm-link path[stroke=\"none\"]').length>0")" "true"
ok "阅读·箭头 polygon 存在" "$(jseval "document.querySelectorAll('.mm-link polygon').length>0")" "true"
ok "阅读·无 dash 描边(taper与虚线互斥)" "$(jseval "!!document.querySelector('.mm-link path[stroke-dasharray]')")" "false"
# 只读态不该出现编辑用的选中环（reducer 默认选中根节点，很容易漏出去）
ok "阅读·无编辑选中环(mm-ui-only)" "$(jseval "document.querySelectorAll('.mm-ui-only').length")" "0"

say "4) H5 阅读模式"
# /m/* 只在 H5Router 内登记，而 H5Router 要 useViewMode()==='h5' 才挂载；
# 无头 Chrome 是桌面 UA，必须先种 haiku_view_mode=再 open（与 h5-reader-check 一致）。
"$AB" open "$BASE/books/1?docId=3&tab=read" >/dev/null 2>&1
"$AB" eval "localStorage.setItem('haiku_view_mode','h5'); 'ok'" >/dev/null 2>&1
"$AB" open "$BASE/m/doc/3" >/dev/null 2>&1
"$AB" wait 4200 >/dev/null 2>&1
"$AB" screenshot "$OUT/h5-mode.png" >/dev/null 2>&1
ok "H5·taper 填充带存在" "$(jseval "document.querySelectorAll('.mm-link path[stroke=\"none\"]').length>0")" "true"
ok "H5·箭头 polygon 存在" "$(jseval "document.querySelectorAll('.mm-link polygon').length>0")" "true"

say "5) 分享模式（免登录 /share/:slug）"
SLUG=$(curl --noproxy '*' -s -X PUT "$BASE/api/docs/3/share" -H "$AUTH" -H 'Content-Type: application/json' -d '{}' \
  | jq -r '.data.slug // ""')
echo "  slug=${SLUG:0:24}"
if [ -n "$SLUG" ] && [ "$SLUG" != "null" ]; then
  # ⚠️ 用 /doc-share/:slug（文档级分享，单文档免登录）而不是 /share/:slug：
  # 后者是**文库级**分享，打开只会默认选第一篇文档，未必是 docId=3。
  "$AB" open "$BASE/doc-share/$SLUG" >/dev/null 2>&1
  "$AB" wait 4200 >/dev/null 2>&1
  "$AB" screenshot "$OUT/share-mode.png" >/dev/null 2>&1
  ok "分享·taper 填充带存在" "$(jseval "document.querySelectorAll('.mm-link path[stroke=\"none\"]').length>0")" "true"
  ok "分享·箭头 polygon 存在" "$(jseval "document.querySelectorAll('.mm-link polygon').length>0")" "true"
else
  fail_note="slug 缺失，跳过分享段"
  echo "  ⚠️  $fail_note"
  ok "分享·拿到 slug" "yes" "NO"
fi

say "6) taper 粗细端宽度 = 8 : 2（直接量填充带 path 的 d 数据）"
# 上一步种过 haiku_view_mode=h5，/m/* 之外的桌面路由会被 H5Router 挡掉 —— 先切回桌面
"$AB" open "$BASE/books/1?docId=3&tab=read" >/dev/null 2>&1
"$AB" eval "localStorage.setItem('haiku_view_mode','desktop'); 'ok'" >/dev/null 2>&1
"$AB" open "$BASE/books/1?docId=3&tab=read" >/dev/null 2>&1
"$AB" wait 4000 >/dev/null 2>&1
# taperFillPath 产出 `M left[0..N] L right[N..0] Z`：前半是左缘、后半是右缘，
# 两端宽度 = 首点与末点、第 N 点与第 N+1 点 的距离（路径用户单位，不随画布缩放变化）。
WIDTHS=$(jseval "(function(){
  var p=document.querySelector('.mm-link path[stroke=\"none\"]');
  if(!p) return 'notaper';
  var n=p.getAttribute('d').match(/-?[0-9.]+/g).map(Number);
  var pt=[]; for(var i=0;i<n.length;i+=2) pt.push([n[i],n[i+1]]);
  var half=pt.length/2-1;
  var d=function(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1])};
  return d(pt[0],pt[pt.length-1]).toFixed(2)+':'+d(pt[half],pt[half+1]).toFixed(2);
})()")
echo "  实测粗细端 = ${WIDTHS}"
ok "粗端宽度=8" "${WIDTHS%%:*}" "8.00"
ok "细端宽度=2" "${WIDTHS##*:}" "2.00"

say "7) 旧文档兼容：只有旧 theme 键、没有 __baseStyle 的文档不能回归"
# 阅读端从 smmThemeToBase 换成 snapshotBase 之后，旧文档必须仍能读到旧键
# （snapshotBase 内部在无 __baseStyle 时回落 smmThemeToBase）。这段盯死这件事。
python3 - "$DATA/legacy.json" <<'PY'
import json, sys
n = lambda t, *k: {"data": {"text": t, "expand": True, "uid": "lg-" + str(abs(hash(t)) % 9999)}, "children": list(k)}
seed = {
    "version": 2,
    "root": {"data": {"text": "旧文档", "expand": True, "uid": "lg-root"},
             "children": [n("分支A", n("子1"), n("子2")), n("分支B")]},
    "layout": "mindMap",
    # ⚠️ 故意只有旧键：无 __baseStyle、无 __canvasThemeId
    "theme": {"backgroundColor": "#fff3e0", "lineColor": "#d84315", "lineWidth": 3,
              "radius": 6, "strokeWidth": 2},
}
with open(sys.argv[1], "w") as f:
    json.dump({"content": json.dumps(seed, ensure_ascii=False)}, f)
PY
curl --noproxy '*' -s -X PATCH "$BASE/api/docs/3" -H "$AUTH" \
  -H 'Content-Type: application/json' --data-binary @"$DATA/legacy.json" >/dev/null 2>&1
"$AB" wait 1200 >/dev/null 2>&1
"$AB" open "$BASE/books/1?docId=3&tab=read" >/dev/null 2>&1
"$AB" wait 4000 >/dev/null 2>&1
ok "旧文档·导图已渲染" "$(jseval "document.querySelectorAll('.mm-node').length>0")" "true"
ok "旧文档·无 taper(旧键无线型)" "$(jseval "document.querySelectorAll('.mm-link path[stroke=\"none\"]').length")" "0"
# ⚠️ 背景不是 SVG <rect>：画布底色是 .mm-stage 的 CSS background（<rect> 只在导出克隆里临时塞）。
# 注意 Chrome 会把 #fff3e0 序列化成 rgb()
ok "旧文档·背景用旧 backgroundColor" "$(jseval "(function(){var s=document.querySelector('.mm-stage');return s?s.style.background:'no'})()")" "rgb(255, 243, 224)"
# ⚠️ 连线颜色默认走 linkColorMode=auto（各分支色），旧 lineColor 只作无分支色时的兜底，
#    直接断言 stroke 颜色会误判为回归；旧 lineWidth 才是无歧义的回落证据。
ok "旧文档·连线宽用旧 lineWidth" "$(jseval "(function(){var p=document.querySelector('.mm-link path');return p?String(p.getAttribute('stroke-width')):'no'})()")" "3"
# 旧 strokeWidth 回落成 base.strokeWidth → 节点框描边宽
ok "旧文档·节点描边宽用旧 strokeWidth" "$(jseval "(function(){var r=document.querySelector('.mm-node .mm-rect');return r?String(r.getAttribute('stroke-width')):'no'})()")" "2"

echo ""
echo "==== 结果：PASS=$PASS FAIL=$FAIL ===="
if [ "$FAIL" -eq 0 ]; then echo "MM_XMODE_PASS"; else echo "MM_XMODE_FAIL"; fi
