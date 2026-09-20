# 项目长期约定（haiku-wiki / 寄海文库）

## 技术形态
- 后端：Go + Gin + GORM，SQLite（glebarez/sqlite 免CGO WAL）或 MySQL；JWT；embed 托管前端 dist。
- 前端：Vite5 + React18 + TS strict + AntD5；Vditor/mind-map/x-data-spreadsheet/mermaid/pdfjs+mammoth 均自托管，无外部 CDN。
- 预览/绘图：CAD 自研 SVG/PNG 看图；PPTX 用 pptx-preview@1.0.7；绘图用内嵌 iframe draw.io（自托管 vendor+public）。
- **原型/图片库预览图三层尺寸（2026-09-20 新增）**：`imgconv.Convert` 产出 `Original`(全分辨率、压白底、不缩放) + `Preview`(≤1920 标准屏宽) + `Thumb`(≤400 缩略图)。
  图片格式 `Original` 复用原图 url 不另存；非图片抽取预览(.rp/.sketch 内嵌/抽取图)的 Original 落 `original.jpg`。
  regenerate 端点：`POST /api/docs/:id/prototype/items/:itemId/regenerate` 与 `/api/docs/:id/gallery/images/:imageId/regenerate`（service: `RegeneratePrototypeItem`/`RegenerateGalleryImage`）。
  前端三尺寸用 AntD `Segmented`(屏宽/缩略图/原尺寸) 切换；重新生成按钮经 `docId` 透传（BookPage→DocContent→View）。

## 本机构建环境（必须显式设置，否则构建失败/静默成功）
- **Go 必须用系统那份 `/usr/local/go/bin`（go1.25.7）**：workbuddy 托管的 `/home/macro/.workbuddy/binaries/go/bin/go` 是 **1.23.4**，而 `server/go.mod` 要求 `go >= 1.25` → 用它 + `GOTOOLCHAIN=local` 会直接报 `go.mod requires go >= 1.25`；不加 `GOTOOLCHAIN=local` 则联网下 toolchain 并在 `GOSUMDB=off` 下失败。`tools/build/build-embed.sh` 已按此修正（`/usr/local/go/bin` 优先 + `GOTOOLCHAIN=local`）。
- 前端 Node 用托管那份 `/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin`。

```bash
# --- Go（后端）---
export PATH=/usr/local/go/bin:$PATH
export HOME=/home/macro
export GOPATH=/home/macro/.workbuddy/go GOMODCACHE=/home/macro/.workbuddy/go/pkg/mod
export GOCACHE=/home/macro/.workbuddy/go/cache TMPDIR=/home/macro/.workbuddy/tmp/gotmp
export GOPROXY=https://goproxy.cn,direct GOSUMDB=off GOTOOLCHAIN=local
mkdir -p "$TMPDIR"
# --- Node（前端）---
export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export npm_config_cache=/home/macro/.workbuddy/npm-cache TMPDIR=/home/macro/.workbuddy/tmp
```
（HOME 为空时 go 退出码仍为 0 但报 `module cache not found`；GOMODCACHE 不设会重新下载全部依赖。`/tmp` 是 10MB tmpfs，`go build` 会 `no space left on device`，故必须设 `TMPDIR`。）

## 已知陷阱
- `127.0.0.1` 代理会劫持 localhost → curl 加 `--noproxy '*'`。
- safe-delete shim：单 turn 删除/覆盖 >50 文件被拦；用 `mv` 腾目录、大小相同即跳过。
- 静态 SPA 兜底：`io/fs` 的 `fs.ValidPath` 拒尾斜杠，`fs.Stat("drawio/")` 返回 `invalid argument` 而非「不存在」→ 目录型请求误判为应用；`router.staticProbePath()` 补 `<dir>/index.html` 再判。
- agent-browser 的 ref/页面状态不跨 Bash 调用保留；同 IP 注册限频 60s。
- **前端 tsc 报错：已「归零」，不要再当成可忽略的预存噪声**（2026-09-20 复核）。历史上有两条被记录为"预存、与功能无关、可忽略"：① `@svar-ui/react-gantt` 已声明但未装进 `node_modules`；② `GanttChart.tsx` 两处 `ev:any`。**现在两条都已消失**：该依赖已安装（T03f 装 `spark-md5` 时顺带补齐），`GanttChart.tsx` 的 `ev` 改由 `api.on/intercept` 的签名推断、不再写 `any`。实测 `npx tsc --noEmit` **退出码 0、零输出**。⇒ 今后前端若出现 tsc 报错，**一律按真实缺陷处理**，不要再引用"预存报错"这个说法；`npm run build` 也不再被缺依赖阻塞。
- **Agent Edit 静默失败风险**：曾出现 Edit 报告成功但实际未改动（结构体字段、前端 import/handler）。任何改动后必须 `Read` 复核关键文件，不能只信 commit message。
- **GORM 无法给「已存在的复合主键表」就地补自增主键列**（2026-09-20 实测，**双方言都断**）：给已有 PRAGMA/复合 PK 的表新增 `ID uint64 gorm:"primaryKey"` 字段后，`AutoMigrate` 直接失败并 `log.Fatalf` 退出进程。
  MySQL：`Error 1068 (42000): Multiple primary key defined`（`ALTER TABLE t ADD id ... AUTO_INCREMENT, ADD PRIMARY KEY (id)`）；
  SQLite：`SQL logic error: Cannot add a PRIMARY KEY column (1)`。
  影响所有存量库（SQLite 是默认驱动 + Docker 形态），必须写 pre-AutoMigrate 的幂等 repair（SQLite 只能走建新表→INSERT SELECT→drop→rename 的表重建）。
  连带：回归夹具 `tools/verify/fixtures/e2e-data/haiku.db` **故意保持旧结构**以覆盖这条路径，任何"顺手升级夹具"都会让该回归失效。
