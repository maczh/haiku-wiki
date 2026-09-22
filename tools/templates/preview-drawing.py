#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 _src/drawing 下的绘图模板渲染成一页联系表（contact sheet）并截图，便于人工/Agent 复核版式。

    python3 tools/templates/preview-drawing.py                       # 全部
    python3 tools/templates/preview-drawing.py --glob '00[2-9]-*'    # 指定文件范围
    python3 tools/templates/preview-drawing.py --out /home/macro/hk-tmp/flow --no-shot

输出 `--out`.html 与 `--out`.png（png 由无头 Chrome 截图；找不到 Chrome 时只出 html）。
"""

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import drawio_kit as K  # noqa: E402

SRC_DIR = os.path.join(REPO, "server", "internal", "repository", "templates", "_src", "drawing")
CHROME_CANDIDATES = [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome():
    for c in CHROME_CANDIDATES:
        if os.path.exists(c):
            return c
    return shutil.which("google-chrome") or shutil.which("chromium")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glob", default="*", help="匹配源文件名的 glob，可用 | 分隔多组")
    ap.add_argument("--out", default=os.path.expanduser("~/hk-tmp/drawing-preview"))
    ap.add_argument("--no-shot", action="store_true")
    args = ap.parse_args()

    patterns = [g.strip() for g in args.glob.split("|") if g.strip()]
    files = []
    for pat in patterns:
        files += glob.glob(os.path.join(SRC_DIR, pat + ".json"))
    files = sorted(set(files))
    if not files:
        raise SystemExit("[preview-drawing] 没有匹配的源文件: %s" % args.glob)

    parts = [
        '<html><meta charset="utf-8"><body style="margin:0;background:#fff;'
        'font-family:Microsoft YaHei,PingFang SC,sans-serif">'
    ]
    for p in files:
        with open(p, encoding="utf-8") as f:
            spec = json.load(f)
        issues = K.check(spec)
        flag = "" if not issues else ' <span style="color:#c92a2a">[%d 项问题]</span>' % len(issues)
        parts.append(
            '<div style="padding:10px 14px"><h3 style="font-size:15px;margin:6px 0">%s%s '
            '<span style="color:#868e96;font-weight:400">%s</span></h3>%s<div style="font-size:12px;'
            'color:#868e96">%s</div></div>'
            % (os.path.basename(p), flag, spec.get("category", ""), K.render_svg(spec),
               "；".join(issues[:4]) if issues else "版式校验通过")
        )
    parts.append("</body></html>")
    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    html_path = args.out + ".html"
    with open(html_path, "w", encoding="utf-8") as f:
        f.write("".join(parts))
    print("[preview-drawing] HTML: %s（%d 个模板）" % (html_path, len(files)))

    if args.no_shot:
        return 0
    chrome = find_chrome()
    if not chrome:
        print("[preview-drawing] 未找到 Chrome，跳过截图")
        return 0
    png_path = args.out + ".png"
    height = 2200 * ((len(files) + 4) // 5)
    prof = os.path.join(out_dir or ".", "chrome-prof-%d" % os.getpid())
    os.makedirs(prof, exist_ok=True)
    cmd = [chrome, "--headless=new", "--no-proxy-server", "--no-sandbox", "--hide-scrollbars",
           "--disable-dev-shm-usage", "--disable-gpu", "--user-data-dir=" + prof,
           "--window-size=1240,%d" % min(height, 20000), "--virtual-time-budget=10000",
           "--screenshot=" + png_path, html_path]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    except Exception as e:  # noqa: BLE001
        print("[preview-drawing] 截图失败：%s" % e)
        return 0
    print("[preview-drawing] PNG: %s" % png_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
