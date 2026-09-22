#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 _src/flowchart 下的 mermaid 模板渲染成一页联系表并截图，便于人工/Agent 复核「是否真的画得出来、画得好看」。

    python3 tools/templates/preview-flowchart.py                          # 全部 160 个
    python3 tools/templates/preview-flowchart.py --glob '01[0-9]-*'        # 指定范围
    python3 tools/templates/preview-flowchart.py --per-kind 2             # 每种图型只取前 N 个
    python3 tools/templates/preview-flowchart.py --no-shot                 # 只出 HTML

为什么不能只靠 Node 校验
------------------------
`web/scripts/check-mermaid.mjs` 只做 `mermaid.parse`（语法），jsdom 没有排版引擎
（缺 getBBox / getComputedTextLength），`mermaid.render` 在 jsdom 下会整片失败。
因此「图能否真的画出来、排版是否正常」只能在真实浏览器里验证 —— 就是本脚本。

输出 `--out`.html 与 `--out`.png（png 由无头 Chrome 截图）。mermaid 从 web/node_modules
复制到输出目录，页面完全离线、不走 CDN。
"""

import argparse
import glob
import importlib.util
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC_DIR = os.path.join(REPO, "server", "internal", "repository", "templates", "_src", "flowchart")
MERMAID_SRC = os.path.join(REPO, "web", "node_modules", "mermaid", "dist", "mermaid.min.js")

# 直接复用生成器的 front matter 解析，保证「图型判定」与本脚本、gen-flowchart.py 三处口径一致
# （.mmd 源文件以 `---` front matter 开头，裸取首行会得到 "---"）。
_spec = importlib.util.spec_from_file_location("gen_flowchart", os.path.join(HERE, "gen-flowchart.py"))
_gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gen)
parse_front_matter = _gen.parse_front_matter

CHROME_CANDIDATES = [
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome():
    for c in CHROME_CANDIDATES:
        if os.path.exists(c):
            return c
    return shutil.which("google-chrome") or shutil.which("chromium")


def kind_of(src):
    """首行关键字即图型（与 gen-flowchart.py 的 MERMAID_KINDS 口径一致）。"""
    first = src.strip().splitlines()[0] if src.strip() else ""
    return first.split()[0].rstrip(":") if first.split() else "?"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glob", default="*", help="匹配源文件名的 glob，可用 | 分隔多组")
    ap.add_argument("--out", default=os.path.expanduser("~/hk-tmp/flowchart-preview"))
    ap.add_argument("--per-kind", type=int, default=0, help="每种图型最多取 N 个（0=不限）")
    ap.add_argument("--no-shot", action="store_true")
    args = ap.parse_args()

    patterns = [g.strip() for g in args.glob.split("|") if g.strip()]
    files = []
    for pat in patterns:
        files += glob.glob(os.path.join(SRC_DIR, pat + ".mmd"))
    files = sorted(set(files))
    if not files:
        raise SystemExit("[preview-flowchart] 没有匹配的源文件: %s" % args.glob)

    picked = []
    if args.per_kind > 0:
        seen = {}
        for p in files:
            meta, body = parse_front_matter(open(p, encoding="utf-8").read(), p)
            k = kind_of(body)
            seen[k] = seen.get(k, 0) + 1
            if seen[k] <= args.per_kind:
                picked.append((p, body, meta))
    else:
        for p in files:
            meta, body = parse_front_matter(open(p, encoding="utf-8").read(), p)
            picked.append((p, body, meta))

    out_dir = os.path.dirname(args.out) or "."
    os.makedirs(out_dir, exist_ok=True)
    if not os.path.exists(MERMAID_SRC):
        raise SystemExit("[preview-flowchart] 找不到 mermaid 产物: %s（先在 web/ 执行 npm install）" % MERMAID_SRC)
    shutil.copy(MERMAID_SRC, os.path.join(out_dir, "mermaid.min.js"))

    parts = [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<style>body{margin:0;background:#fff;font-family:Microsoft YaHei,PingFang SC,sans-serif}',
        '.tpl{padding:10px 14px 18px;border-bottom:1px solid #eef1f4}',
        '.tpl h3{font-size:14px;margin:6px 0;font-weight:600}',
        '.tpl .cat{color:#868e96;font-weight:400}',
        '.tpl .kind{display:inline-block;background:#e7f5ff;color:#1971c2;border-radius:3px;',
        'padding:1px 6px;font-size:11px;margin-left:6px}',
        '.mermaid{max-width:1180px}</style></head><body>',
    ]
    for p, src, meta in picked:
        k = kind_of(src)
        name = "%s · %s · %s" % (os.path.basename(p), meta.get("name", ""), meta.get("category", ""))
        parts.append(
            '<div class="tpl"><h3>%s <span class="kind">%s</span></h3>'
            '<pre class="mermaid">%s</pre></div>' % (name, k, src.replace("&", "&amp;").replace("<", "&lt;"))
        )
    parts.append(
        '<script src="mermaid.min.js"></script>'
        '<script>mermaid.initialize({startOnLoad:true,securityLevel:"strict",theme:"default"});</script>'
        '</body></html>'
    )
    html_path = args.out + ".html"
    with open(html_path, "w", encoding="utf-8") as f:
        f.write("".join(parts))
    kinds = {}
    for _, src, _m in picked:
        kk = kind_of(src)
        kinds[kk] = kinds.get(kk, 0) + 1
    print("[preview-flowchart] HTML: %s（%d 个模板：%s）"
          % (html_path, len(picked), "、".join("%s×%d" % (a, b) for a, b in sorted(kinds.items()))))

    if args.no_shot:
        return 0
    chrome = find_chrome()
    if not chrome:
        print("[preview-flowchart] 未找到 Chrome，跳过截图")
        return 0
    png_path = args.out + ".png"
    # Chrome 截图高度就是窗口高度，估小会把后半页**裁掉**（曾按 460px/模板估、
    # 实际 flowchart TD 一张约 1400px，16 张直接截断）。这里按 1200px/模板估，
    # 上限 20000（再大 Chrome 会拒绝或吃光内存）；触顶时提示减少 --per-kind。
    height = 1200 * len(picked) + 200
    if height > 20000:
        print("[preview-flowchart] ⚠️ 预估高度 %dpx 超过 20000px 上限，可能被截断："
              "请减小 --per-kind 或拆分 --glob 分批截图" % height)
        height = 20000
    prof = os.path.join(out_dir, "chrome-prof-fc-%d" % os.getpid())
    os.makedirs(prof, exist_ok=True)
    cmd = [chrome, "--headless=new", "--no-proxy-server", "--no-sandbox", "--hide-scrollbars",
           "--allow-file-access-from-files", "--disable-dev-shm-usage", "--disable-gpu",
           "--user-data-dir=" + prof, "--window-size=1240,%d" % min(height, 20000),
           "--virtual-time-budget=20000", "--screenshot=" + png_path, html_path]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
    except Exception as e:  # noqa: BLE001
        print("[preview-flowchart] 截图失败：%s" % e)
        return 0
    print("[preview-flowchart] PNG: %s" % png_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
