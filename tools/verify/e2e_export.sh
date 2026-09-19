#!/usr/bin/env bash
# 导出接口端到端验证：启动后端 → 建库建文档 → 逐个格式导出并检查响应头/字节
set -uo pipefail

PORT=${PORT:-18080}
BASE=http://127.0.0.1:$PORT
TS=$(date +%s)
DATA=/home/macro/.workbuddy/tmp/e2e-data-$TS
OUT=/home/macro/.workbuddy/tmp/e2e-out-$TS
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BIN=${HAIKU_BIN:-/home/macro/.workbuddy/tmp/haiku-wiki}
[ -x "$BIN" ] || { echo "❌ 找不到后端二进制 $BIN —— 先跑 tools/build/build-embed.sh"; exit 1; }
if [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/api/books" || true)" != "000" ]; then
  echo "❌ 端口 $PORT 已被占用（可能是幽灵实例）→ 用 PORT=<空闲端口> 重跑本脚本"; exit 1
fi
PDF_SAMPLE=${PDF_SAMPLE:-$HERE/fixtures/exports/doc.pdf}

mkdir -p "$OUT" "$DATA"

DATA_DIR="$DATA" PORT=$PORT JWT_SECRET=e2e-secret-for-verify GIN_MODE=release "$BIN" >"$OUT/server.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT

# 等待服务就绪（绕过本机 http_proxy，逐个探测直到拿到 HTTP 响应）
CURL=(curl --noproxy '*' -s)
for _ in $(seq 1 80); do
  code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books" 2>/dev/null)
  if [ "$code" != "000" ] && [ -n "$code" ]; then break; fi
  sleep 0.25
done
echo "服务就绪探测：HTTP $code"

AUTH=(-H "Content-Type: application/json")

REG_RAW=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/register" "${AUTH[@]}" \
  -d '{"username":"e2e","name":"E2E","email":"e2e@example.com","password":"secret123"}')
TOKEN=$(echo "$REG_RAW" | jq -r '.data.token' 2>/dev/null)
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "❌ 注册失败，原始响应：$REG_RAW"
  tail -20 "$OUT/server.log"
  exit 1
fi
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
echo "✅ 注册成功，token 长度 ${#TOKEN}"

BOOK=$(curl --noproxy '*' -s -X POST "$BASE/api/books" "${H[@]}" \
  -d '{"name":"导出验证库","description":"e2e","visibility":"private"}' | jq -r '.data.id')
echo "✅ 知识库 ID = $BOOK"

mkdoc() { # title docType content
  local payload
  payload=$(jq -nc --arg t "$1" --arg d "$2" --arg c "$3" '{title:$t,doc_type:$d,content:$c}')
  curl --noproxy '*' -s -X POST "$BASE/api/books/$BOOK/docs" "${H[@]}" -d "$payload" | jq -r '.data.id'
}

MD_ID=$(mkdoc "服务端转换说明" "markdown" $'# 导出测试\n\n正文包含**加粗**、`行内代码`与[链接](https://example.com)。\n\n## 列表\n\n- 第一项\n- 第二项\n\n## 表格\n\n| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n| 香蕉 | 5 |\n\n> 引用：寄海文库导出')
SHEET_ID=$(mkdoc "季度统计表" "sheet" '{"version":1,"cells":{"0-0":{"text":"姓名"},"0-1":{"text":"部门"},"1-0":{"text":"张三"},"1-1":{"text":"研发"},"2-0":{"text":"李四"},"2-1":{"text":"产品"}},"colLen":26,"rowLen":100}')
MIND_ID=$(mkdoc "产品结构脑图" "mindmap" '{"version":2,"root":{"data":{"text":"寄海文库"},"children":[{"data":{"text":"产品","expand":true},"children":[{"data":{"text":"文库"}},{"data":{"text":"搜索"}}]},{"data":{"text":"研发","expand":true}}]}}')
FLOW_ID=$(mkdoc "导入流程" "flowchart" $'graph TD\n  A[开始] --> B{文件类型}\n  B -->|docx/pdf| C[原样保存]\n  B -->|xlsx| D[转为表格]\n  B -->|其它| E[解析正文]\n  C --> F[结束]\n  D --> F\n  E --> F')

# 附件型文档：上传原文件 → 以 FileRef JSON 建 file 文档
UP=$(curl --noproxy '*' -s -X POST "$BASE/api/uploads" -H "Authorization: Bearer $TOKEN" -F "file=@$PDF_SAMPLE")
URL=$(echo "$UP" | jq -r '.data.url')
FN=$(echo "$UP" | jq -r '.data.filename')
SZ=$(echo "$UP" | jq -r '.data.size')
REF=$(jq -nc --arg u "$URL" --arg f "$FN" --argjson s "$SZ" '{url:$u,filename:$f,size:$s,ext:"pdf"}')
FILE_ID=$(mkdoc "导入的PDF原件" "file" "$REF")
echo "✅ 文档 ID：md=$MD_ID sheet=$SHEET_ID mindmap=$MIND_ID flowchart=$FLOW_ID file=$FILE_ID（附件 $FN, ${SZ}B）"

