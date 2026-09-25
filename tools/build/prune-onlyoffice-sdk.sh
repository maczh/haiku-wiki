#!/bin/sh
# 裁剪 OnlyOffice Web Comp SDK 中「运行时用不到」的部分，缩小 go:embed 产出的二进制。
#
# 用法：sh tools/build/prune-onlyoffice-sdk.sh <dist 根目录>
#   <dist 根目录> 下应含 packages/onlyoffice/<版本>/（vite 从 web/public/packages 复制而来）。
#
# 裁剪项与理由（前提：不影响文档的编辑/保存/渲染）：
#   1) web-apps/apps/*/main/resources/help 的非 en 语种 —— 离线帮助手册。
#      仓库自带语种 tr/sr-Latn/pt/de/fr/ru/it/es… 共 456MB，且**没有 zh-CN**，
#      对本中文项目无价值；保留 en + 共享 images，编辑器的「帮助」仍可用。
#   2) sdkjs/pdf（48MB）—— PDF 编辑引擎。本项目 .pdf 是只读附件，预览走 pdf.js，不经 OnlyOffice。
#   3) sdkjs/visio（16MB）—— Visio 编辑引擎。本项目 .vsd/.vsdx 走 draw.io 预览，不经 OnlyOffice。
#   4) */main/ie、*/forms/ie（10MB）—— IE 兼容资源，现代浏览器不会加载。
#
# ⚠️ 本脚本只裁剪传入的 dist（构建产物），**绝不改动** web/public/packages 里的原始 SDK。
#    因此：① 本地开发与回归套件仍跑完整 SDK，不受影响；② 想恢复只需重新 npm run build。
#
# 可选：PRUNE_MOBILE=1 时再裁掉 */mobile（OnlyOffice 移动端 UI，约 26MB）。
#       默认不裁——H5 模式虽走自有组件，但保留可避免 UA 判定导致移动端回退资源缺失。
set -eu

DIST="${1:-}"
if [ -z "$DIST" ]; then
  echo "用法: $0 <dist 根目录>（下含 packages/onlyoffice/<版本>/）" >&2
  exit 1
fi
if [ ! -d "$DIST" ]; then
  echo "目录不存在: $DIST" >&2
  exit 1
fi

ROOT="$DIST/packages/onlyoffice"
if [ ! -d "$ROOT" ]; then
  echo "未找到 OnlyOffice SDK（$ROOT），跳过裁剪"
  exit 0
fi

size_mb() { du -sm "$1" 2>/dev/null | cut -f1; }

total_before=$(size_mb "$ROOT")

for sdk in "$ROOT"/*; do
  [ -d "$sdk" ] || continue
  before=$(size_mb "$sdk")

  # 1) 离线帮助手册：只保留 en 与共享 images
  for help in "$sdk"/web-apps/apps/*/main/resources/help; do
    [ -d "$help" ] || continue
    find "$help" -maxdepth 1 -mindepth 1 ! -name en ! -name images -exec rm -rf {} +
  done

  # 2) 未启用的引擎：PDF（pdf 走 pdf.js 只读预览）、Visio（vsd/vsdx 走 draw.io）
  rm -rf "$sdk/sdkjs/pdf" "$sdk/sdkjs/visio"

  # 3) IE 兼容资源
  if [ -d "$sdk/web-apps/apps" ]; then
    find "$sdk/web-apps/apps" -type d -name ie -exec rm -rf {} + 2>/dev/null || true
  fi

  # 4) 可选：移动端 UI
  if [ "${PRUNE_MOBILE:-0}" = "1" ]; then
    for m in "$sdk"/web-apps/apps/*/mobile; do
      [ -d "$m" ] && rm -rf "$m"
    done
  fi

  echo "  $(basename "$sdk"): ${before}MB -> $(size_mb "$sdk")MB"
done

echo "OnlyOffice SDK 裁剪完成: ${total_before}MB -> $(size_mb "$ROOT")MB"
