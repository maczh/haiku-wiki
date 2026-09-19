#!/usr/bin/env bash
# 寄海文库 界面验证（单源生产形态）：后端(8080，内嵌 dist) + agent-browser 截图
# 必须一次跑完：后台进程会在单次工具调用结束后被回收。
set -uo pipefail

export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules
export HOME=/home/macro
export TMPDIR=/home/macro/.workbuddy/tmp
export XDG_RUNTIME_DIR=/home/macro/.workbuddy/tmp/xdg
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--no-proxy-server,--hide-scrollbars,--window-size=1560,900"
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
mkdir -p "$XDG_RUNTIME_DIR"

AB=/home/macro/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser
TS=$(date +%s)
OUT=/home/macro/.workbuddy/tmp/ui-$TS
# 演示数据：默认取**仓库内夹具的临时副本**（服务端会写库，夹具本身不能被改动）
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [ -n "${E2E_DATA:-}" ]; then
  DATA=$E2E_DATA
else
  DATA=$TMPDIR/e2e-data-$(date +%s)
  cp -r "$HERE/fixtures/e2e-data/." "$DATA/"
fi
BASE=http://127.0.0.1:8080
mkdir -p "$OUT"

DATA_DIR="$DATA" PORT=8080 JWT_SECRET=e2e-secret-for-verify GIN_MODE=release \
  "$TMPDIR/haiku-wiki" >"$OUT/server.log" 2>&1 &
BPID=$!

