# -*- coding: utf-8 -*-
"""生成模板索引（按场景分类），输出到 generated_templates/模板索引.md。"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from design import WORD_CATEGORIES, PPT_CATEGORIES
from specs_word import WORD_TEMPLATES
from specs_ppt import PPT_TEMPLATES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "generated_templates")
WORD_DIR = os.path.join(OUT_DIR, "word")
PPT_DIR = os.path.join(OUT_DIR, "ppt")


def fname(title, ext):
    for t in WORD_TEMPLATES if ext == "docx" else PPT_TEMPLATES:
        base = t["file"]
        if base.endswith(ext) and base.split("-", 1)[-1].rsplit(".", 1)[0] == title:
            return base
    return title + "." + ext


def main():
    lines = ["# 办公模板库 · 分类索引", "",
             "> 由「寄海文库」模板中心批量生成，共 **55 个 Word 模板 + 54 个 PPT 模板**，覆盖人事行政、办公文书、工作报告、商务合同、财务单据、方案策划、技术文档等主流工作场景。",
             "> 设计采用 10 套专业配色（商务蓝 / 墨绿金 / 中国红 / 典雅紫 / 暖橙 / 青碧 / 极简灰 / 靛蓝 / 玫瑰红 / 森林绿）循环分布，含封面、分节、要点、表格、数据、时间轴等版式。",
             ""]
    lines.append("## 一、Word 模板（" + str(len(WORD_TEMPLATES)) + " 个）")
    lines.append("")
    for cat, titles in WORD_CATEGORIES.items():
        lines.append("### " + cat)
        for t in titles:
            f = fname(t, "docx")
            lines.append("- `" + f + "` — " + t)
        lines.append("")
    lines.append("## 二、PPT 模板（" + str(len(PPT_TEMPLATES)) + " 个）")
    lines.append("")
    for cat, titles in PPT_CATEGORIES.items():
        lines.append("### " + cat)
        for t in titles:
            f = fname(t, "pptx")
            lines.append("- `" + f + "` — " + t)
        lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("**使用说明**：直接打开对应文件，替换 `____` 占位内容即可；Word 页脚已含页码与品牌标识，PPT 每页含页脚与页码。")
    out = os.path.join(OUT_DIR, "模板索引.md")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print("index written:", out, "chars:", len("\n".join(lines)))


if __name__ == "__main__":
    main()
