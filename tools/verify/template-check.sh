#!/usr/bin/env bash
# 内置文档模板「源 → 生成物」一致性与静态校验（不起服务、不用浏览器，秒级）。
#
# 覆盖：
#   1. markdown 模板：_src/<名>/*.md → templates/*.json        （gen.py --check）
#   2. 流程图模板：  _src/flowchart/*.mmd → flowchart.json      （gen-flowchart.py --check）
#   3. 绘图模板：    _src/drawing/*.json → drawing.json         （gen-drawing.py --check，内含版式校验）
#   4. 甘特排期基准：_src/flowchart/0[78]x（mermaid gantt）      （retime-gantt.py --check，防整图落在过去）
#   5. mermaid 语法：逐条用 mermaid v11 parse 校验 flowchart.json（web/scripts/check-mermaid.mjs）
#   6. 结构自检：    doc_type 白名单 / 必填字段 / 正文契约（drawing 必须带 xml+svg 且 SVG 结构干净）
#
# 用法：bash tools/verify/template-check.sh
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
NODE=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin/node
PY=python3

PASS=0
FAIL=0

step() {  # step <描述> <命令...>
  local desc=$1
  shift
  local out
  if out=$("$@" 2>&1); then
    echo "✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "❌ $desc"
    echo "$out" | tail -12 | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi
}

cd "$REPO" || exit 1

echo "=== 内置模板静态校验 ==="

step "markdown 源与 JSON 一致（gen.py --check）" \
  "$PY" tools/templates/gen.py --check
step "流程图源与 JSON 一致（gen-flowchart.py --check）" \
  "$PY" tools/templates/gen-flowchart.py --check
step "绘图源与 JSON 一致 + 版式校验（gen-drawing.py --check）" \
  "$PY" tools/templates/gen-drawing.py --check
step "甘特排期未整图落在过去（retime-gantt.py --check）" \
  "$PY" tools/templates/retime-gantt.py --check
step "mermaid 语法校验（mermaid v11 parse）" \
  "$NODE" web/scripts/check-mermaid.mjs

# 结构自检：逐个模板文件核对必填字段与正文契约
struct_out=$("$PY" - <<'PY' 2>&1
import glob, json, os, re, sys

TPL = "server/internal/repository/templates"
ALLOWED = {"markdown", "sheet", "mindmap", "gantt", "whiteboard", "drawing", "flowchart"}
bad = []
total = 0
kinds = {}
for p in sorted(glob.glob(os.path.join(TPL, "*.json"))):
    doc = json.load(open(p, encoding="utf-8"))
    file_type = doc.get("doc_type", "")
    file_cat = doc.get("category", "")
    for t in doc.get("templates", []):
        total += 1
        dt = t.get("doc_type", file_type)
        name = t.get("name") or ""
        kinds[dt] = kinds.get(dt, 0) + 1
        if dt not in ALLOWED:
            bad.append("%s / %s: doc_type 非法 %r" % (os.path.basename(p), name, dt))
        for k in ("name", "title", "sort"):
            if t.get(k) in (None, ""):
                bad.append("%s / %s: 缺字段 %s" % (os.path.basename(p), name, k))
        if not (t.get("category") or file_cat):
            bad.append("%s / %s: 缺 category" % (os.path.basename(p), name))
        c = t.get("content")
        if c is None or (isinstance(c, str) and not c.strip()):
            bad.append("%s / %s: content 为空" % (os.path.basename(p), name))
            continue
        if dt == "drawing":
            try:
                obj = json.loads(c) if isinstance(c, str) else c
            except Exception as e:  # noqa: BLE001
                bad.append("%s / %s: drawing content 不是 JSON（%s）" % (os.path.basename(p), name, e))
                continue
            if not str(obj.get("xml", "")).lstrip().startswith("<"):
                bad.append("%s / %s: drawing 缺 mxGraphModel xml" % (os.path.basename(p), name))
            if not str(obj.get("svg", "")).lstrip().startswith("<svg"):
                bad.append("%s / %s: drawing 缺矢量 svg 预览" % (os.path.basename(p), name))
            svg = str(obj.get("svg", "")).strip()
            if not svg.endswith("</svg>"):
                bad.append("%s / %s: drawing 的 svg 未以 </svg> 结尾" % (os.path.basename(p), name))
            # 曾经把网格 pattern 用 out.insert 插进箭头 defs 内部形成嵌套 <defs>：
            # 「两个 <defs 之间没有 </defs>」即嵌套。
            if re.search(r"<defs\b(?:(?!</defs>).)*<defs\b", svg, re.S):
                bad.append("%s / %s: drawing 的 svg 出现嵌套 <defs>" % (os.path.basename(p), name))
        if dt == "flowchart" and isinstance(c, str):
            first = c.strip().split("\n")[0].strip().split()[0]
            if first not in ("flowchart", "graph", "sequenceDiagram", "classDiagram", "gantt",
                             "erDiagram", "timeline", "pie", "mindmap"):
                bad.append("%s / %s: 图型 %r 不在白名单" % (os.path.basename(p), name, first))
        if isinstance(c, str) and "【" in c and "】" in c:
            bad.append("%s / %s: 正文含【…】占位符" % (os.path.basename(p), name))

print("模板总数 %d：%s" % (total, "、".join("%s×%d" % kv for kv in sorted(kinds.items()))))
for b in bad[:20]:
    print("  -", b)
sys.exit(1 if bad else 0)
PY
)
if [ $? -eq 0 ]; then
  echo "✅ 模板结构自检（$(echo "$struct_out" | head -1)）"
  PASS=$((PASS + 1))
else
  echo "❌ 模板结构自检"
  echo "$struct_out" | sed 's/^/    /'
  FAIL=$((FAIL + 1))
fi

echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" = "0" ]; then
  echo "TEMPLATE_CHECK_OK"
  exit 0
fi
echo "TEMPLATE_CHECK_FAILED"
exit 1