echo
echo "===== 1) 格式清单接口 /api/export/docs/:id/formats ====="
for pair in "文档:$MD_ID" "表格:$SHEET_ID" "思维导图:$MIND_ID" "流程图:$FLOW_ID" "附件:$FILE_ID"; do
  name=${pair%%:*}; id=${pair##*:}
  curl --noproxy '*' -s "$BASE/api/export/docs/$id/formats" -H "Authorization: Bearer $TOKEN" \
    | jq -r --arg n "$name" '"  \($n)：doc_type=\(.data.doc_type) is_file=\(.data.is_file) default=\(.data.default) 可选=[\((.data.formats // []) | map(.value) | join(","))]"'
done

echo
echo "===== 2) 逐格式导出（HTTP / 字节数 / Content-Type / 文件识别）====="
PASS=0; FAIL=0
check() { # id format
  local id=$1 fmt=$2
  local tag="${id}-${fmt}"
  local body="$OUT/$tag.bin" hdr="$OUT/$tag.hdr"
  local code size mime kind
  code=$(curl --noproxy '*' -s -o "$body" -D "$hdr" -w '%{http_code}' "$BASE/api/export/docs/$id?format=$fmt" -H "Authorization: Bearer $TOKEN")
  size=$(stat -c%s "$body" 2>/dev/null || echo 0)
  mime=$(grep -i '^content-type:' "$hdr" | tr -d '\r' | sed 's/^[Cc]ontent-[Tt]ype: *//')
  kind=$(file -b "$body" | cut -c1-44)
  local disp
  disp=$(grep -i '^content-disposition:' "$hdr" | tr -d '\r' | sed 's/^[Cc]ontent-[Dd]isposition: *//')
  if [ "$code" = "200" ] && [ "$size" -gt 0 ]; then
    PASS=$((PASS+1))
    printf '  ✅ %-8s %-6s HTTP=%s %8sB  %-58s %s\n' "$(docname "$id")" "$fmt" "$code" "$size" "$mime" "$(basename "$disp" | sed "s/^attachment; filename\*=UTF-8''//")"
    printf '     └ %s\n' "$kind"
  else
    FAIL=$((FAIL+1))
    printf '  ❌ %-8s %-6s HTTP=%s size=%s\n' "$id" "$fmt" "$code" "$size"
    cat "$body" | head -3
  fi
}

docname() {
  case "$1" in
    "$MD_ID") echo "文档" ;;
    "$SHEET_ID") echo "表格" ;;
    "$MIND_ID") echo "思维导图" ;;
    "$FLOW_ID") echo "流程图" ;;
    "$FILE_ID") echo "附件" ;;
    *) echo "doc$1" ;;
  esac
}

for f in md docx pdf; do check "$MD_ID" "$f"; done
for f in xlsx csv json; do check "$SHEET_ID" "$f"; done
for f in km smm xmind mm png; do check "$MIND_ID" "$f"; done
for f in md svg png; do check "$FLOW_ID" "$f"; done
check "$FILE_ID" ""

echo
echo "===== 3) 边界：非法格式 / 默认格式 / 知识库打包 / 越权 ====="
code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/export/docs/$MD_ID?format=exe" -H "Authorization: Bearer $TOKEN")
echo "  非法格式 format=exe → HTTP $code（期望 400）"
code=$(curl --noproxy '*' -s -o "$OUT/default.bin" -w '%{http_code}' "$BASE/api/export/docs/$SHEET_ID" -H "Authorization: Bearer $TOKEN")
echo "  省略 format（默认格式）→ HTTP $code, size=$(stat -c%s "$OUT/default.bin")B, kind=$(file -b "$OUT/default.bin")"

zipcode=$(curl --noproxy '*' -s -o "$OUT/book.zip" -D "$OUT/book.hdr" -w '%{http_code}' "$BASE/api/export/books/$BOOK" -H "Authorization: Bearer $TOKEN")
echo "  知识库打包 → HTTP $zipcode, size=$(stat -c%s "$OUT/book.zip")B"
unzip -l "$OUT/book.zip" 2>/dev/null | sed -n '4,20p'

code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/export/docs/$MD_ID")
echo "  未登录导出 → HTTP $code（期望 401）"

# 目录穿越防护（直接构造恶意 FileRef 文档）
EVIL_ID=$(mkdoc "穿越测试" "file" '{"url":"/uploads/../../etc/passwd","filename":"p.txt","size":1,"ext":"txt"}')
code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/export/docs/$EVIL_ID" -H "Authorization: Bearer $TOKEN")
echo "  目录穿越附件 → HTTP $code（期望 404）"

echo
echo "===== 4) 附件型文档正文保护 ====="
prot=$(curl -s -X PATCH "$BASE/api/docs/$FILE_ID" "${H[@]}" -d '{"content":"{\"url\":\"/uploads/x.pdf\"}","source":"manual"}' | jq -r '.code')
echo "  改写附件正文 → code=$prot（期望 40001）"
renamed=$(curl -s -X PATCH "$BASE/api/docs/$FILE_ID" "${H[@]}" -d '{"title":"导入的PDF原件 V2","source":"manual"}' | jq -r '.data.doc.title')
echo "  仅改标题 → title=$renamed"

echo
echo "===== 结果：通过 $PASS 项，失败 $FAIL 项 ====="
echo "产物目录：$OUT"
[ "$FAIL" -eq 0 ]
