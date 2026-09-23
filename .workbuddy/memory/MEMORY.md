# haiku-wiki 项目长期约定（寄海文库）

> 模板手册见技能 `haiku-wiki-template-authoring` 与 `tools/verify/README.md`。

## 构建
- Go+Gin+GORM（SQLite 免CGO/MySQL）+JWT 后端，embed 托管 dist；Vite5+React18 前端，编辑器全自托管。
- **Go 只能用系统 `/usr/local/go/bin`**：`server/go.mod` 要求 `go 1.25`，托管 1.23.4 直接构建失败。环境变量见 `tools/build/build-embed.sh`。
- 一条龙用 `bash tools/build/build-embed.sh`（前端构建→刷新 embed→编译后端，用 `mv` 且保护 `.gitkeep`）。
- 直接跑 `vite`/`npm run build` 前须 `CODEBUDDY_SAFE_DELETE_ENABLED=0`，否则 `emptyDir` 被 safe-delete shim 拦（bulk guard 或回收站 EACCES）。手动 rsync 后**必须补回 `server/internal/static/dist/.gitkeep`**（否则 build-embed.sh 静默跳过 go build）。
- `web/node_modules` 现**完整**（docx/jquery/html2canvas/jspdf/pptxgenjs 均在）→ `tsc --noEmit` 应严格 0 错误，无需过滤。

## 实测铁律
- 前端 DOM 必测无头 Chrome：`/opt/google/chrome/chrome --headless=new --no-proxy-server --no-sandbox`（本机代理劫持 127.0.0.1）；curl 加 `--noproxy '*'`，Python 空 `ProxyHandler({})`。
- **Chrome 截图高度 = 窗口高度**，估小会裁掉后半页。
- **后台进程在两次工具调用之间会被回收**：起服务+验证+停服务放同一条命令，或用 `setsid`。
- Vditor IR DOM（`lib/irDom.ts`）：页面 4 个 `.vditor-reset`，只有 `.vditor-ir .vditor-reset` 是正文；`data-block` 恒为 "0"，只能按文档序索引。
- `html/body` 必须保持 `overflow-x: **clip**`（**不是 `hidden`**）。clip 用来掐断「右缘 Tooltip → 横向滚动条 → 布局自激抖动」；而 `overflow-x:hidden` 会按 CSS 规范把 `overflow-y` 计算成 `auto`，让 `<body>` 变成滚动容器 → 移动端嵌套 `overflow:auto` 区的**触摸纵向划屏失灵/卡死**。改回 hidden 会静默破坏 H5 划屏（2026-09-23 已按此根因修好，勿回退）。
- **本机 shell 的 `HOME` 未设置**（`process.env.HOME === undefined`）：凡是 `$HOME`/`process.env.HOME` 拼路径的脚本都会静默跑偏（Node 动态 import 会把它当裸包名报 `Cannot find package 'undefined'`）。脚本里一律 `export HOME=${HOME:-/home/macro}`，Node 侧用 `os.homedir()` 兜底。回归脚本**禁止写死 macOS 绝对路径**（`/Users/macro/...`、`/Applications/...`）。
- Agent Edit 可能静默失败，改后必须 Read 复核。

## 数据库
- 本机 MySQL 9.5.0 `haiku/Jihai2026@127.0.0.1:3306/haiku`（无建库权限）；AutoMigrate 与 migrateTables 须同次提交。
- **GORM 不能就地给已存在复合主键表补自增主键**，需 pre-AutoMigrate 幂等 repair（建新表→INSERT SELECT→drop→rename，DDL 带 AUTOINCREMENT）；夹具 `fixtures/e2e-data/haiku.db` 保留旧结构勿升级。
- CAS 秒传：`uploads/cas/<md5前2>/<md5>-<rand6>.<ext>`；前端 spark-md5 → `POST /api/uploads/precheck`（绝不回 url）→ `/instant`；删除只删 meta。

