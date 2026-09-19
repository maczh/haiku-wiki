#!/usr/bin/env bash
# 文库工作台（BookDashboard）端到端验证（单源生产形态）。
#
# 背景：知识库页右侧「未选中文档」的空态原来是只有一句提示的 Empty；
# 现在是文库工作台：概览条 + 工作台三卡（待办/甘特/日历，本书范围）+ 文库内搜索 + 最近更新。
#
# 覆盖点：
#   ① 书页空态不再出现裸 "0" 文本（任务 #18 的回归断言；根因是 Number(...||0) 短路渲染）
#   ② 工作台三卡只统计**本书**：本书有待办 → 卡出现且数字正确；他书有待办、本书没有 → 不串卡
#   ③ 「今天到期」不算逾期（isOverdue 只把日期解析成当天 00:00 的缺陷已修：当天结束才起算）
#   ④ 文库内搜索走后端 /search?book_id=：命中本书文档；他书同关键词不出现
#   ⑤ 最近更新 / 概览统计 / 快捷操作（可写才显示）
#
# 落库一律用 API 回查断言（不看界面文案就下结论）。
set -uo pipefail
export PATH=/usr/local/go/bin:/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro TMPDIR=/home/macro/.workbuddy/tmp
export XDG_RUNTIME_DIR=$TMPDIR/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars"
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR"
AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser

PORT=${PORT:-8196}
BASE=http://127.0.0.1:$PORT
ROOT=$TMPDIR/e2e-bdash-$(date +%s); SHOTS=$ROOT/shots; mkdir -p "$SHOTS"
[ -x "$TMPDIR/haiku-wiki" ] || { echo "❌ 找不到后端二进制 —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi
DATA_DIR="$ROOT/data" PORT=$PORT JWT_SECRET=e2ebdash GIN_MODE=release "$TMPDIR/haiku-wiki" >"$ROOT/server.log" 2>&1 &
SPID=$!
cleanup() { "$AB" close >/dev/null 2>&1; kill $SPID 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT
for _ in $(seq 1 80); do c=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$BASE/" || true); [ "$c" = "200" ] && break; sleep 0.5; done

PASS=0; FAIL=0
ck() { if [ "$2" = "$3" ]; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1  期望[$2] 实际[$3]"; FAIL=$((FAIL+1)); fi; }
ckc() { case "$3" in *"$2"*) echo "  ✅ $1"; PASS=$((PASS+1));; *) echo "  ❌ $1  未包含[$2] 实际[$3]"; FAIL=$((FAIL+1));; esac; }
ckn() { case "$3" in *"$2"*) echo "  ❌ $1  不应包含[$2] 实际[$3]"; FAIL=$((FAIL+1));; *) echo "  ✅ $1"; PASS=$((PASS+1));; esac; }
q() { "$AB" eval "$1" 2>&1 | grep -v '^{}' | tail -1 | sed -e 's/^"//' -e 's/"$//'; }
shot() { "$AB" screenshot "$SHOTS/$1" >/dev/null 2>&1; echo "    📸 $1"; }
go() { "$AB" open "$1" >/dev/null 2>&1; "$AB" wait "$2" >/dev/null 2>&1; }
api() { curl -s --noproxy '*' -H "Authorization: Bearer $TOKEN" "$BASE$1"; }

# 裸 "0" 文本节点探针（0/00/0000 都命中）
bareZero() {
  q "(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let n,c=0,out=[];while(n=w.nextNode()){const t=n.textContent.trim();
      if(/^0+\$/.test(t)){c++;if(out.length<4)out.push(t)}}
    return String(c)+(out.length?(' 例如 '+out.join(',')):'')})()"
}

echo "== 0. 播种 =="
BASE="$BASE" OUT="$ROOT/ids.json" TODAY=$(date +%F) python3 - <<'PY'
import json, os, urllib.request, urllib.error
BASE = os.environ["BASE"]; TODAY = os.environ["TODAY"]
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token: r.add_header("Authorization", "Bearer " + token)
    try:
        with op.open(r, timeout=30) as resp: p = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code} {e.read().decode()[:300]}")
    if p.get("code") != 0: raise SystemExit(f"{method} {path} -> {p}")
    return p.get("data")

tok = api("POST", "/api/auth/register",
          {"username": "bdash_u", "name": "BD", "email": "bdash@x.com", "password": "Passw0rd!123"})["token"]
def set_doc(doc_id, content):
    api("PATCH", f"/api/docs/{doc_id}", {"content": content}, tok)

