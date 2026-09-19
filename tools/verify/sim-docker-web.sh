#!/usr/bin/env bash
# 无 docker daemon 时，按 Dockerfile 的 web-builder 阶段逐字复现其目录结构与命令。
# 关键点：模拟 .dockerignore —— 不提供 web/dist、web/node_modules、web/public/vditor，
# 以此证明 `npm run build` 的 prebuild 钩子能在「干净上下文」里自行生成 Vditor 自托管资源。
set -uo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SIM=/home/macro/.workbuddy/tmp/dockersim-web-$(date +%s)
mkdir -p "$SIM/web"

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export HOME=/home/macro
export TMPDIR=/home/macro/.workbuddy/tmp
export npm_config_cache=/home/macro/.workbuddy/npm-cache

echo "== 1) 复现 COPY web/ ./ （按 .dockerignore 剔除） =="
for f in index.html package.json package-lock.json scripts src tsconfig.json vite.config.ts; do
  cp -a "$REPO/web/$f" "$SIM/web/"
done
mkdir -p "$SIM/web/public"
for f in "$REPO"/web/public/*; do
  case "$(basename "$f")" in
    vditor) echo "   跳过 public/vditor（.dockerignore 已排除，应由 prebuild 生成）" ;;
    *) cp -a "$f" "$SIM/web/public/" ;;
  esac
done

echo "   上下文内 web/public：$(ls "$SIM/web/public")"
[ -e "$SIM/web/public/vditor" ] && { echo "❌ 上下文不应包含 public/vditor"; exit 1; }
echo "   确认 web/public/vditor 不存在 ✓"

# 复现 RUN npm install 的产物（软链本机已装依赖，避免重装耗时）
ln -s "$REPO/web/node_modules" "$SIM/web/node_modules"

echo "== 2) 复现 RUN npm run build =="
cd "$SIM/web"
if ! npm run build >"$SIM/build.log" 2>&1; then
  echo "❌ 构建失败，日志尾部："
  tail -25 "$SIM/build.log"
  exit 1
fi
grep -E 'vditor-assets|built in' "$SIM/build.log" | sed 's/^/   /'

echo "== 3) 断言产物 =="
fail=0
check() {
  if [ -e "$SIM/web/dist/$1" ]; then
    echo "   ✓ dist/$1 ($(du -h "$SIM/web/dist/$1" 2>/dev/null | cut -f1))"
  else
    echo "   ✗ 缺失 dist/$1"; fail=1
  fi
}
check index.html
check favicon.png
check logo.svg
check vditor/dist/js/lute/lute.min.js
check vditor/dist/js/highlight.js/highlight.min.js
check vditor/dist/js/katex/katex.min.js
check vditor/dist/js/icons/ant.js
check vditor/dist/js/i18n/zh_CN.js

echo "   dist 总大小：$(du -sh "$SIM/web/dist" | cut -f1)"

if [ "$fail" -eq 0 ]; then echo "DOCKER_WEB_STAGE_OK"; else echo "DOCKER_WEB_STAGE_FAILED"; fi
echo "模拟目录：$SIM"