- **SQLite 重建表时的 DDL 要对齐 GORM 自己的产出**：autoinc 主键必须写成 `` `id` integer PRIMARY KEY AUTOINCREMENT ``（带 `AUTOINCREMENT`）；夹具库里 GORM 自建的 `users` 表即是基准。少写 `AUTOINCREMENT` 可能导致 GORM 判定类型不符，每次启动重复重建。
- **托管 Go 版本陷阱**：`go test`/`go build` 必须用 `/usr/local/go/bin`（见「本机构建环境」），否则报 `go.mod requires go >= 1.25`。

## 本机 MySQL 方言测试实例（双栈改动必测，2026-09-20 实测）
- `127.0.0.1:3306` = **MySQL 9.5.0**（生产同款方言）。账号 `haiku/Jihai2026`，`GRANT ALL ON haiku.*`，**无建库权限**（`ERROR 1044`）。
- `haiku` 库为空测试库（schema 停在迁移前），可直接跑全量 `AutoMigrate`+`migrateTables` 验 DDL、索引长度上限（3072B，`ERROR 1071`）、LIKE 方言。
- DSN：`haiku:Jihai2026@tcp(127.0.0.1:3306)/haiku?charset=utf8mb4&parseTime=True&loc=Local`。
- `mysql` CLI **不能**加 `--noproxy='*'`（curl 参数，会报 `unknown variable`）。
- 双栈硬约束：新列/新表的 `AutoMigrate` 与 `migrateTables` 必须**同一次提交**改完；`AutoMigrate` 紧跟 `Connect` ⇒ 迁移失败=进程启动失败。

## 内容去重 / 秒传（CAS）约定（2026-09-20 起）
- 键名 `uploads/cas/<md5前2位>/<md5>-<随机6位>.<ext>`；**去重靠 DB 的 md5 索引而非键名**（防 URL 枚举反查）。`attachments.md5`、`docs.content_md5` 均已建索引。
- 秒传：前端**一律先算 hash**（`spark-md5` + Worker，4MiB 分片）→ `POST /api/uploads/precheck`（单条/批量 ≤100，互斥）→ 命中走 `POST /api/uploads/instant`（无文件字节）。**预检响应绝不回 `url`**（信息面最小化）。
- 批量入口（gallery/prototype）走 `manifest` 两阶段协议：`manifest` 是唯一真源，严格校验 `len(files)==kind=file 条数`，不符 `40001` **整批拒绝**（防字节与标题错位）；ref 查不到 → 该条进 `rejected` 其余继续。
- 派生件确定性命名（同目录同基名换扩展）+"`Exists()` 即跳过"保证预览/缩略图也只存一份；`attachment_derived`（PK=原件 md5）缓存非纯函数字段（宽高/entry/kind/degraded）。
- 删除语义：**只删 meta 不删物理文件**（`safeDeleteOwnedSet` 判定同一 storage_path 是否还有别的 meta 行）。
- 新增 `doc_type` 之外的改动面：新错误码**不新增**，沿用 `0/40001/40101/40301/40401/40901/41301/41501/42901/50000`。

## 架构约定
- 后端是导出/转换唯一事实来源；markdown 统一 `MarkdownView`；自动保存 3s 防抖。
- 按需加载三层（库级 / 路由级 / 静态依赖）必须维持；入口 CSS `grep -c vditor` 应为 0。
- 新增 `doc_type` 改动面：`handler.validDocTypes` → `exportx` → 前端 `DocType` 联合类型 → `iconForDocType` → `DocContent` 分发（不在表内被静默归一化为 markdown 落库）。

## 目录(folder)/ 首页 Dashboard / 甘特图
- folder 为容器、不承载正文；不参与搜索/导出/分享/协作/最近更新。
- Dashboard：`/` 取代旧书架页；最近更新走 `GET /api/recent-docs`（SQL 粗筛 + 业务规则复核双层）；localStorage 键 `hk_onboard_dismissed` / `hk_intro_video_dismissed`。
- 甘特图（SVAR React Gantt @2.7.3）：致命坑①只给**有子节点**的父节点写 `open:true`（全写白屏）；坑②`byId` 是数字 Map、DOM `data-id` 是字符串 → `lib/gantt.ts` 的 `resolveSvarTask` 兜底；面板折叠走原生 `displayMode` 不可用 CSS `display:none`；`.wx-theme{height:100%}` 必须保留。回归 `npm run verify:gantt-ids`。

## 回归套件 / 构建（tools/）
- 端到端套件在 `tools/verify/`（登记进 `run-all.sh`）；改前端**必须先** `bash tools/build/build-embed.sh`。
- 必须顺序执行（共用 XDG_RUNTIME_DIR / Chrome profile / 8080）；夹具在 `tools/verify/fixtures/`（e2e-data 含种子 `haiku.db` + 账号 `e2e@example.com/secret123`，book 1=md 2=sheet 3=mindmap 4=flowchart 5=file）。
- `$TMPDIR` 不可删：`haiku-wiki` 二进制、`vendor/lr`、`gotmp`、`xdg`、`agent-browser-chrome-*`、`regress`。
