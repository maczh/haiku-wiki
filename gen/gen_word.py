# -*- coding: utf-8 -*-
"""Word 批量生成入口：展开 DSL → 调用 word_engine 渲染，主题循环分布。"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from design import theme, THEMES
from word_engine import render_word, add_h1, add_table, add_bullets, add_para, add_callout
from specs_word import WORD_TEMPLATES

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "generated_templates", "word")


def build_spec(raw, idx):
    th = theme(idx)  # 主题按序号循环，保证 10 套配色均被使用
    spec = {
        "title": raw["title"],
        "subtitle": raw.get("subtitle", ""),
        "cover_meta": raw.get("meta", []),
        "brand": "寄海文库 · 模板中心",
        "theme": idx % len(THEMES),
        "blocks": [],
    }
    for item in raw.get("sections", []):
        heading, kind, data = item[0], item[1], item[2]
        bold = True if len(item) > 3 else False
        spec["blocks"].append({"type": "h1", "text": heading})
        if kind == "kv":
            spec["blocks"].append({
                "type": "table",
                "headers": ["项目", "内容"],
                "rows": [[k, v] for k, v in data],
                "widths": [2.2, 4.3],
            })
        elif kind == "table":
            spec["blocks"].append({"type": "table", "headers": data["headers"],
                                  "rows": data["rows"]})
        elif kind == "bullets":
            spec["blocks"].append({"type": "bullets", "items": data})
        elif kind == "para":
            spec["blocks"].append({"type": "para", "text": data, "bold": bold})
        elif kind == "callout":
            spec["blocks"].append({"type": "callout", "text": data})
    return spec


def main():
    os.makedirs(OUT, exist_ok=True)
    count = 0
    for i, raw in enumerate(WORD_TEMPLATES):
        spec = build_spec(raw, i)
        out = os.path.join(OUT, raw["file"])
        render_word(spec, out)
        count += 1
    print("WORD templates generated:", count)
    print("Output dir:", OUT)


if __name__ == "__main__":
    main()
