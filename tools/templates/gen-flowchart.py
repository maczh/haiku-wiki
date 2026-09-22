#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 `_src/flowchart/*.mmd` 的 Mermaid 模板源文件生成到内置模板 JSON。

为什么单独一套
--------------
mermaid 正文是「源码」而不是 Markdown，混进 gen.py 的 Markdown 管线会被当成普通文档；
而且它需要自己的静态校验（mermaid 语法、图型白名单）。因此独立一份源文件目录与生成器：

    server/internal/repository/templates/_src/flowchart/<NNN-名字>.mmd

    文件开头是 front matter（与 gen.py 同款）：
        ---
        name: 用户注册流程
        title: 用户注册流程图        # 缺省与 name 相同
        category: 流程图模板·流程图   # 缺省沿用文件级 category
        ---
        flowchart TD
          A[开始] --> B[结束]

生成规则
--------
* 文件按文件名排序（用三位序号前缀分组：010-029 流程图 / 030-049 时序图 …），sort 从 10 起按 10 递增；
* 正文必须是 8 种受支持图型之一（MERMAID_KINDS），首行关键字即图型；
* 正文禁止出现「【…】」占位符（模板一律用示例内容填充）；
* 幂等：反复执行结果一致。

用法
----
    python3 tools/templates/gen-flowchart.py            # 生成/更新
    python3 tools/templates/gen-flowchart.py --check    # 只校验（CI / 回归用）
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
TPL_DIR = os.path.join(REPO, "server", "internal", "repository", "templates")
SRC_DIR = os.path.join(TPL_DIR, "_src", "flowchart")
TARGET = "flowchart.json"
DOC_TYPE = "flowchart"
FILE_CATEGORY = "流程图模板"

# 受支持的 mermaid 图型（首行关键字）
MERMAID_KINDS = (
    "flowchart",
    "graph",
    "sequenceDiagram",
    "classDiagram",
    "gantt",
    "erDiagram",
    "timeline",
    "pie",
    "mindmap",
)


def parse_front_matter(text, path):
    """解析 `---` 包裹的 front matter，返回 (meta, body)。"""
    if not text.startswith("---"):
        raise SystemExit(f"[gen-flowchart] {path}: 缺少 front matter（文件需以 --- 开头）")
    lines = text.split("\n")
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        raise SystemExit(f"[gen-flowchart] {path}: front matter 未闭合")
    meta = {}
    for line in lines[1:end]:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise SystemExit(f"[gen-flowchart] {path}: front matter 行无法解析: {line!r}")
        k, v = line.split(":", 1)
        meta[k.strip()] = v.strip()
    body = "\n".join(lines[end + 1:]).strip("\n")
    return meta, body


def load_sources():
    if not os.path.isdir(SRC_DIR):
        raise SystemExit(f"[gen-flowchart] 源目录不存在: {SRC_DIR}")
    entries = []
    for fn in sorted(os.listdir(SRC_DIR)):
        if not fn.endswith(".mmd"):
            continue
        path = os.path.join(SRC_DIR, fn)
        with open(path, encoding="utf-8") as f:
            meta, body = parse_front_matter(f.read(), path)
        name = meta.get("name", "").strip()
        if not name:
            raise SystemExit(f"[gen-flowchart] {path}: front matter 缺少 name")
        if not body.strip():
            raise SystemExit(f"[gen-flowchart] {path}: 正文为空")
        if "【" in body and "】" in body:
            raise SystemExit(f"[gen-flowchart] {path}: 正文出现「【…】」占位符，请改为示例内容")
        kind = body.strip().split("\n")[0].strip().split()[0]
        if kind not in MERMAID_KINDS:
            raise SystemExit(f"[gen-flowchart] {path}: 图型 {kind!r} 不在白名单 {MERMAID_KINDS}")
        entries.append(
            {
                "name": name,
                "title": meta.get("title", "").strip() or name,
                "category": meta.get("category", "").strip() or FILE_CATEGORY,
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
    kinds = {}
    for e in entries:
        k = e["content"].strip().split("\n")[0].strip().split()[0]
        kinds[k] = kinds.get(k, 0) + 1
    print("[gen-flowchart] 源模板 %d 个：%s" % (len(entries), "、".join(f"{k}×{v}" for k, v in sorted(kinds.items()))))
    if old != text:
        if check:
            print("[gen-flowchart] ❌ %s 与源文件不一致，请执行 python3 tools/templates/gen-flowchart.py" % TARGET)
            return 1
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print("[gen-flowchart] 已更新 %s" % TARGET)
    else:
        print("[gen-flowchart] 无变化")
    return 0


if __name__ == "__main__":
    sys.exit(main())
