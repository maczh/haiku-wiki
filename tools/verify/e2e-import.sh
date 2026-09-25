#!/usr/bin/env bash
# 导入端到端验证：真实 xlsx / docx / pdf / md.zip 走浏览器导入链路，
# 断言本轮需求「xlsx/docx 落为可编辑的 OnlyOffice 办公文档（sheet/word），不再拆分工作表、也不再是只读附件」。
#
# 关于「选择文件」：agent-browser 的 upload 在本机对该 React 隐藏 input 静默失效
# （命令返回成功但 input.files.length 仍为 0），因此改用 gen-upload-js.py 生成一段
# 在页面内注入的 JS：用真实 File + DataTransfer 设置 input.files 并派发 change，
# 走的是应用真实的 onChange → parseFile → ImportDialog 链路，仅替代 OS 文件选择器。
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
PORT=${PORT:-18081}
BASE=http://127.0.0.1:$PORT
TS=$(date +%s)
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DATA=/home/macro/.workbuddy/tmp/imp-data-$TS
OUT=/home/macro/.workbuddy/tmp/imp-out-$TS
BIN=${HAIKU_BIN:-/home/macro/.workbuddy/tmp/haiku-wiki}
UPLOAD_JS_OUT=$OUT/imp-upload.js
mkdir -p "$DATA" "$OUT"

# 前置检查：二进制存在 + 端口空闲。端口被占用时（常见于别的会话留下的「幽灵实例」，
# `ps` 看不到）本脚本会连上**别人的**服务、并在别人的库里注册用户 → 报「注册失败」，
# 极易被误读成产品缺陷。宁可在这里明确失败，并用 PORT=<空闲端口> 重跑。
[ -x "$BIN" ] || { echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/api/books" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi

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

TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
  -d '{"username":"imp","name":"Imp","email":"imp@example.com","password":"secret123"}' | jq -r '.data.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then echo "❌ 注册失败"; tail -10 "$OUT/server.log"; exit 1; fi
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

BOOK=$(curl --noproxy '*' -s -X POST "$BASE/api/books" "${H[@]}" \
  -d '{"name":"导入验证库","description":"import e2e","visibility":"private"}' | jq -r '.data.id')
echo "知识库 ID = $BOOK，初始文档数 = $(curl --noproxy '*' -s "$BASE/api/books/$BOOK/docs" "${H[@]}" | jq '.data|length')"

echo "== 浏览器：打开知识库 → 模拟选中 3 个文件 =="
"$AB" set viewport 1560 900 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1; "$AB" wait 2000 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); 'ok'" >/dev/null 2>&1
# ImportDialog 已是「按需挂载」（见按需分包第 3 层修复），知识库页上不再有隐藏的 file input。
# 走 ?import=file 直达参数自动打开「导入文档」抽屉，再注入文件。
"$AB" open "$BASE/books/$BOOK?import=file" >/dev/null 2>&1; "$AB" wait 5000 >/dev/null 2>&1
DRAWER=$("$AB" eval "(document.querySelector('.ant-drawer-title')||{}).textContent||'无'" 2>&1 | tail -1)
echo "  导入抽屉: $DRAWER"

echo "== 生成 Markdown 包夹具（md + 图片） =="
# 覆盖三种引用形态（行内 / HTML img / 引用式定义）+ 同图多写法 + URL 编码 + 外链 + 缺失图。
# 图片字节用合成头即可：导入链路只搬运字节、不解析图片内容。
python3 - "$HERE/fixtures/import-fixtures" <<'PYEOF'
import base64, os, pathlib, sys, zipfile
fix = pathlib.Path(sys.argv[1])
fix.mkdir(parents=True, exist_ok=True)
md = """# 图文演示

![图A](images/a.png)
![图A别写](./images/a.png)
![圆 片](img/%E5%9C%86%20%E7%89%87/b.jpg)
<img src="images/c.gif" />
![外链](https://example.com/remote.png)
![缺失](missing.png)

[refp]: img/ref.png
![引用式][refp]
"""
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
# ref.png 必须与 a.png 字节不同：CAS 按内容寻址，字节相同会被秒传归并成同一 URL
png2 = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
out = fix / '图文演示.md.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('图文演示.md', md)
    z.writestr('images/a.png', png)
    z.writestr('img/圆 片/b.jpg', b'\xff\xd8\xff\xe0\x00\x10JFIF')
    z.writestr('images/c.gif', b'GIF89a')
    z.writestr('img/ref.png', png2)
print('生成 %s（%d 字节）' % (out, out.stat().st_size))
PYEOF

UPLOAD_JS_OUT="$UPLOAD_JS_OUT" python3 "$HERE/gen-upload-js.py"
echo "  注入结果: $("$AB" eval "$(cat "$UPLOAD_JS_OUT")" 2>&1 | tail -1)"

echo "== 等待导入完成 =="
ok=0
for _ in $(seq 1 60); do
  if "$AB" eval "document.body.innerText.includes('完成：成功')" 2>&1 | tail -1 | grep -q true; then ok=1; break; fi
  sleep 0.75
done
echo "  完成提示出现: $ok"
"$AB" eval "(document.body.innerText.match(/完成：成功[^\\n]*/)||[''])[0]" 2>&1 | tail -1
echo "  逐文件结果: $("$AB" eval "(function(){var t=document.body.innerText;var m=t.match(/[^\\n]*(导入成功|失败|不支持|解析)[^\\n]*/g);return m?m.join(' | '):'(无)'})()" 2>&1 | tail -1)"
"$AB" screenshot "$OUT/01-导入结果抽屉.png" >/dev/null 2>&1

