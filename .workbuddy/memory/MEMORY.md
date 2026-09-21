# 项目长期约定（haiku-wiki / 寄海文库）

## 技术形态
- 后端 Go+Gin+GORM，SQLite(glebarez 免CGO)或 MySQL；JWT；embed 托管前端 dist。
- 前端 Vite5+React18+TS strict+AntD5；Vditor/mind-map/x-data-spreadsheet/mermaid/pdfjs+mammoth/drawio 全自托管，无外部 CDN。
- 预览图三层尺寸：Original+Preview(≤1920)+Thumb(≤400)；regenerate 端点 prototype/items 与 gallery/images 各一。

## 构建环境
- **Go 必须用系统 `/usr/local/go/bin`（go1.25.7）**：托管 go 是 1.23.4，server/go.mod 要求 ≥1.25 会直接失败。需设 `HOME/GOPATH/GOMODCACHE/GOCACHE/TMPDIR/GOPROXY=goproxy.cn,GOSUMDB=off,GOTOOLCHAIN=local`（详见 tools/build/build-embed.sh）。
- **Node 用托管版**：macOS `export PATH=/Users/macro/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH`（Linux 同款路径 /home/macro/...）。前端构建 = `cd web && npm run build`（tsc+vite），随后 `rsync -a --delete web/dist/ server/internal/static/dist/`。
- **前端 tsc 报错一律按真实缺陷处理**（已归零，无"预存报错"）。

## 已知陷阱（实测铁律）
- **Vditor IR DOM（lib/irDom.ts，2026-09-21 无头 Chrome 实测）**：①Vditor 为所有模式各建一个 `.vditor-reset`（wysiwyg/sv/ir/preview 共4个），只有 `.vditor-ir .vditor-reset` 是正文，裸 querySelector 命中 wysiwyg 空壳 → 块手柄悬停全废；②`data-block` 是静态占位"0"不是行号，按值查询/读值恒 0，只能用文档序索引（`irBlocks/irBlockIndex`）；③顶层块是 reset(一个`<pre>`)的直接子元素，标题/正文是 `<p>`（标题带 `.vditor-ir__marker--heading`），代码块包在 `.vditor-ir__node`。NotionEditing/FormatToolbar/VditorEditor.focusBlock 三处已统一走 irDom。**前端 DOM 定位问题勿再凭推理修，用无头 Chrome 实测**（系统 Chrome + `--headless=new --no-proxy-server --virtual-time-budget=20000 --screenshot`；`--no-proxy-server` 必须，127.0.0.1 代理劫持 localhost）。
- **html/body `overflow-x:hidden` 勿移除**：右缘 Tooltip 会引发「滚动条↔布局平移」整页抖动自激回路。
- 点评区 Markdown 必须包 `.hk-comment-md`（否则 `.doc-content` 大 padding 撑爆窄面板）。
- `127.0.0.1` 代理劫持 localhost：curl 加 `--noproxy '*'`。
- **Agent Edit 可能静默失败**：改后必须 Read 复核。
- **GORM 无法给已存在复合主键表就地补自增主键**（MySQL 1068 / SQLite "Cannot add a PRIMARY KEY column"）：需 pre-AutoMigrate 幂等 repair（SQLite 走建新表→INSERT SELECT→drop→rename）。回归夹具 `tools/verify/fixtures/e2e-data/haiku.db` 故意保持旧结构，勿"顺手升级"。SQLite 重建表 DDL 必须带 `AUTOINCREMENT`（对齐 GORM 产出）。
- 托管 Go 跑 `go test/build` 必报 go.mod 版本错（见构建环境）。

## 本机 MySQL 方言测试（双栈改动必测）
- `127.0.0.1:3306` MySQL 9.5.0；账号 `haiku/Jihai2026`，库 `haiku` 空测试库、无建库权限。DSN `haiku:Jihai2026@tcp(127.0.0.1:3306)/haiku?charset=utf8mb4&parseTime=True&loc=Local`。mysql CLI 勿加 `--noproxy`。AutoMigrate 与 migrateTables 必须同次提交。

