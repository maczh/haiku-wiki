#!/usr/bin/env bash
# 前端构建 → 拷入 Go embed 目录 → 编译后端二进制（供本地生产形态验证）
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TMP=/home/macro/.workbuddy/tmp
BK=$TMP/dist-backup
mkdir -p "$BK"

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:/home/macro/.workbuddy/binaries/go/bin:$PATH
export HOME=/home/macro
export TMPDIR=$TMP
export npm_config_cache=/home/macro/.workbuddy/npm-cache
export GOPATH=/home/macro/.workbuddy/go
export GOMODCACHE=/home/macro/.workbuddy/go/pkg/mod
export GOCACHE=/home/macro/.workbuddy/go/cache
export GOPROXY=https://goproxy.cn,direct
export GOSUMDB=off

# 1) 前端构建（emptyDir 会触发宿主批量删除保护，先把旧产物挪走）
echo "== 前端构建 =="
cd "$REPO/web"
[ -d dist ] && mv dist "$BK/web-dist-$(date +%s)"
npm run build 2>&1 | tail -4

# 2) 刷新 embed 目录（同样用 mv 而非 rm）
#    注意：`*` 不匹配点号开头的文件，因此 .gitkeep 会原地保留 ——
#    它是被 git 跟踪的占位说明文件，不能被 touch / rm 破坏。
echo "== 刷新 embed 目录 =="
cd "$REPO"
BK2="$BK/embed-$(date +%s)"; mkdir -p "$BK2"
shopt -s nullglob
for f in server/internal/static/dist/*; do mv "$f" "$BK2/"; done
shopt -u nullglob
mkdir -p server/internal/static/dist
cp -r web/dist/. server/internal/static/dist/
test -f server/internal/static/dist/.gitkeep || { echo "❌ .gitkeep 丢失"; exit 1; }
echo "静态资源：$(find server/internal/static/dist -type f | wc -l) 个文件，$(du -sh server/internal/static/dist | cut -f1)"

# 3) 编译后端
echo "== 编译后端 =="
cd "$REPO/server"
go build -o "$TMP/haiku-wiki" ./cmd/server
ls -la "$TMP/haiku-wiki"
echo "ALL_OK"
