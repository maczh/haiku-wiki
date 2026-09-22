#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 `_src/drawing/*.json` 的声明式绘图描述生成到内置模板 JSON（doc_type=drawing）。

正文契约（web/src/lib/drawioDoc.ts）：
    content = JSON.stringify({ version: 1, xml, svg })

* `xml`：mxGraphModel（draw.io 原生可编辑）
* `svg`：同版式的矢量预览（阅读页/分享页/模板预览只渲染它，不再加载 drawio 组件）

两者都由 tools/templates/drawio_kit.py 从同一份声明式描述渲染，天然一致。

用法
----
    python3 tools/templates/gen-drawing.py            # 生成/更新（含越界/重叠校验）
    python3 tools/templates/gen-drawing.py --check    # 只校验（CI / 回归用）
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import drawio_kit as K  # noqa: E402

TPL_DIR = os.path.join(REPO, "server", "internal", "repository", "templates")
SRC_DIR = os.path.join(TPL_DIR, "_src", "drawing")
TARGET = "drawing.json"
DOC_TYPE = "drawing"
FILE_CATEGORY = "绘图模板"


def load_sources():
    if not os.path.isdir(SRC_DIR):
        raise SystemExit(f"[gen-drawing] 源目录不存在: {SRC_DIR}")
    entries = []
    for fn in sorted(os.listdir(SRC_DIR)):
        if not fn.endswith(".json"):
            continue
        path = os.path.join(SRC_DIR, fn)
        with open(path, encoding="utf-8") as f:
            spec = json.load(f)
        for key in ("name", "title", "w", "h"):
            if key not in spec:
                raise SystemExit(f"[gen-drawing] {path}: 缺少字段 {key}")
        if not spec.get("nodes"):
            raise SystemExit(f"[gen-drawing] {path}: nodes 为空")
        issues = K.check(spec)
        if issues:
            print(f"[gen-drawing] ❌ {fn}（{spec['name']}）：")
            for it in issues[:8]:
                print("      -", it)
            raise SystemExit(f"[gen-drawing] {path}: 版式校验未通过（{len(issues)} 项）")
        body = json.loads(K.build(spec))
        svg_issues = K.check_svg(body["svg"])
        if svg_issues:
            print(f"[gen-drawing] ❌ {fn}（{spec['name']}）SVG 结构问题：")
            for it in svg_issues[:8]:
                print("      -", it)
            raise SystemExit(f"[gen-drawing] {path}: SVG 校验未通过（{len(svg_issues)} 项）")
        if "【" in json.dumps(body, ensure_ascii=False):
            print(f"[gen-drawing] ⚠️  {fn}: 正文出现「【…】」占位符")
        entries.append(
            {
                "name": spec["name"],
                "title": spec.get("title") or spec["name"],
                "category": spec.get("category") or FILE_CATEGORY,
                "content": body,
                "_src": os.path.relpath(path, REPO),
            }
        )
    return entries


def main():
    check = "--check" in sys.argv
    entries = load_sources()
    out = []
    sort_no = 10
    for e in entries:
        out.append(
            {
                "name": e["name"],
                "title": e["title"],
                "category": e["category"],
                "sort": sort_no,
                "content": e["content"],
            }
        )
        sort_no += 10
    doc = {"category": FILE_CATEGORY, "doc_type": DOC_TYPE, "templates": out}
    text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    path = os.path.join(TPL_DIR, TARGET)
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else ""

    cats = {}
    for e in entries:
        cats[e["category"]] = cats.get(e["category"], 0) + 1
    print("[gen-drawing] 源模板 %d 个：%s" % (len(entries), "、".join(f"{k}×{v}" for k, v in sorted(cats.items()))))
    if old != text:
        if check:
            print("[gen-drawing] ❌ %s 与源文件不一致，请执行 python3 tools/templates/gen-drawing.py" % TARGET)
            return 1
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print("[gen-drawing] 已更新 %s" % TARGET)
    else:
        print("[gen-drawing] 无变化")
    return 0


if __name__ == "__main__":
    sys.exit(main())
