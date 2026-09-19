#!/usr/bin/env bash
# CAD 预览渲染探针（纯渲染链路，无端口、无浏览器、不依赖生产形态二进制）。
#
# 把两套「按真实尺度构造」的 DXF 渲成 SVG/PNG 落盘，并打印图幅、文字/折线条数与
# font-size 区间，供人工目视比对「是否与 AutoCAD 打开原图一致」：
#   site   —— 场地总平面（图幅 400m×240m，标注仅 250mm，含 \P 分段的多行说明）
#   metric —— 米制建筑平面（图幅 40m×30m，字高由 STYLE 固定为 0.5m）
#
# 自动化断言在 server/internal/service/exportx/cad_text_qa_test.go；
# 本脚本负责「数值之外的观感」这一层（字号比例对不对、多行注释有没有折行、
# 密集标注有没有叠成一团黑）。
#
# 用法：
#   bash tools/verify/cad-render-probe.sh          # 输出到 $TMPDIR/cad-render-probe-<ts>
#   OUT=/path/to/dir bash tools/verify/cad-render-probe.sh
set -uo pipefail

TMP=${HAIKU_TMP:-/home/macro/.workbuddy/tmp}
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT=${OUT:-$TMP/cad-render-probe-$(date +%s)}
mkdir -p "$OUT"

export PATH=/usr/local/go/bin:$PATH
export HOME=/home/macro TMPDIR=$TMP/gotmp
export GOPATH=/home/macro/.workbuddy/go GOMODCACHE=/home/macro/.workbuddy/go/pkg/mod
export GOCACHE=/home/macro/.workbuddy/go/cache GOPROXY=https://goproxy.cn,direct GOSUMDB=off
unset http_proxy https_proxy

cd "$REPO/server" || exit 1
# 先跑一遍断言（快，且能立刻暴露回归），再落盘供目视
if ! go test -count=1 -run 'TestCad' ./internal/service/exportx/ >"$OUT/test.log" 2>&1; then
  echo "❌ CAD 渲染断言未通过，详见 $OUT/test.log"; tail -20 "$OUT/test.log"; exit 1
fi
echo "✅ CAD 渲染断言通过（$OUT/test.log）"

go run ./cmd/cadprobe "$OUT" || exit 1
echo "产物目录：$OUT"
echo "  目视检查点：site.svg 的 36 个标注应等比不重叠、说明文字应为 5 行；"
echo "              metric.svg 的 6 个房间名应为 19.2px 左右（0.5m × 38.4），不是 96px。"
