#!/usr/bin/env bash
# 单源生产形态复验：web/dist -> server/internal/static/dist（embed）-> 单端口起服 -> HTTP 断言
# 全程用 mv 让位，绝不用 rm（宿主 safe-delete shim 会拦批量删除）
set -uo pipefail

REPO=/home/macro/Work/go/src/github.com/maczh/haiku-wiki
TMP=/home/macro/.workbuddy/tmp
PORT=8099

export PATH=/usr/local/go/bin:/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export HOME=/home/macro
export TMPDIR=$TMP/gotmp
export GOPATH=/home/macro/.workbuddy/go GOMODCACHE=/home/macro/.workbuddy/go/pkg/mod
export GOCACHE=/home/macro/.workbuddy/go/cache
export GOPROXY=https://goproxy.cn,direct GOSUMDB=off
unset http_proxy https_proxy
mkdir -p "$TMPDIR"

echo "== 1) 刷新 embed 目录 =="
cd "$REPO"
BK2="$TMP/dist-backup/embed-$(date +%s)"; mkdir -p "$BK2"
shopt -s nullglob
for f in server/internal/static/dist/*; do mv "$f" "$BK2/"; done
shopt -u nullglob
mkdir -p server/internal/static/dist
cp -r web/dist/. server/internal/static/dist/
test -f server/internal/static/dist/.gitkeep || { echo "FAIL: .gitkeep 丢失"; exit 1; }
echo "embed: $(find server/internal/static/dist -type f | wc -l) 文件 / $(du -sh server/internal/static/dist | cut -f1)"

echo "== 2) 编译后端 =="
cd "$REPO/server"
go build -o "$TMP/haiku-wiki" ./cmd/server || { echo "FAIL: 编译失败"; exit 1; }
echo "二进制: $(ls -la "$TMP/haiku-wiki" | awk '{print $5}') 字节"

echo "== 3) 起服（:$PORT）=="
DATA=$TMP/prod-check-data-$(date +%s)
mkdir -p "$DATA"
# DWG 转换器：默认用本机编译的 libredwg（$TMP/vendor/lr/...），缺失则回退 PATH；
# 两者都没有时 4.6 会**明确 skip** 而不是报假红。可用 EXPORT_DWG_CONVERTER 覆盖。
DWG_CONV=${EXPORT_DWG_CONVERTER:-}
if [ -z "$DWG_CONV" ]; then
  for c in "$TMP/vendor/lr/libredwg-0.14/programs/dwg2dxf" \
           "$(command -v dwg2dxf || true)" "$(command -v dwgread || true)" \
           "$(command -v ODAFileConverter || true)"; do
    [ -n "$c" ] && [ -x "$c" ] && { DWG_CONV=$c; break; }
  done
fi
if [ -n "$DWG_CONV" ]; then echo "DWG 转换器: $DWG_CONV"; else echo "DWG 转换器: 未找到（4.6 将 skip）"; fi
env PORT=$PORT DATA_DIR="$DATA" JWT_SECRET=prodcheck \
  ${DWG_CONV:+EXPORT_DWG_CONVERTER=$DWG_CONV} \
  "$TMP/haiku-wiki" > "$TMP/prod-check.log" 2>&1 &
APP=$!
trap 'kill $APP 2>/dev/null; wait $APP 2>/dev/null' EXIT

for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "http://127.0.0.1:$PORT/" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 0.5
done
echo "就绪码: ${code:-timeout}"

# 取一个 JWT（新库，注册即登录）
TOKEN=$(curl -s --noproxy '*' -X POST "http://127.0.0.1:$PORT/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"username":"prodcheck","email":"prodcheck@example.com","password":"secret123","name":"prodcheck"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then
  TOKEN=$(curl -s --noproxy '*' -X POST "http://127.0.0.1:$PORT/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"account":"prodcheck","password":"secret123"}' \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
fi
echo "token: $([ -n "$TOKEN" ] && echo 已获取 || echo 获取失败)"
AUTH=(-H "Authorization: Bearer $TOKEN")

PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
no(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "== 4) 关键资源断言 =="
# 4.1 drawio 入口页面（跟随 301；embed 形态下 http.FileServer 会把 .../index.html 转到 ./）
RI=$(curl -sL --noproxy '*' -w '\n%{http_code}' "http://127.0.0.1:$PORT/drawio/index.html")
RC=$(echo "$RI" | tail -1); RB=$(echo "$RI" | sed '$d')
RB_LEN=$(printf '%s' "$RB" | wc -c)
[ "$RC" = "200" ] && ok "GET /drawio/index.html → 200（跟随重定向，共 ${RB_LEN} 字节）" || no "GET /drawio/index.html 得 $RC"
# 决定性断言：必须是 drawio 自己的页面，而不是应用 SPA 的 index.html（约 620 字节）
if printf '%s' "$RB" | head -c 4096 | grep -qEi 'drawio|mxgraph|geInfo|bootstrap\.js'; then
  ok "drawio 入口是组件自身页面（指纹命中，前端探测可判定就位）"
else
  no "drawio 入口缺指纹 —— 很可能被 SPA 兜底吞掉了（正文长度 $RB_LEN）"
fi
if [ "$RB_LEN" -lt 2000 ]; then
  no "drawio 入口仅 $RB_LEN 字节，疑似回退到 SPA index.html"
else
  ok "drawio 入口体积正常（$RB_LEN 字节，非 SPA 兜底页）"
fi

# 4.1b 目录型请求（本次修复点）
for p in /drawio/ /drawio; do
  RL=$(curl -sL --noproxy '*' -w '|%{http_code}' "http://127.0.0.1:$PORT$p")
  RC2=${RL##*|}; RB2=${RL%|*}
  if [ "$RC2" = "200" ] && printf '%s' "$RB2" | grep -qEi 'drawio|mxgraph' && [ "$(printf '%s' "$RB2" | wc -c)" -gt 2000 ]; then
    ok "GET $p 返回 drawio 页面（未落入 SPA 兜底）"
  else
    no "GET $p 异常：码 $RC2，$(printf '%s' "$RB2" | wc -c) 字节"
  fi
done

# 4.2 drawio 组件目录（stencils.min.js 内联 204 个形状库）；断言的是「真的是 JS，不是兜底 HTML」
for f in js/stencils.min.js js/app.min.js styles/grapheditor.css; do
  HDR=$(curl -s --noproxy '*' -o "$TMP/drawio-probe.bin" -w '%{http_code}|%{content_type}|%{size_download}' \
        "http://127.0.0.1:$PORT/drawio/$f")
  if [ "${HDR%%|*}" = "200" ] && ! head -c 32 "$TMP/drawio-probe.bin" | grep -qi '<!doctype html'; then
    ok "GET /drawio/$f 200（$HDR，非 HTML 兜底）"
  else
    no "GET /drawio/$f 异常：$HDR"
  fi
done

# 4.3 前端 chunk：DrawioEditor 必须不含旧的窄 Range 探测
CHUNK=$(ls "$REPO/web/dist/assets" | grep '^DrawioEditor-' | head -1)
BODY=$(curl -s --noproxy '*' "http://127.0.0.1:$PORT/assets/$CHUNK")
echo "$BODY" | grep -q 'bytes=0-64' && no "$CHUNK 仍含 bytes=0-64 旧探测" || ok "$CHUNK 不含旧 Range 探测"
echo "$BODY" | grep -q 'mxgraph|geInfo' && ok "$CHUNK 含扩充后的指纹正则" || no "$CHUNK 缺指纹正则"

# 4.4 其余新功能 chunk 可达（CAD 阅读器静态内联在 FileView 里，无独立 chunk）
for pat in PptxView DrawioView FileView; do
  f=$(ls "$REPO/web/dist/assets" | grep "^$pat-" | head -1)
  [ -z "$f" ] && { no "$pat chunk 不存在"; continue; }
  c=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "http://127.0.0.1:$PORT/assets/$f")
  [ "$c" = "200" ] && ok "GET /assets/$f 200" || no "GET /assets/$f 得 $c"
done
FV=$(ls "$REPO/web/dist/assets" | grep '^FileView-' | head -1)
curl -s --noproxy '*' "http://127.0.0.1:$PORT/assets/$FV" | grep -q '适应窗口' \
  && ok "$FV 内含 CAD 阅读器（「适应窗口」）" || no "$FV 内未见 CAD 阅读器"

# 4.5 vditor 自托管资源
c=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "http://127.0.0.1:$PORT/vditor/dist/js/lute/lute.min.js")
[ "$c" = "200" ] && ok "GET /vditor/dist/js/lute/lute.min.js 200" || no "vditor lute 得 $c"

# 4.6 DWG 转换器可用性
# 转换器路径**参数化**：默认指向本机编译出来的 libredwg（$TMP/vendor/lr/...），
# 没有它就用 PATH 里的（dwg2dxf / dwgread / ODAFileConverter）。
# ⚠️ 缺转换器时**明确 skip**，不要静默判失败 —— 否则清理 tmp 之后这条会变成假红。
CJ=$(curl -s --noproxy '*' "${AUTH[@]}" "http://127.0.0.1:$PORT/api/cad/converter")
if printf '%s' "$DWG_CONV" | grep -q .; then
  echo "$CJ" | grep -q '"available":true' && ok "/api/cad/converter available=true（转换器 $DWG_CONV）" \
    || no "转换器不可用: $CJ"
else
  echo "  ⚠️ skip：本机没有可见的 DWG 转换器（设 EXPORT_DWG_CONVERTER=<dwg2dxf 路径> 可启用）—— $CJ"
fi

# 4.7 SPA 兜底：未知路由返回 index.html（含入口 chunk 引用）
c=$(curl -s -o /tmp/spa.html -w '%{http_code}' --noproxy '*' "http://127.0.0.1:$PORT/books/1?docId=1&tab=read")
grep -q 'assets/index-' /tmp/spa.html 2>/dev/null && [ "$c" = "200" ] \
  && ok "SPA 兜底 200 且含入口 chunk" || no "SPA 兜底异常: $c"

echo "== 5) 启动日志（前后各 3 行）=="
head -3 "$TMP/prod-check.log"; echo "  ..."; tail -3 "$TMP/prod-check.log"

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo "PROD_FORM_OK" || echo "PROD_FORM_HAS_FAILURE"
