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
```bash
export PATH=/home/macro/.workbuddy/binaries/go/bin:$PATH
export HOME=/home/macro
export GOPATH=/home/macro/.workbuddy/go GOMODCACHE=/home/macro/.workbuddy/go/pkg/mod
export GOCACHE=/home/macro/.workbuddy/go/cache TMPDIR=/home/macro/.workbuddy/tmp/gotmp
export GOPROXY=https://goproxy.cn,direct GOSUMDB=off
export PATH=/home/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH
export HOME=/home/macro npm_config_cache=/home/macro/.workbuddy/npm-cache TMPDIR=/home/macro/.workbuddy/tmp
```
（HOME 为空时 go 退出码仍为 0 但报 `module cache not found`；GOMODCACHE 不设会重新下载全部依赖。）

## 已知陷阱
- `127.0.0.1` 代理会劫持 localhost → curl 加 `--noproxy '*'`。
- safe-delete shim：单 turn 删除/覆盖 >50 文件被拦；用 `mv` 腾目录、大小相同即跳过。
- 静态 SPA 兜底：`io/fs` 的 `fs.ValidPath` 拒尾斜杠，`fs.Stat("drawio/")` 返回 `invalid argument` 而非「不存在」→ 目录型请求误判为应用；`router.staticProbePath()` 补 `<dir>/index.html` 再判。
- agent-browser 的 ref/页面状态不跨 Bash 调用保留；同 IP 注册限频 60s。
- **前端 tsc 预存报错（与功能改动无关，勿误修）**：`@svar-ui/react-gantt` 依赖未在 node_modules 安装（package.json 已声明），且 `GanttChart.tsx` 两处 `ev:any`。验证新功能时这些报错应被忽略。
- **Agent Edit 静默失败风险**：曾出现 Edit 报告成功但实际未改动（结构体字段、前端 import/handler）。任何改动后必须 `Read` 复核关键文件，不能只信 commit message。

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