# 本书：有目录、markdown、待办（含「今天到期」「逾期」「已完成」各 1）
bookA = api("POST", "/api/books", {"name": "工作台之书"}, tok)
folderA = api("POST", f"/api/books/{bookA['id']}/docs", {"title": "项目目录", "doc_type": "folder"}, tok)
mdA = api("POST", f"/api/books/{bookA['id']}/docs", {"title": "需求说明", "doc_type": "markdown"}, tok)
set_doc(mdA["id"], "# 需求说明\n\n量子猫独角兽只在这里出现。")
todoA = api("POST", f"/api/books/{bookA['id']}/docs", {"title": "本周待办", "doc_type": "todo"}, tok)
todo_content = json.dumps({"version": 1, "items": [
    {"id": "t1", "text": "今天到期的事", "done": False, "due": TODAY, "priority": "high", "note": ""},
    {"id": "t2", "text": "已经逾期的事", "done": False, "due": "2026-09-01", "priority": "", "note": ""},
    {"id": "t3", "text": "已完成的事", "done": True, "due": "", "priority": "low", "note": ""},
    {"id": "t4", "text": "没截止的事", "done": False, "due": "", "priority": "", "note": ""},
]}, ensure_ascii=False)
set_doc(todoA["id"], todo_content)

# 他书：markdown 命中同关键词 + 一张待办（用来验证「不串卡」）
bookB = api("POST", "/api/books", {"name": "别家之书"}, tok)
mdB = api("POST", f"/api/books/{bookB['id']}/docs", {"title": "别家的笔记", "doc_type": "markdown"}, tok)
set_doc(mdB["id"], "量子猫独角兽也在这里出现。")
todoB = api("POST", f"/api/books/{bookB['id']}/docs", {"title": "别家待办", "doc_type": "todo"}, tok)
set_doc(todoB["id"], json.dumps({"version": 1, "items": [
    {"id": "x1", "text": "别家的事", "done": False, "due": "", "priority": "", "note": ""},
]}, ensure_ascii=False))

json.dump({"token": tok, "bookA": bookA["id"], "bookB": bookB["id"],
           "mdA": mdA["id"], "todoA": todoA["id"], "mdB": mdB["id"]},
          open(os.environ["OUT"], "w"))
print("播种完成")
PY
TOKEN=$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['token'])")
BOOKA=$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['bookA'])")
BOOKB=$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['bookB'])")
MDA=$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['mdA'])")
TODOA=$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['todoA'])")