cleanup() {
  "$AB" close >/dev/null 2>&1
  kill "$BPID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

say()  { printf '\n\033[36m== %s ==\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
jseval() { "$AB" eval "$1" 2>&1 | tail -3; }
shot() { "$AB" screenshot "$OUT/$1.png" >/dev/null 2>&1; info "[截图] $1.png"; }

# 等后端
code=000
for _ in $(seq 1 60); do
  code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$BASE/api/books" 2>/dev/null)
  [ "$code" != "000" ] && [ -n "$code" ] && break
  sleep 0.3
done
info "后端就绪：HTTP $code"
if curl --noproxy '*' -s "$BASE/" | grep -q 'id="root"'; then
  info "内嵌前端产物：已生效"
else
  echo "❌ 内嵌 dist 未生效"; exit 1
fi

TOKEN=$(curl --noproxy '*' -s -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d '{"account":"e2e@example.com","password":"secret123"}' | jq -r '.data.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "❌ 登录失败"; tail -5 "$OUT/server.log"; exit 1
fi
info "登录成功"

say "初始化浏览器"
"$AB" set viewport 1560 900 >/dev/null 2>&1
"$AB" open "$BASE/login" >/dev/null 2>&1
"$AB" wait 2500 >/dev/null 2>&1
"$AB" eval "localStorage.setItem('hk_token', ${TOKEN@Q}); 'token-set'" 2>&1 | tail -2
"$AB" reload >/dev/null 2>&1
"$AB" wait 2500 >/dev/null 2>&1

say "1) 书架页（品牌 LOGO / 文案）"
"$AB" open "$BASE/" >/dev/null 2>&1
"$AB" wait 3500 >/dev/null 2>&1
info "title: $(jseval 'document.title')"
info "含「寄海文库」: $(jseval "document.body.innerText.includes('寄海文库')")"
info "旧品牌「海库」残留: $(jseval "/海库/.test(document.body.innerText.replace(/寄海文库/g,''))")"
info "favicon: $(jseval "(document.querySelector('link[rel=icon]')||{}).href")"
info "侧栏 LOGO svg: $(jseval "!!document.querySelector('.ant-layout-sider svg, header svg')")"
shot "01-书架页-品牌"

say "2) 阅读页（右侧大纲浮动层 + 左侧文档库）"
"$AB" open "$BASE/books/1?docId=1&tab=read" >/dev/null 2>&1
"$AB" wait 4000 >/dev/null 2>&1
info "大纲浮动层: $(jseval "!!document.querySelector('.hk-toc-float')")"
info "大纲条目数: $(jseval "document.querySelectorAll('.hk-toc-float a').length")"
info "左栏调宽把手: $(jseval "!!document.querySelector('.hk-side-resizer')")"
info "左栏 aside: $(jseval "!!document.querySelector('aside')")"
info "浮动层定位: $(jseval "(function(){var e=document.querySelector('.hk-toc-float');if(!e)return null;var s=getComputedStyle(e);return s.position+' top='+s.top+' right='+s.right})()")"
info "正文已渲染（.doc-content 字符数）: $(jseval "(document.querySelector('.doc-content')||{innerHTML:''}).innerHTML.length")"
info "大纲条目文本: $(jseval "[].slice.call(document.querySelectorAll('.hk-toc-float a')).map(function(a){return a.innerText}).join(' / ')")"
shot "02-阅读页-大纲浮动层"

say "3) 收起大纲浮动层"
info "点击: $(jseval "(function(){var b=document.querySelector('.hk-toc-float-close');if(!b)return 'not-found';b.click();return 'clicked'})()")"
"$AB" wait 800 >/dev/null 2>&1
info "收起后浮动层存在: $(jseval "!!document.querySelector('.hk-toc-float')")"
shot "03-阅读页-大纲已收起"

say "4) 收起左侧文档库"
info "点击: $(jseval "(function(){var i=document.querySelector('.anticon-menu-fold');var b=i&&i.closest('button');if(!b)return 'not-found';b.click();return 'clicked'})()")"
"$AB" wait 800 >/dev/null 2>&1
info "收起后 aside 存在: $(jseval "!!document.querySelector('aside')")"
info "展开入口按钮存在: $(jseval "!!document.querySelector('.anticon-menu-unfold')")"
shot "04-阅读页-左栏已收起"

say "5) 思维导图编辑页（三处浮动工具条）"
"$AB" open "$BASE/books/1?docId=3&tab=edit" >/dev/null 2>&1
"$AB" wait 6000 >/dev/null 2>&1
info "顶部工具条 .hk-mm-tb-left: $(jseval "!!document.querySelector('.hk-mm-tb-left')")"
info "左侧按钮数: $(jseval "document.querySelectorAll('.hk-mm-tb-left button').length")"
info "右上工具条 .hk-mm-tb-right: $(jseval "!!document.querySelector('.hk-mm-tb-right')")"
info "右侧竖排入口数: $(jseval "document.querySelectorAll('.hk-mm-side-btn').length")"
info "右下缩放条 .hk-mm-zoom: $(jseval "!!document.querySelector('.hk-mm-zoom')")"
info "缩放百分比: $(jseval "(function(){var e=document.querySelector('.hk-mm-zoom');if(!e)return null;var m=e.innerText.match(/\\d+%/);return m?m[0]:null})()")"
info "缩放条位置: $(jseval "(function(){var e=document.querySelector('.hk-mm-zoom');if(!e)return null;var s=getComputedStyle(e);return s.position+' bottom='+s.bottom+' right='+s.right})()")"
info "画布容器 .smm-container: $(jseval "!!document.querySelector('.smm-container')")"
info "大尺寸画布 svg: $(jseval "[].slice.call(document.querySelectorAll('svg')).some(function(s){var r=s.getBoundingClientRect();return r.width>300&&r.height>100})")"
info "导图节点数: $(jseval "document.querySelectorAll('.smm-node').length")"
shot "05-思维导图-浮动工具条"

say "6) 附件型文档（PDF 原件预览，只读）"
"$AB" open "$BASE/books/1?docId=5&tab=read" >/dev/null 2>&1
"$AB" wait 6000 >/dev/null 2>&1
info "canvas 数: $(jseval "document.querySelectorAll('canvas').length")"
info "含「下载原文件」: $(jseval "document.body.innerText.includes('下载原文件')")"
info "编辑按钮状态: $(jseval "(function(){var bs=[].slice.call(document.querySelectorAll('button')).filter(function(b){return b.innerText.trim()==='编辑'});return bs.length? (bs.some(function(b){return b.disabled})?'disabled':'enabled') : 'no-btn'})()")"
info "附件信息条文案: $(jseval "(function(){var t=document.body.innerText;var m=t.match(/[^\\n]*原文件[^\\n]*/);return m?m[0].slice(0,60):null})()")"
shot "06-附件PDF-原文件预览"

say "外部依赖检查（不应出现 unpkg 等外部域名）"
"$AB" network requests 2>&1 | grep -Ev '127\.0\.0\.1|localhost' | tail -10
info "非本地请求条数: $("$AB" network requests 2>&1 | grep -Ec 'https?://(?!127\.0\.0\.1|localhost)' || true)"

say "控制台错误"
"$AB" errors 2>&1 | tail -12
say "控制台日志"
"$AB" console 2>&1 | tail -12

echo "输出目录：$OUT"
ls -la "$OUT"/*.png 2>/dev/null | awk '{print $5, $9}'
