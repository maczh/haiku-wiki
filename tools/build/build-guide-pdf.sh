#!/usr/bin/env bash
# 把《寄海文库功能指南》Markdown 渲染为 PDF：
#   pandoc: md -> 带样式 HTML（standalone）
#   Chrome headless: HTML -> PDF（A4 / 内嵌字体已由系统 CJK 字体提供）
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SRC="$REPO/docs/寄海文库功能指南.md"
CSS="$REPO/docs/.guide-style.css"
OUT="$REPO/docs/寄海文库功能指南.pdf"
TMP=/home/macro/.workbuddy/tmp/guide-build
mkdir -p "$TMP"

echo "[1/3] pandoc md -> html"
pandoc "$SRC" \
  --from gfm+tex_math_dollars \
  --to html5 \
  --standalone \
  --metadata title="寄海文库 · 功能指南" \
  --metadata lang=zh-CN \
  --self-contained \
  --css "$CSS" \
  --output "$TMP/guide.html"

echo "[2/3] chrome headless html -> pdf"
rm -f "$OUT"
/usr/bin/google-chrome \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --no-pdf-header-footer \
  --virtual-time-budget=15000 \
  --run-all-compositor-stages-before-draw \
  --print-to-pdf-no-header \
  --print-to-pdf="$OUT" \
  "file://$TMP/guide.html" 2>&1 | grep -viE 'devtools|fontconfig|bluetooth|dbus|gpu|vulkan' || true

echo "[3/3] done"
ls -la "$OUT"
/usr/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null || true
