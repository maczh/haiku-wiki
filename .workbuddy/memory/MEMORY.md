# haiku-wiki 项目长期约定（寄海文库）

> 模板手册见技能 haiku-wiki-template-authoring 与 tools/verify/README.md。

## 构建
- Go+Gin+GORM+JWT 后端（embed 托管 dist）；Vite5+React18 前端，编辑器全自托管。
- Go 只能用系统 `/usr/local/go/bin`（go.mod 要 1.25）；一条龙 `bash tools/build/build-embed.sh`。
- vite/npm build 前须 `CODEBUDDY_SAFE_DELETE_ENABLED=0`；手动 rsync 后必须补回 `server/internal/static/dist/.gitkeep`（否则 build-embed 静默跳过 go build）。
- `web/node_modules` 完整 → `tsc --noEmit` 应 0 错误。沙箱 npm/npx 走托管：`NODE_PATH=/home/macro/.workbuddy/binaries/node/workspace/node_modules`。

## 实测铁律
- DOM 测试用无头 Chrome：`/opt/google/chrome/chrome --headless=new --no-proxy-server --no-sandbox`；curl 加 `--noproxy '*'`；截图高度=窗口高度。
- 后台进程两次工具调用间被回收：起服务+验证+停服务放同一命令或 `setsid`。
- 本机 shell 无 HOME：脚本 `export HOME=${HOME:-/home/macro}`，Node 用 `os.homedir()`；禁止写死 /Users/macro 路径。
- `html/body` 必须保持 `overflow-x: clip`（不是 hidden，否则 H5 触摸划屏失灵，勿回退）。
- Vditor IR：只有 `.vditor-ir .vditor-reset` 是正文；`data-block` 恒 "0"。
- Agent Edit 可能静默失败，改后必须 Read 复核。
- 系统 /tmp 仅 10MB 且不保留 → 临时产物放 `~/hk-tmp`；跑 tools/verify/ 必须 `TMPDIR=/home/macro/.workbuddy/tmp`。

## 数据库
- MySQL 9.5.0 `haiku/Jihai2026@127.0.0.1:3306/haiku`（无建库权限）；AutoMigrate 与 migrateTables 同次提交。
- GORM 不能就地给复合主键表补自增主键 → pre-AutoMigrate 幂等 repair；夹具 `fixtures/e2e-data/haiku.db` 勿升级。
- CAS 秒传 `uploads/cas/<md5前2>/…`；前端 spark-md5 → `/api/uploads/precheck`（不回 url）→ `/instant`；删除只删 meta。

## 架构
- 后端是导出/转换唯一事实来源；自动保存 3s 防抖；按需加载三层必须维持（入口 CSS grep vditor 应 0）。
- 新增 doc_type 改动面：handler.validDocTypes→exportx→前端 DocType→iconForDocType→DocContent。
- folder 只作容器；新建文档主路径=BookPage.openNewDoc（两步 Modal）；tree/DocTree.tsx 死代码勿动。
- H5：`web/src/h5/**`；useViewMode() 必为 zustand store；H5ZoomStage 必须原生 `addEventListener({passive:false})`、自己就是滚动视口、禁 will-change；mindmap 用原生缩放（reader/MindmapView.tsx attachNativeZoom）。
- luckysheet：全局兜底 window.localforage（ini 无 .catch→白屏根因）；宿主必须 position:relative（点击偏行=CSS 包含块）；全局吞触摸的上游 UMD bug 用 `lib/luckysheetTouchShim.ts` 在 import 前包裹，复现用 Playwright CDP dispatchTouchEvent。
- 文档分享链接 PUT 即刷新 slug：分享面板先 GET 复用；H5 分享三级策略 lib/share.ts。
- 接口文档刷新 apidoc.Parse→mergeApiDoc 原地合并；点评区根主题=docs.ID、Markdown 包 `.hk-comment-md`、禁言走 banned_uids。
- 甘特（SVAR@2.7.3）：只给有子节点的父节点写 open:true；PPTX H5 全屏必须 createPortal(document.body)。

## 导入
- 解析器注册表 `web/src/lib/import/parse.ts`；格式映射 formats.ts（accept 与注册表必须一致）。
- **桌面 ImportDialog 与 H5 runImport.ts 是两条链路，改行为必须两处同步**。
- `.md.zip`（md+图片包）：`lib/import/mdzip.ts` 前端解包 → zip 内图片走秒传上传 → apply 重写正文 URL → 建 markdown 文档；解析不到的引用（外链/缺失/非图片）原样保留；大小口径对齐后端 64MB/条目。

## 模板
- `templates/*.json` 是产物不手改（改 _src/ 跑生成器，template-check.sh 校验）；DocTemplate.Builtin 禁 default:true；批量导入 errors 初始化 []；validTemplateDocTypes=markdown/sheet/mindmap/gantt/whiteboard/drawing/flowchart。

## 回归
- tools/verify/ 顺序执行，登记 run-all.sh（23 套）；夹具账号 `e2e@example.com/secret123`。
- AutoMigrate 异步：套件登录须重试轮询（40×0.5s）。
- **产品行为改了必须同步改套件并跑全量确认 ALL_SUITES_PASS**；gantt-ui 第 1 段子菜单需派发 mouseover。
- 改 GanttChart/SheetView 等共用组件要连带跑 gantt-fold-*、preview-zoom-check；H5 阅读态套件 h5-reader-check.sh（68 项）。
- 提交前 `git status --short` 逐行核对（勿卷入大文件）；*.tar/__pycache__ 已 gitignore。

## 微信登录（2026-09-24）
- 后端 wechat_{model,repo,service,handler}，路由 `/api/auth/wechat/*`；dev 模式走 /dev-complete；前端 WeChatLoginModal+LoginPage（桌面/H5 共用）；User 加 avatar。
- H5 导入手机文件：lib/import/runImport.ts + MobileImportSheet.tsx + MBookshelf FAB。
- 套件：h5-scroll-back-check.sh（8178，探针 h5-touch-scroll.mjs）、wechat-login-check.sh（8185）。
