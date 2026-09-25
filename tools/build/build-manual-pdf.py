#!/usr/bin/env python3
"""《寄海文库 · 用户使用手册》PDF 构建脚本。

管线与原交付一致：Markdown -> standalone HTML（内联 .manual-style.css）
-> Chrome headless --print-to-pdf 输出 A4 PDF。
pandoc 不可用时用 python-markdown 替代转换环节（tables/fenced_code/toc）。

用法：
    python3 tools/build/build-manual-pdf.py            # 默认转用户手册
    python3 tools/build/build-manual-pdf.py <md路径>    # 转任意使用同一套样式的文档
"""

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MANUAL_MD = REPO / "docs" / "manual" / "寄海文库用户使用手册.md"
MANUAL_CSS = REPO / "docs" / "manual" / ".manual-style.css"
GUIDE_CSS = REPO / "docs" / ".guide-style.css"
CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome",
    "chromium",
]

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
{css}
</style>
</head>
<body>
{body}
</body>
</html>
"""


def find_chrome() -> str:
    for cand in CHROME_CANDIDATES:
        try:
            subprocess.run([cand, "--version"], capture_output=True, check=True)
            return cand
        except (OSError, subprocess.CalledProcessError):
            continue
    sys.exit("未找到可用的 Chrome/Chromium，请安装后重试")


def build(md_path: Path, pdf_path: Path) -> Path:
    import markdown  # pip install markdown

    css_path = MANUAL_CSS if md_path.parent == MANUAL_MD.parent else GUIDE_CSS
    css = css_path.read_text(encoding="utf-8")
    text = md_path.read_text(encoding="utf-8")

    # pandoc 会处理原生 HTML 块内的 Markdown，python-markdown 默认不会；
    # 给块级容器补 markdown="1" 并启用 md_in_html，封面 div 内的标题才能正常渲染。
    text = text.replace('<div class="cover">', '<div class="cover" markdown="1">')

    body = markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "toc", "md_in_html"],
        extension_configs={"toc": {"permalink": False}},
    )
    html_path = md_path.with_name("." + md_path.stem + ".build.html")
    html_path.write_text(
        HTML_TEMPLATE.format(title=md_path.stem, css=css, body=body), encoding="utf-8"
    )

    chrome = find_chrome()
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-proxy-server",
        "--no-pdf-header-footer",
        "--virtual-time-budget=15000",
        f"--print-to-pdf={pdf_path}",
        html_path.as_uri(),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    html_path.unlink(missing_ok=True)
    if proc.returncode != 0 or not pdf_path.exists():
        sys.exit(f"Chrome 打印失败（exit={proc.returncode}）:\n{proc.stderr[-2000:]}")
    return pdf_path


def main() -> None:
    md_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else MANUAL_MD
    if not md_path.exists():
        sys.exit(f"找不到源文件：{md_path}")
    # 可选第二参数指定输出 PDF；默认写到源文件同目录（手册默认输出到 docs/ 保持既有布局）
    default_pdf = REPO / "docs" / (md_path.stem + ".pdf")
    pdf_path = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else default_pdf
    pdf_path = build(md_path, pdf_path)

    # 页数校验
    try:
        from pypdf import PdfReader

        pages = len(PdfReader(str(pdf_path)).pages)
    except Exception:
        pages = "?"
    size_mb = pdf_path.stat().st_size / 1024 / 1024
    print(f"OK {pdf_path}")
    print(f"   页数={pages}  大小={size_mb:.1f}MB")


if __name__ == "__main__":
    main()
