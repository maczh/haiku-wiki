#!/usr/bin/env bash
# 把《寄海文库 · 用户使用手册》Markdown 渲染为带截图的 PDF：
#   pandoc: md -> 带样式的 standalone HTML（图片保持相对路径，就近解析）
#   Chrome headless: HTML -> A4 PDF
#
# 用法：bash tools/build/build-manual-pdf.sh
#
# 注意：这里**不用** pandoc 的 --self-contained —— 它对含中文文件名的图片路径会解析失败
# （`File img/01-登录页.png not found in resource path`）。改为把中间 HTML 落在
# docs/manual/ 下，让 `img/xxx.png` 相对路径由 Chrome 直接加载。
set -euo pipefail

# 宿主的 `rm` 被替换为「回收站」守卫脚本，它依赖 HOME / XDG_DATA_HOME 定位回收站目录。
# 若这两个变量缺失，守卫会 fail-closed（trash-failed），删除失败并让本脚本中断。
export HOME="${HOME:-/home/macro}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
mkdir -p "$XDG_DATA_HOME" 2>/dev/null || true

# 删除失败时的兜底：移到临时目录而不是硬删。
del() { rm -f "$@" 2>/dev/null || mv -f "$@" "${TMPDIR:-/tmp}/" 2>/dev/null || true; }

# /tmp 与 /dev/shm 都是 10MB tmpfs，Chrome 渲染 PDF 会写爆（font_data_service 报
# ENOSPC 后直接 FATAL）。必须把 TMPDIR 指到磁盘上的目录。
export TMPDIR="${TMPDIR:-/home/macro/.workbuddy/tmp}"
mkdir -p "$TMPDIR" 2>/dev/null || true

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DIR="$REPO/docs/manual"
SRC="寄海文库用户使用手册.md"
CSS="$DIR/.manual-style.css"
HTML="$DIR/.build-manual.html"
STYLE="$DIR/.build-style.html"
OUT="$REPO/docs/寄海文库用户使用手册.pdf"
CHROME="${CHROME_BIN:-/usr/bin/google-chrome}"

cleanup() { del "$HTML" "$STYLE"; }
trap cleanup EXIT

cd "$DIR"

echo "[1/3] 准备样式头"
{
  echo '<style>'
  cat "$CSS"
  echo '</style>'
} > "$STYLE"

echo "[2/3] pandoc: markdown -> HTML"
pandoc "$SRC" \
  --from gfm+tex_math_dollars \
  --to html5 \
  --standalone \
  --metadata title="寄海文库 · 用户使用手册" \
  --metadata lang=zh-CN \
  --include-in-header "$STYLE" \
  --output "$HTML"

echo "[3/3] chrome headless: HTML -> PDF"
del "$OUT"
"$CHROME" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --no-pdf-header-footer \
  --run-all-compositor-stages-before-draw \
  --virtual-time-budget=60000 \
  --print-to-pdf-no-header \
  --print-to-pdf="$OUT" \
  "file://$HTML" 2>&1 | grep -viE 'devtools|fontconfig|bluetooth|dbus|gpu|vulkan|voice|tflite|Failed to send GpuControl' || true

ls -la "$OUT"
python3 - "$OUT" <<'PY'
import re, sys
d = open(sys.argv[1], 'rb').read()
n = len(re.findall(rb'/Type\s*/Page[^s]', d))
print("PDF 页数：约 %d 页，体积 %.1f MB" % (n, len(d) / 1048576))
PY