## CAS 秒传（2026-09-20 起）
- 键 `uploads/cas/<md5前2>/<md5>-<rand6>.<ext>`；去重靠 DB md5 索引。前端一律先 spark-md5 → `POST /api/uploads/precheck`（响应绝不回 url）→ 命中走 `/instant`。批量走 manifest 两阶段（条数不符 40001 整批拒）。删除只删 meta 不删物理文件。错误码不新增。

## 架构约定
- 后端是导出/转换唯一事实来源；markdown 统一 MarkdownView；自动保存 3s 防抖。按需加载三层必须维持（入口 CSS `grep -c vditor` 应为 0）。
- 新增 doc_type 改动面：`handler.validDocTypes`→`exportx`→前端 `DocType`→`iconForDocType`→`DocContent` 分发。
- folder 只作容器：不参与搜索/导出/分享/协作/最近更新。Dashboard `/` 最近更新走 `GET /api/recent-docs`。
- 甘特图（SVAR @2.7.3）：只给有子节点的父节点写 `open:true`；`lib/gantt.ts resolveSvarTask` 兜底数字/字符串 id；回归 `npm run verify:gantt-ids`。
- 点评区：根主题=docs.ID；comments/comment_settings 两处注册（database.go+migrate_service.go）；禁言名单对外走 `CommentSettingOutput.banned_uids`，前端始终带当前名单不可默认 `[]`。
- 接口文档刷新：`apidoc.Parse`→`mergeApiDoc` 原地合并，绝不重建文档/改 endpoint id；失效接口进 `g_stale` 保留；失败只记结果不覆盖正文（hkerr.Param=400）；SSRF 校验独立在 `api_refresh_service.go`；每日 02:00 只对新导入文档生效。
- **新建文档入口主路径是 `BookPage.openNewDoc`**（KnowledgeTree 侧栏/书头右键菜单/内容区「新建文档」全部经此），走两步 Modal（选择位置→填写信息）。`components/tree/DocTree.tsx` 是**死代码**（未被任何路由 import，只有 store 在用它），勿再改动它。
- **新建/导入入口流程（2026-09-22 改造）**：①行尾「+」菜单（`buildPlusMenuItems`，全部 DOC_TYPES+新建分组+导入文件）走**直达流程**——`openNewDocAt`（位置已定+类型锁定 `newDocLockedType`→画廊 `lockDocType` 过滤→选模板/空白后跳过「选择位置」直达命名）、folder 直达命名、`openImportDirect` 直接开 ImportDialog 抽屉；②文库手柄「新建」是**子菜单**（`onNewDocWithType`，锁定类型但**保留**「选择位置」），「导入」保留两步。模板仅覆盖 markdown/sheet/mindmap/gantt（`validTemplateDocTypes`），其余 7 类画廊只有空白文档卡。step2 弹窗在锁定时用只读 Tag 显示类型。
- **文档模板（2026-09-21 新增，2026-09-22 补全）**：后端 `doc_templates` 表 + 种子（`repository/templates_seed.go`，34 模板 / 14 业务分类，幂等 `SeedTemplates`）；接口 `GET /api/templates`（可按 `category`/`doc_type` 筛选）、`GET /api/templates/categories`、`POST /api/templates`（仅本人自建）、`DELETE /api/templates/:id`（仅本人）、`PUT /api/admin/templates/:id`（仅管理员）、批量导入 `POST /api/admin/templates/import`。前端画廊 `components/template/TemplateGallery.tsx` 同时用于「新建文档」弹窗与独立 `/templates` 页面（`TemplateGalleryPage`），**选模板先弹 `TemplatePreview` 小窗预览，点「使用此模板」才回填类型/标题/正文走两步流程**（不再点卡即建）；模板中心页共用同一画廊组件自动生效。**目录树文件「⋯」菜单新增「另存为模板」**（`buildTreeMenuItems` → `BookPage.openSaveAsTemplate` → `createTemplate`）。**管理员页 `AdminTemplatesPage` 可编辑/删除自定义模板，内置模板禁用并说明**。
- **builtin 字段铁律**：`DocTemplate.Builtin` **不要**用 `gorm:"default:true"` —— GORM 对带 default 的字段跳过零值，自建/导入模板会被错写成 `builtin=1`（管理员删不掉、不进自定义列表）。写法：模型去 default，SeedTemplates 显式 `Builtin=true`，CreateTemplate 与导入显式 `Builtin=false`；启动时对 `builtin=1 AND created_by>0` 的脏数据做幂等 repair。批量导入 `errors` 字段必须初始化为 `[]`（nil slice 序列化为 `null` 会让前端 `.length` TypeError 白屏）。
- **模板数据源铁律（2026-09-22 重做，共 136 个：54 文档 / 39 脑图 / 38 表格 / 5 甘特）**：
  - **markdown 模板不要手改 JSON**：源文件在 `server/internal/repository/templates/_src/<目标json名>/<NN-名字>.md`（front matter 仅 `name`，可选 `title/category/doc_type`），跑 `python3 tools/templates/gen.py --prune` 生成/回写目标 JSON。`--check` 只校验不写（CI 用）；**不加 `--prune` 时源目录缺失的条目拒绝删除**（防误抹），源未补齐的文件整体跳过并列出缺失项。正文出现 `【…】`/占位符直接 `SystemExit`。约定：正文用**示例内容填充**（真实示例数据 + 「填写说明」blockquote），禁止 `【】`/`____` 填空。
  - **sheet/mindmap/gantt 走 `python3 tools/templates/polish.py [sheet|mindmap|gantt|all]`**：脚本按 `config.hkStyle`（sheet）/ `theme`（mindmap）/ 日期基准（gantt）判定幂等；**改样式逻辑必须先把 `server/internal/repository/templates/*.json` 用 `git checkout --` 回滚到原始数据再重跑**（表格插标题行是行下移变换，在已变换数据上重复施加会错位），并同步把 `SHEET_STYLE_VERSION` 递增。`polish_sheet` 末尾必须 `tpl["content"] = data` 回写（content 是 JSON 字符串时 `data` 只是解析副本，不回写等于没改——「通知签收表」曾因此漏美化）。
  - Luckysheet 表格样式只能走 `config`：`merge`/`borderInfo`/`rowlen`/`columnlen`，冻结列走 sheet 顶层 `frozen`；画布尺寸应**收紧**为 `last_r+5` / `n_cols+1`（沿用原 row 会留一大片空白网格）。
  - 脑图 `setThemeConfig` 是**整份替换**语义，模板的 `theme` 必须存完整快照（39 个主题键）。色卡由 `tools/templates/gen-mindmap-themes.mjs` 以库默认主题为基准 `deepMerge` 生成，**同时产出** `tools/templates/mindmap-themes.json`（模板用）与 `web/src/components/editor/mindmap/mmThemePresets.generated.ts`（编辑器预设 `MM_EXTRA_THEME_PRESETS`，在 `mmShared.ts` 追加进 `MM_THEME_PRESETS`）——两者必须同源，否则编辑器主题面板认不出模板主题。运行：`cd web && node ../tools/templates/gen-mindmap-themes.mjs`。
  - 甘特日期静态存 `start`+`duration`，状态由前端 `lib/gantt.ts taskStatus()` 按"今天"推导；模板排期必须相对基准日（`GANTT_TODAY`）平移，否则整屏「已超期」红点。
  - **阅读态排版主题在 `web/src/components/reader/reader.css` 顶部**，作用域 `.doc-content`（阅读态 + 模板预览共用，编辑器不受影响）。H2 竖条/H3 圆点的 `::before` 必须排在 **22px 折叠箭头之后**（`left:22px` 起），否则被箭头压住；表格必须显式覆盖 Vditor 默认的 `display:block`（改回 `display:table`）否则宽表被裁切。
  - `${TMPDIR}` 下 `shot-tpl-before.sh`/`shot-tpl-after.sh` 为模板预览实拍脚本（无头 Chrome + `--no-proxy-server`）。

## 回归套件（tools/verify/，登记 run-all.sh）
- 改前端必须先构建+rsync embed。套件须顺序执行（共用 8080/Chrome profile）；夹具账号 `e2e@example.com/secret123`（book 1=md 2=sheet 3=mindmap 4=flowchart 5=file）。`$TMPDIR` 下 haiku-wiki 二进制等不可删。
