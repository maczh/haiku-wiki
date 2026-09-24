#!/usr/bin/env bash
# 编辑器菜单回归套件。实际逻辑在 e2e-editor-menus.mjs（playwright-core + 真实输入事件）。
# Chrome 与 playwright-core 路径都由 .mjs 按宿主自动推导（Linux/macOS 通用）；
# 需要覆盖时用 CHROME=/path/to/chrome、PW_CORE=/path/to/playwright-core/index.js。
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$HERE/../.."
# ⚠️ 本机 shell 环境里 HOME 可能未设置（实测 undefined），会导致 .mjs 里 path.join 拼出 "undefined/…"。
#    其余套件也都显式 export，保持一致。
export HOME=${HOME:-/home/macro}
export TMPDIR=${TMPDIR:-/home/macro/.workbuddy/tmp}
export NODE_PATH=${NODE_PATH:-/home/macro/.workbuddy/binaries/node/workspace/node_modules}
NODE=${NODE:-node}
"$NODE" "$HERE/e2e-editor-menus.mjs" "$@"
