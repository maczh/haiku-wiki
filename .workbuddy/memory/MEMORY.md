# haiku-wiki 项目长期约定（寄海文库）

> 模板创作/校验手册见技能 `haiku-wiki-template-authoring` 与 `tools/verify/README.md`。

## 构建
- Go+Gin+GORM（SQLite 免CGO/MySQL）+JWT 后端，embed 托管 dist；Vite5+React18 前端，编辑器全自托管。
- **Go 只能用系统 `/usr/local/go/bin`**：`server/go.mod` 要求 `go 1.25`，托管 1.23.4 直接构建失败。环境变量见 `tools/build/build-embed.sh`。
- `cd web && npm run build` → `rsync -a --delete web/dist/ server/internal/static/dist/`，**之后必须补回 `.gitkeep`**，否则 build-embed.sh 断言失败会静默跳过 go build。
- 前端 tsc 报错按真实缺陷处理（当前归零）。

## 实测铁律
- 前端 DOM 问题**必须无头 Chrome 实测**：`/opt/google/chrome/chrome --headless=new --no-proxy-server --no-sandbox`（必需：本机代理劫持 127.0.0.1）；curl 加 `--noproxy '*'`，Python 装空 `ProxyHandler({})`。
- **Chrome 截图高度 = 窗口高度**，估小会裁掉后半页。
- **后台进程在两次工具调用之间会被回收**：起服务+验证+停服务放同一条命令，或用 `setsid`。
- Vditor IR DOM（`lib/irDom.ts`）：页面 4 个 `.vditor-reset`，只有 `.vditor-ir .vditor-reset` 是正文；`data-block` 恒为 "0"，只能按文档序索引。
- `html/body` 的 `overflow-x:hidden` 勿移除（右缘 Tooltip 引发滚动条↔布局自激抖动）。
- Agent Edit 可能静默失败，改后必须 Read 复核。

## 数据库
- 本机 MySQL 9.5.0 `haiku/Jihai2026@127.0.0.1:3306/haiku`（无建库权限）；AutoMigrate 与 migrateTables 须同次提交。
- **GORM 无法给已存在复合主键表就地补自增主键**，需 pre-AutoMigrate 幂等 repair（SQLite 建新表→INSERT SELECT→drop→rename，DDL 带 AUTOINCREMENT）；夹具 `tools/verify/fixtures/e2e-data/haiku.db` 故意保持旧结构，勿升级。
- CAS 秒传：`uploads/cas/<md5前2>/<md5>-<rand6>.<ext>`；前端 spark-md5 → `POST /api/uploads/precheck`（绝不回 url）→ `/instant`；删除只删 meta。

## 架构
- 后端是导出/转换唯一事实来源；自动保存 3s 防抖；按需加载三层必须维持（入口 CSS `grep -c vditor` 应为 0）。
- 新增 doc_type 改动面：`handler.validDocTypes`→`exportx`→前端 `DocType`→`iconForDocType`→`DocContent`。
- folder 只作容器（不参与搜索/导出/分享/协作/最近更新）；Dashboard 最近更新走 `GET /api/recent-docs`。
- 新建文档主路径 = `BookPage.openNewDoc`（两步 Modal）；`components/tree/DocTree.tsx` 是死代码勿动；行尾「+」走直达流程，文库手柄「新建」是子菜单且保留「选择位置」。
- 甘特（SVAR@2.7.3）：只给有子节点的父节点写 `open:true`；`lib/gantt.ts resolveSvarTask` 兜底 id。
- 点评区：根主题=docs.ID；comments/comment_settings 两处注册；Markdown 须包 `.hk-comment-md`；禁言名单走 `CommentSettingOutput.banned_uids`，前端不可默认 `[]`。
- 接口文档刷新：`apidoc.Parse`→`mergeApiDoc` 原地合并，不重建文档/不改 endpoint id；失效接口进 `g_stale`。

## 文档模板（细节见技能）
- `templates/*.json` 是**产物**，绝不手改；改 `_src/` 后跑生成器；`bash tools/verify/template-check.sh` 校验。
- `DocTemplate.Builtin` **禁用 `gorm:"default:true"`**（GORM 跳过带 default 的零值 → 自建/导入被写成 builtin=1，管理员删不掉）。
- 批量导入 `errors` 必须初始化为 `[]`（nil 序列化成 null 会让前端 `.length` 白屏）。
- 白名单 `validTemplateDocTypes`＝markdown/sheet/mindmap/gantt/whiteboard/**drawing**/**flowchart**。

## 回归与提交
- `tools/verify/`（登记 run-all.sh）须顺序执行；夹具账号 `e2e@example.com/secret123`（book 1=md 2=sheet 3=mindmap 4=flowchart 5=file）。
- `gantt-ui-check.sh` 第 1 段盯「新建文档」入口：子菜单弹层是独立 `.ant-dropdown-menu-submenu-popup`，需派发 `mouseover`/`mouseenter` 才展开。
- 提交前必须 `git status --short` 逐行核对（曾把 179MB `haiku.tar` 卷进提交）；已 gitignore `*.tar`/`__pycache__`/`*.pyc`。

## 白板与临时目录
- Excalidraw 必须显式 `import '@excalidraw/excalidraw/index.css'`；`EXCALIDRAW_ASSET_PATH=/excalidraw/dist/prod/`。
- 系统 `/tmp` 仅 10MB 且命令间不保留 → 临时产物放 `~/hk-tmp`；**跑 `tools/verify/` 必须 `TMPDIR=/home/macro/.workbuddy/tmp`**（套件去那里取二进制）。