echo "== 目录树断言（API 为事实来源） =="
TREE=$(curl --noproxy '*' -s "$BASE/api/books/$BOOK/docs" "${H[@]}")
echo "$TREE" > "$OUT/tree.json"
echo "$TREE" | jq -r '.data[] | "  id=\(.id) parent=\(.parent_id) type=\(.doc_type) title=\(.title)"' | sort -t= -k4

pass=0; fail=0
chk() {
  if [ "$2" = "$3" ]; then echo "  ✅ $1 = $3"; pass=$((pass+1));
  else echo "  ❌ $1：期望 $2，实际 $3"; fail=$((fail+1)); fi
}
# xlsx：落为单一 sheet 办公文档（OnlyOffice 原生支持多工作表，不再拆成父+子表格）
SID=$(echo "$TREE" | jq -r '.data[]|select(.title=="多工作表")|.id')
chk "xlsx 导入为单一 sheet 办公文档" "sheet" "$(echo "$TREE" | jq -r '.data[]|select(.title=="多工作表")|.doc_type')"
chk "sheet 文档不再拆分工作表（无子文档）" "0" "$(echo "$TREE" | jq '[.data[]|select(.parent_id==('"${SID:-0}"'))]|length')"
# docx：落为 word 办公文档（OnlyOffice 编辑，不再是只读附件）
chk "docx 导入为 word 办公文档（可编辑）" "word" "$(echo "$TREE" | jq -r '.data[]|select(.title=="导入的Word文档")|.doc_type')"
# pdf：仍是附件（不可编辑，前端 pdf.js 预览）
chk "pdf 导入为附件类型" "file" "$(echo "$TREE" | jq -r '.data[]|select(.title=="导入的PDF文档")|.doc_type')"

echo "== Markdown 包（.md.zip）断言：图片转存 + 正文地址重写 =="
chk "md.zip 导入为 markdown 文档（标题取 H1）" "markdown" "$(echo "$TREE" | jq -r '.data[]|select(.title=="图文演示")|.doc_type')"
MDID=$(echo "$TREE" | jq -r '.data[]|select(.title=="图文演示")|.id')
MDCONTENT=$(curl --noproxy '*' -s "$BASE/api/docs/$MDID" "${H[@]}" | jq -r '.data.doc.content')
echo "$MDCONTENT" > "$OUT/mdzip-content.md"
CAS_CNT=$(printf '%s' "$MDCONTENT" | grep -o '/uploads/cas/' | wc -l)
CAS_UNIQ=$(printf '%s' "$MDCONTENT" | grep -o '/uploads/cas/[^)"'"'"' ]*' | sort -u | wc -l)
chk "正文含 5 处文库图片地址（4 张图 + 同图多写法）" "5" "$CAS_CNT"
chk "正文含 4 个不同图片 URL（zip 内同文件去重）" "4" "$CAS_UNIQ"
# 缺失的 missing.png 本就应保留，不算残留；其余 zip 内相对路径必须全部重写
if printf '%s' "$MDCONTENT" | grep -q '](images/a.png)\|src="images/\|(img/'; then
  echo "  ❌ 正文仍残留 zip 内相对路径"; fail=$((fail+1))
else
  echo "  ✅ 相对路径已全部重写"; pass=$((pass+1))
fi
chk "外链保留不动" "1" "$(printf '%s' "$MDCONTENT" | grep -c 'https://example.com/remote.png')"
chk "缺失图片引用保留原样" "1" "$(printf '%s' "$MDCONTENT" | grep -c '(missing.png)')"
FIRSTIMG=$(printf '%s' "$MDCONTENT" | grep -o '/uploads/cas/[^)"'"'"' ]*' | head -1)
chk "转存图片可访问（$FIRSTIMG）" "200" "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE$FIRSTIMG")"

echo "== sheet 文档正文校验（office 引用 JSON，而非 luckysheet celldata） =="
SCONTENT=$(curl --noproxy '*' -s "$BASE/api/docs/$SID" "${H[@]}" | jq -r '.data.doc.content')
echo "  content: $SCONTENT"
# 新存储契约：正文是 {url,filename,size,ext} 附件引用（见 lib/officeDoc.ts isOfficeContent）
echo "$SCONTENT" | jq -e '.url and .filename and (.ext=="xlsx")' >/dev/null 2>&1 \
  && { echo "  ✅ sheet 正文为 office 引用（url/filename/ext=xlsx）"; pass=$((pass+1)); } \
  || { echo "  ❌ sheet 正文不是 office 引用"; fail=$((fail+1)); }

echo "== 办公文档阅读态抽查（docx → OnlyOffice 可编辑，非只读附件预览） =="
DID=$(echo "$TREE" | jq -r '.data[]|select(.title=="导入的Word文档")|.id')
"$AB" open "$BASE/books/$BOOK?docId=$DID&tab=read" >/dev/null 2>&1
"$AB" wait 15000 >/dev/null 2>&1
echo "  旧只读容器 .docx-preview 已消失: $("$AB" eval "!document.querySelector('.docx-preview')" 2>&1 | tail -1)"
echo "  OnlyOffice 容器可见: $("$AB" eval "!!document.querySelector('.onlyoffice-container')" 2>&1 | tail -1)"
echo "  编辑器 iframe 挂载: $("$AB" eval "!!document.querySelector('iframe[name=\"frameEditor\"]')" 2>&1 | tail -1)"
"$AB" screenshot "$OUT/02-docx-OnlyOffice.png" >/dev/null 2>&1

echo "== 页面错误 =="
"$AB" errors 2>&1 | tail -6

echo "== 结果：通过 $pass 项，失败 $fail 项 =="
echo "输出目录：$OUT"