## 架构
- 后端是导出/转换唯一事实来源；自动保存 3s 防抖；按需加载三层必须维持（入口 CSS `grep -c vditor` 应为 0）。
- 新增 doc_type 改动面：`handler.validDocTypes`→`exportx`→前端 `DocType`→`iconForDocType`→`DocContent`。
- folder 只作容器（不参与搜索/导出/分享/协作/最近更新）；Dashboard 最近更新走 `GET /api/recent-docs`。
- 新建文档主路径=`BookPage.openNewDoc`（两步 Modal）；`tree/DocTree.tsx` 死代码勿动；行尾「+」直达，文库手柄「新建」是子菜单且保留「选择位置」。
- 甘特（SVAR@2.7.3）：只给有子节点的父节点写 `open:true`；`lib/gantt.ts resolveSvarTask` 兜底 id。
- 点评区：根主题=docs.ID；comments/comment_settings 两处注册；Markdown 须包 `.hk-comment-md`；禁言走 `banned_uids`，前端不可默认 `[]`。
- 接口文档刷新：`apidoc.Parse`→`mergeApiDoc` 原地合并，不重建文档/不改 endpoint id；失效接口进 `g_stale`。
- **H5 手机版**：`web/src/h5/**`；`useViewMode()` 必为 zustand 全局 store（用 useState 切桌面/手机不生效）；`/share`、`/doc-share` 须在 App 层放行给桌面路由。强制 H5 只改 `localStorage['haiku_view_mode']='h5'`。
- H5 阅读链 `App(mode)→H5Router→MobileLayout→H5DocContainer→READER_MAP`；`getDocMode` **只有 whiteboard/todo/calendar 可编辑**，其余 12 类在 `/m/doc` 一律阅读态。
- 三入口（MDoc/MShare/MShareDoc）统一走 `h5/styles.h5ContainerProps(doc_type)` 拿 `{zoomable,fill}`：zoomable=**仅 `file`/`drawing`**（套 `H5ZoomStage`），fill=`gantt`。测试钩子 `[data-h5-doc]`/`[data-h5-zoom]`/`[data-h5-main]`/`[data-h5-tabbar]`/`[data-h5-share-entry]`/`[data-h5-share-sheet]`/`[data-h5-gantt-mode]`。
- `H5ZoomStage`：**必须原生 `addEventListener({passive:false})`**（React onTouch 是 passive，preventDefault 无效）；scale=1 时 `touch-action:pan-y` 不拦单指（默认不吞划屏）；touchend 落到 ≤1 指即清空手势，否则「缩放后划屏失效」。**这一层自己就是滚动视口**（`height:100%` + `overflow:auto` + `overscroll-behavior:contain`），滚动不能交给祖先容器（iOS 嵌套 overflow 会「默认比例划不动、放大后反而能拖」）。**禁用 `will-change:transform`**（按 1:1 栅格化，CSS scale 放大必糊）。
- **mindmap 必须走原生缩放，不能套 CSS transform**：simple-mind-map 是「按 scale 重排矢量 SVG」的渲染器，套 `H5ZoomStage` 只是把位图拉花。`reader/MindmapView.tsx` 的 `attachNativeZoom()` 直接驱动 `mm.view.scale/x/y` + `view.transform()`（算法抄官方 `src/plugins/TouchEvent.js`，该插件只在 `full.js` 注册，我们引 index.js 所以默认无手势、不冲突）。
- **luckysheet 只读白屏根因**：`ini()` 被 `localforage.getItem().then()` 包着且**无 .catch**，存储不可用→reject→ini 永不跑。修法：全局兜底 `window.localforage`（umd 是裸全局引用），三方法**同时支持 promise 与 callback 形式且永不 reject**（`clearcachelocaldata` 用 `removeItem(k,cb)` callback 形式）+ refresh 在 `#luckysheetloadingdata` 未移除前跳过。
- **luckysheet 点击偏行的根因是 CSS 包含块**（不是 refresh 时序）：`.luckysheet` 自带 `position:absolute` 且无 top/left，宿主 `div` 若是 `static`，包含块落到滚动容器之外 → 网格不随滚动，而命中行用 `$("#"+container).offset().top`（随滚动）→ 第二次点击整行偏移（约 6 行）。宿主**必须 `position:relative`**。
- **文档级分享链接是 `PUT` 即刷新 slug**：分享面板必须**先 GET 复用**已有 slug，只在拿不到/已停用才 PUT；重复 PUT 会让已发出的旧链接失效。H5 分享三级策略见 `lib/share.ts`（`navigator.share` → URL Scheme + 预复制 → 复制）。
- PPTX H5 全屏用 `createPortal(document.body)` 伪全屏：**必须 portal**（H5ZoomStage 的 transform 会让非 portal 的 fixed 相对它定位）；RO effect 依赖 `isFs` 重挂载后重新 observe，否则读到 0 宽把比例压到 10% 下限。