echo "== 1. API 回查：book_id 限定的工作台与搜索 =="
wbA=$(api "/api/workbench?book_id=$BOOKA" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(sum(1 for i in d['items'] if i['doc_type']=='todo'), d['counts'].get('todo',0))")
ck "本书工作台只含本书待办（条目/计数）" "1 1" "$wbA"
wbB=$(api "/api/workbench?book_id=$BOOKB" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(sum(1 for i in d['items'] if i['doc_type']=='todo'), d['counts'].get('todo',0))")
ck "他书工作台只含他书待办" "1 1" "$wbB"
srchA=$(api "/api/search?q=%E9%87%8F%E5%AD%90%E7%8C%AB&book_id=$BOOKA" | python3 -c "import sys,json;print(','.join(str(h['doc_id']) for h in json.load(sys.stdin)['data']))")
ck "book_id 限定搜索只命中本书" "$MDA" "$srchA"
srchB=$(api "/api/search?q=%E9%87%8F%E5%AD%90%E7%8C%AB&book_id=$BOOKB" | python3 -c "import sys,json;print(','.join(str(h['doc_id']) for h in json.load(sys.stdin)['data']))")
ck "book_id 限定搜索命中他书自己的文档" "$(python3 -c "import json;print(json.load(open('$ROOT/ids.json'))['mdB'])")" "$srchB"
srchB2=$(api "/api/search?q=%E9%87%8F%E5%AD%90%E7%8C%AB" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")
ck "全局搜索两书都命中" "2" "$srchB2"

echo "== 2. 书页空态：文库工作台渲染 + 无裸 0 =="
go "$BASE/login" 2500
q "localStorage.setItem('hk_token','$TOKEN'); 'ok'" >/dev/null
go "$BASE/books/$BOOKA" "[data-testid='hk-book-dashboard']"
ck "工作台面板出现" "yes" "$(q "document.querySelector('[data-testid=\"hk-book-dashboard\"]')?'yes':'no'")"
ck "概览条带书名" "yes" "$(q "document.querySelector('.hk-bdash-title')?.textContent.includes('工作台之书')?'yes':'no'")"
ck "统计含 3 篇文档（目录+markdown+待办）" "yes" "$(q "document.querySelector('.hk-bdash-meta')?.textContent.includes('3 篇文档')?'yes':'no'")"
ck "统计含办公文档计数" "yes" "$(q "document.querySelector('.hk-bdash-meta')?.textContent.includes('1 篇办公文档')?'yes':'no'")"
ck "快捷操作出现（可写）" "yes" "$(q "document.querySelector('.hk-bdash-actions')?'yes':'no'")"
# 工作台统计里的「0」（如 未完成 0）是**合法内容**；bug 的特征是游离在组件外的裸 0。
# 故只统计 hk-book-dashboard 之外的裸 0 文本节点。
ck "组件外裸 0 文本节点数" "0" "$(q "(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n,c=0,out=[];while(n=w.nextNode()){const t=n.textContent.trim();if(/^0+$/.test(t)&&!n.parentElement.closest('[data-testid=\"hk-book-dashboard\"]')&&!n.parentElement.closest('.ant-tree')){c++;if(out.length<2){let el=n.parentElement,chain=[];for(let k=0;k<5&&el;k++){chain.push(el.tagName+(el.className&&typeof el.className==='string'?'.'+el.className.split(' ').slice(0,2).join('.'):''));el=el.parentElement}out.push(chain.join(' < '))}}}return c==0?'0':c+' 例如 '+out.join(' ; ')})()" | tail -1)"
ck "本书无甘特文档 → 不渲染空甘特卡" "no" "$(q "document.querySelector('[data-testid=\"hk-wb-gantt\"]')?'yes':'no'")"
shot "book-dashboard.png"

echo "== 3. 工作台三卡（本书范围）与逾期口径 =="
ck "待办卡出现" "yes" "$(q "document.querySelector('[data-testid=\"hk-wb-todo\"]')?'yes':'no'")"
# 中文经 eval 返回会被转义，判定放在浏览器里做，只回 ASCII 信号位
stat(){ q "(()=>{const el=document.querySelector('[data-testid=\"hk-wb-todo\"]');if(!el)return 'no';return el.textContent.includes('$1')?'yes':'no'})()" | tail -1; }
ck "未完成 3（今天到期+逾期+无截止）" "yes" "$(stat '3未完成')"
ck "逾期只算 1（今天到期不算逾期）" "yes" "$(stat '1已逾期')"
ck "已完成 1" "yes" "$(stat '1已完成')"
ck "没有把今天到期多算成逾期" "no" "$(stat '2已逾期')"
ckn "他书待办标题不出现" "别家待办" "$(q "document.querySelector('[data-testid=\"hk-book-workbench\"]')?.textContent||'无工作台区块'")"

echo "== 4. 文库内搜索（界面） =="
"$AB" fill '[data-testid="hk-book-search-input"]' "量子猫" >/dev/null 2>&1
sleep 1.2
ck "搜索只命中本书 1 条" "1" "$(q "document.querySelectorAll('[data-testid=\"hk-book-search-hit\"]').length")"
q "(()=>{const h=document.querySelector('[data-testid=\"hk-book-search-hit\"]');if(!h)return 'no';h.click();return 'clicked'})()" >/dev/null
"$AB" wait 1200 >/dev/null 2>&1
ck "点击命中后 URL 打开该文档" "$MDA" "$(q "new URLSearchParams(location.search).get('docId')")"

echo "== 5. 最近更新 =="
go "$BASE/books/$BOOKA" "[data-testid='hk-book-dashboard']"
recentN=$(q "document.querySelectorAll('.hk-bdash-recent-row').length")
ck "最近更新列出 2 篇（排除目录）" "2" "$recentN"
ckn "目录不进最近更新" "项目目录" "$(q "document.querySelector('[data-testid=\"hk-book-recent\"]')?.textContent||''")"

echo "== 6. 他书：卡片只来自本书 =="
go "$BASE/books/$BOOKB" "[data-testid='hk-book-dashboard']"
ck "他书工作台面板仍在" "yes" "$(q "document.querySelector('[data-testid=\"hk-book-dashboard\"]')?'yes':'no'")"
# 他书自己有一张待办 → 卡应出现；但内容必须是他书的，不能混入本书条目
ck "他书自己的待办卡出现" "yes" "$(q "document.querySelector('[data-testid=\"hk-wb-todo\"]')?'yes':'no'")"
ckn "本书待办条目不串入他书卡" "今天到期的事" "$(q "document.querySelector('[data-testid=\"hk-wb-todo\"]')?.textContent||''")"

echo
echo "RESULTS: PASS=$PASS FAIL=$FAIL"
echo "截图目录: $SHOTS"
[ "$FAIL" = "0" ] && echo "BOOK_DASHBOARD_E2E_OK"
