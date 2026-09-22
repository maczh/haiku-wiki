#!/usr/bin/env bash
# 编辑器菜单回归套件（macOS 默认；Linux CI 用 CHROME= 覆盖浏览器路径）。
# 实际逻辑在 e2e-editor-menus.mjs（playwright-core + 真实输入事件）。
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$HERE/../.."
NODE=${NODE:-node}
"$NODE" "$HERE/e2e-editor-menus.mjs" "$@"
