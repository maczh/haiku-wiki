#!/usr/bin/env bash
# 顺序跑全部浏览器回归套件（本项目走「单源生产形态」：vite build → embed → go build → 浏览器）。
#
# ⚠️ 必须顺序执行：这些套件共用 XDG_RUNTIME_DIR 与同一个 Chrome profile，
#    并行会互相干扰（表现为随机 no-btn / 页面串台）。部分套件还共用端口 8080，
#    所以同一时刻只能跑一个。
#
# 用法：
#   bash tools/verify/run-all.sh              # 全套（sim-docker-web 要跑一次完整 npm build，约 11 分钟）
#   SUITES="e2e-folder-dir ui-doc-types" bash tools/verify/run-all.sh   # 只跑指定几套
#
# 前置：先构建出生产形态二进制（tools/build/build-embed.sh），详见同目录 README.md。
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT=${OUT:-/home/macro/.workbuddy/tmp/regress}
mkdir -p "$OUT"
LOG=$OUT/run-all.log
: > "$LOG"

# 执行顺序 = 由快到慢；共用 8080 的那几套排在一起（彼此互斥）。
# sim-docker-web 放最后：它要跑一次完整 npm build。
DEFAULT_SUITES=(
  embed-prod-check
  e2e-folder-dir
  e2e-dashboard
  e2e-import
  e2e_export
  ui-doc-types
  gantt-fold-check
  gantt-fold-edge-check
  gantt-api-check
  gantt-ui-check
  check-lazy-routes
  check-route-fallback
  ui-shot
  # ⚠️ 新套件一律插在 sim-docker-web **之前**（它必须保持最后：要跑一次完整 npm build）
  mermaid-render-check
  pptx-zoom-check
  comment-api-check
  api-refresh-check
  sim-docker-web
)
read -r -a SUITES <<<"${SUITES:-${DEFAULT_SUITES[*]}}"

# 每套的固定端口（须与脚本内的默认值一致）。跑之前先探测：被占用说明有别的会话
# 留下的「幽灵实例」（`ps` 看不到，在另一个 PID 命名空间）——那种情况下套件自己的服务
# 起不来、转而连上**别人的**服务，会产出看似合理其实无效的结果，因此直接跳过。
# 0 = 不用端口的套件。
declare -A PORT_OF=(
  [embed-prod-check]=8099
  [e2e-folder-dir]=8181
  [e2e-dashboard]=8150
  [e2e-import]=18081
  [e2e_export]=18080
  [ui-doc-types]=8080
  [gantt-fold-check]=8112
  [gantt-fold-edge-check]=8131
  [gantt-api-check]=8098
  [gantt-ui-check]=8097
  [check-lazy-routes]=8080
  [check-route-fallback]=8080
  [ui-shot]=8080
  [mermaid-render-check]=18086
  [pptx-zoom-check]=18092
  [comment-api-check]=8100
  [api-refresh-check]=8101
  [sim-docker-web]=0
)

port_busy() {
  local p=${1:-0}
  [ "$p" = "0" ] && return 1
  local c
  c=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$p/" 2>/dev/null || true)
  [ "$c" != "000" ]
}

# 统一各套件的计数口径：优先读套件自己打印的汇总行
# （`PASS=n FAIL=n` / `通过 n 项，失败 n 项`），否则退回 ✅/❌ 计数 + `*_OK`/`*_FAILED` 标记。
count_suite() {
  local f=$1 ok bad
  ok=$(grep -oE 'PASS=[0-9]+' "$f" | tail -1 | cut -d= -f2)
  bad=$(grep -oE 'FAIL=[0-9]+' "$f" | tail -1 | cut -d= -f2)
  [ -z "$ok" ] && ok=$(grep -oE '通过 [0-9]+ 项' "$f" | tail -1 | grep -oE '[0-9]+')
  [ -z "$bad" ] && bad=$(grep -oE '失败 [0-9]+ 项' "$f" | tail -1 | grep -oE '[0-9]+')
  if [ -z "$ok" ] || [ -z "$bad" ]; then
    ok=${ok:-$(grep -c '✅' "$f" || true)}
    bad=${bad:-$(grep -c '❌' "$f" || true)}
    grep -qE '[A-Z_]+_OK' "$f" && ok=$((ok + 1))
  fi
  grep -qE '[A-Z_]+_FAILED|FAIL=[1-9]' "$f" && bad=$((bad + 1))
  printf '%s %s\n' "${ok:-0}" "${bad:-0}"
}

TOTAL_OK=0
TOTAL_BAD=0
declare -a FAILED=()

echo "开始：共 ${#SUITES[@]} 套，日志 $LOG" | tee -a "$LOG"

for n in "${SUITES[@]}"; do
  if [ ! -f "$HERE/$n.sh" ]; then
    echo ">>> $n: 脚本不存在，跳过" | tee -a "$LOG"
    FAILED+=("$n(missing)")
    continue
  fi
  p=${PORT_OF[$n]:-0}
  if port_busy "$p"; then
    echo ">>> $n: ⚠️ 跳过 —— 端口 $p 已被占用（多半是幽灵实例）。单独重跑：PORT=<空闲端口> bash tools/verify/$n.sh" | tee -a "$LOG"
    FAILED+=("$n(port $p busy)")
    continue
  fi

  echo "########## $n ##########" | tee -a "$LOG"
  start=$(date +%s)
  bash "$HERE/$n.sh" >"$OUT/$n.out" 2>&1
  rc=$?
  dur=$(( $(date +%s) - start ))
  read -r ok bad <<<"$(count_suite "$OUT/$n.out")"
  TOTAL_OK=$((TOTAL_OK + ok))
  TOTAL_BAD=$((TOTAL_BAD + bad))
  echo ">>> $n: exit=$rc 用时=${dur}s ✅=$ok ❌=$bad" | tee -a "$LOG"
  if [ "$bad" != "0" ] || [ "$rc" != "0" ]; then
    FAILED+=("$n")
    echo "--- $n 失败明细 ---" | tee -a "$LOG"
    grep -nE '❌|✗|_FAILED' "$OUT/$n.out" | head -25 | tee -a "$LOG"
  fi
  tail -3 "$OUT/$n.out" | tee -a "$LOG"
  echo | tee -a "$LOG"
done

echo "================ 汇总 ================" | tee -a "$LOG"
echo "套件 ${#SUITES[@]} 套，✅=$TOTAL_OK ❌=$TOTAL_BAD" | tee -a "$LOG"
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "有问题的套件：${FAILED[*]}" | tee -a "$LOG"
  echo "ALL_SUITES_FAIL"
  exit 1
fi
echo "ALL_SUITES_PASS"
