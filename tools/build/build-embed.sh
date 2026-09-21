#!/usr/bin/env bash
# 前端构建 → 拷入 Go embed 目录 → 编译后端二进制（供本地生产形态验证）
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TMP=/home/macro/.workbuddy/tmp
BK=$TMP/dist-backup
mkdir -p "$BK"

# Go 工具链选择：优先系统 Go（/usr/local/go，本机 1.25.x，满足 server/go.mod 的 `go 1.25`）。
# 注意：/home/macro/.workbuddy/binaries/go 是 1.23.4，若排在前面会让 go 去联网下载
# toolchain go1.25.0，并在 GOSUMDB=off 下以 "checksum database disabled" 失败。
export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:/usr/local/go/bin:/home/macro/.workbuddy/binaries/go/bin:$PATH
export HOME=/home/macro
export TMPDIR=$TMP
export npm_config_cache=/home/macro/.workbuddy/npm-cache
export GOPATH=/home/macro/.workbuddy/go
export GOMODCACHE=/home/macro/.workbuddy/go/pkg/mod
export GOCACHE=/home/macro/.workbuddy/go/cache
export GOPROXY=https://goproxy.cn,direct
export GOSUMDB=off
export GOTOOLCHAIN=local

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
# 还原/补全 .gitkeep：早期 `rsync --delete` 曾把它一并删掉，而脚本断言它恒在（否则下方检查必失败、
# 且 go build 被跳过导致二进制仍是旧的）。这里幂等兜底：HEAD 有则用 HEAD，否则补占位说明。
if ! git -C "$REPO" cat-file -e HEAD:server/internal/static/dist/.gitkeep 2>/dev/null; then
  printf '此目录为 Go embed 占位；构建时由 web/dist 填充，禁止提交实际产物。\n' > server/internal/static/dist/.gitkeep
else
  git -C "$REPO" show HEAD:server/internal/static/dist/.gitkeep > server/internal/static/dist/.gitkeep 2>/dev/null || true
fi
test -f server/internal/static/dist/.gitkeep || { echo "❌ .gitkeep 丢失"; exit 1; }
echo "静态资源：$(find server/internal/static/dist -type f | wc -l) 个文件，$(du -sh server/internal/static/dist | cut -f1)"

# 3) 编译后端
echo "== 编译后端 =="
cd "$REPO/server"
go build -o "$TMP/haiku-wiki" ./cmd/server
ls -la "$TMP/haiku-wiki"
echo "ALL_OK"