## 文档模板（细节见技能）
- `templates/*.json` 是**产物**，绝不手改；改 `_src/` 后跑生成器；`bash tools/verify/template-check.sh` 校验。
- `DocTemplate.Builtin` **禁用 `gorm:"default:true"`**（GORM 跳过带 default 的零值 → 自建/导入被写成 builtin=1，管理员删不掉）。
- 批量导入 `errors` 必须初始化为 `[]`（nil 序列化成 null 会让前端 `.length` 白屏）。
- 白名单 `validTemplateDocTypes`＝markdown/sheet/mindmap/gantt/whiteboard/**drawing**/**flowchart**。

## 回归与提交
- `tools/verify/`（登记 run-all.sh）须顺序执行；夹具账号 `e2e@example.com/secret123`（book 1=md 2=sheet 3=mindmap 4=flowchart 5=file）。
- H5 阅读态套件 `h5-reader-check.sh`（端口 8177，现 **68 项**）覆盖 `/m/doc` 与 `/share`、`/doc-share`，
  含分享面板（`data-h5-share-entry/sheet`）与甘特折叠条（`data-h5-gantt-mode`）断言；
  改了 `GanttChart`/`SheetView` 这类桌面手机共用组件，要连带跑 `gantt-fold-check`、`gantt-fold-edge-check`、`gantt-ui-check`、`preview-zoom-check`。
- **AutoMigrate 是异步的**：服务起来后 `/api/books` 先返 401，但 `users` 表可能还没补 `deleted_at` —— 此刻登录会得到「账号或密码错误」(TOKEN=null)，门禁整套假红。套件里**登录必须重试轮询**（40×0.5s）；另可预置已迁移夹具 `$TMPDIR/e2e-ready` 走 `E2E_DATA=`。
- **产品行为改了必须同步改套件**：`0b46e51` 移除流程图缩放工具条却漏改 `preview-zoom-check.sh`，导致门禁长期假红。
  改完记得跑一次全量（23 套）确认 `ALL_SUITES_PASS`。`preview-zoom-check` 第 5 段盯表格点击命中（同偏移连点 3 次 + 滚动后再点，须同行）。
- **产品行为改了必须同步改套件**：`0b46e51` 移除流程图缩放工具条却漏改 `preview-zoom-check.sh`，导致门禁长期假红。
  改完记得跑一次全量（23 套）确认 `ALL_SUITES_PASS`。
- `gantt-ui-check.sh` 第 1 段盯「新建文档」入口：子菜单弹层是独立 `.ant-dropdown-menu-submenu-popup`，需派发 `mouseover`/`mouseenter` 才展开。
- 提交前必须 `git status --short` 逐行核对（曾把 179MB `haiku.tar` 卷进提交）；已 gitignore `*.tar`/`__pycache__`/`*.pyc`。

## 白板与临时目录
- Excalidraw 须显式 `import '@excalidraw/excalidraw/index.css'`；`EXCALIDRAW_ASSET_PATH=/excalidraw/dist/prod/`。
- 系统 `/tmp` 仅 10MB 且命令间不保留 → 临时产物放 `~/hk-tmp`；**跑 `tools/verify/` 必须 `TMPDIR=/home/macro/.workbuddy/tmp`**（套件去那里取二进制）。
