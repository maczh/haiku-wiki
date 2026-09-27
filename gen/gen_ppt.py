# -*- coding: utf-8 -*-
"""PPT 批量生成入口：调用 ppt_engine 渲染全部场景模板，主题循环分布。"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from design import THEMES
from ppt_engine import render_ppt
from specs_ppt import PPT_TEMPLATES

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "generated_templates", "ppt")


def main():
    os.makedirs(OUT, exist_ok=True)
    count = 0
    for i, spec in enumerate(PPT_TEMPLATES):
        spec = dict(spec)
        spec["theme"] = i % len(THEMES)
        spec.setdefault("brand", "寄海文库 · 模板中心")
        spec.setdefault("closing_title", "感谢观看")
        spec.setdefault("closing_subtitle", "THANK YOU")
        out = os.path.join(OUT, spec["file"])
        render_ppt(spec, out)
        count += 1
    print("PPT templates generated:", count)
    print("Output dir:", OUT)


if __name__ == "__main__":
    main()
