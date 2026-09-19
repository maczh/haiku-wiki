# 寄海文库：「新建目录」+ 目录选择框显示数字/选了变 0 的修复

本轮解决用户反馈的三件事（同一张截图里的三条）：

1. **新建菜单允许新增「目录」** —— 产品此前根本没有「目录 / 文件夹」这个概念，
   只有"恰好有子节点的文档"会被画成文件夹图标，用户无法主动建一个空目录；
2. **新建/导入对话框里「目录（存放位置）」下拉显示的是裸数字（`0`），不是目录名称**；
3. **无论在下拉里选什么，最后都落在 `0`** —— 选子目录 / 子文档无效。

三条其实是**两个独立缺陷**：②③ 是同一个前端契约 bug，① 是缺失的产品能力。

> 上一版 `overview.md`（功能指南 + 首页 Dashboard + 演示视频）已随提交进入 git 历史，
> 用 `git log -p -- overview.md` 回看。
>
> **注**：这份文档在「目录功能」交付之后又追记了收尾工作 —— 第六节（回归套件与构建脚本入库
> `tools/`），含「把停用的 `gantt-ui-check` 修活」与「临时 id 归一化 / 优先级外框静默消失」
> 两个小节。它们不改功能面，但同为本次交付的一部分。

---

## 一、根因：AntD Select 只认 `{value, label}`

「选什么都变 0」不是后端不认，而是**前端根本没把选中的值传出去**。

原实现把下拉选项构造成 `{ id: 节点ID, label: 名称 }`。而 AntD 5 的 `Select`
只认 `options` 里的 `{ value, label }`（内部 `fieldNames` 默认就是
`{ label: 'label', value: 'value' }`）。于是每一项的 `value` 都是 `undefined`：

- 控件匹配不到任何选项 → **回退显示原始受控值**，也就是那个孤零零的 `0`（根目录 id）；
- 用户点击某项 → `onChange` 收到的也是 `undefined` → 落库 `parent_id = 0`。

**显示错误和保存错误是同一个根因**，所以只改显示（补 label）是治不了的。
修复方式是把「目录下拉选项」的构造抽成纯模块并锁住契约：

`web/src/lib/dirOptions.ts`（新增）

```ts
export interface DirOption { value: number; label: string }
export const ROOT_DIR_VALUE = 0
export const ROOT_DIR_LABEL = '根目录（知识库顶层）'
export const PICK_BOOK_FIRST = '请先选择知识库'

// 深度优先展开为 AntD 可用的 {value,label}；label 用全角空格按层级缩进，目录带「（目录）」后缀
export function buildDirOptions(docs: DocNode[]): DirOption[]
export function withRootDir(options: DirOption[]): DirOption[]   // 首项恒为「根目录（知识库顶层）」
```

同时把 `buildChildrenMap` 从 `stores/docTreeStore.ts` 迁到新文件 `web/src/lib/docTree.ts`
（纯函数，避免被 zustand/React 依赖图连带拉进入口 chunk），store 里改为 re-export，
所有既有 import 路径不变。`BookPage.tsx` 里页内那份 `flattenDocs` + 局部 `DirOption` 已删除。

回归脚本 `verify:dashboard` 新增第 ⑧ 组 15 条断言直接把这个契约钉死：
每项必须有 `value`/`label`、**不得残留 `id` 字段**、5 个节点全覆盖、
深度优先顺序 `10,11,14,13,12`、缩进层级、目录后缀、空数组、`withRootDir` 不改动入参、
置顶优先、`ROOT_DIR_VALUE === 0`。

---

## 二、新增 `doc_type = folder`：一个类型要改的面比想象的多

### 后端

| 文件 | 改动 |
| --- | --- |
| `server/internal/handler/doc_handler.go` | `validDocTypes` 白名单加 `folder`（**漏了会被静默归一化成 markdown 落库**，不报错） |
| `server/internal/service/exportx/export.go` | `NormalizeDocType` 加 `case "folder"`；folder 与 file 同款「无可导出格式」；`Convert` 给出可读拒绝：「目录不承载正文，无法导出，请导出目录下的文档」；file/folder 的前置判断**移到 `LookupFormat` 之前**（否则先撞"无格式列表"报出含糊错误） |
| `server/internal/repository/recent_doc_repo.go` | 新增常量 `recentDocFilter = "docs.deleted_at IS NULL AND docs.doc_type <> 'folder'"`，两个列表查询共用，在 SQL 层排除目录 |

`folder` 的产品语义（刻意保守）：

- 正文恒为空，**不承载内容**；可以有子文档与子目录（层级容器）；
- **不参与**搜索、导出、分享、协作、以及首页「最近更新」；
- 不能作为分享对象；删除 / 恢复按既有 `SoftDelete` + `ListDescendantIDs` **整棵子树级联**。

### 前端

| 文件 | 改动 |
| --- | --- |
| `web/src/types.ts` | `DocType` 加 `\| 'folder'`；`DOC_TYPE_LABEL` 加 `folder: '目录'`（`DOC_TYPES` 故意不含 folder，避免出现在"文档类型"下拉里） |
| `web/src/lib/fileIcon.tsx` | `iconForDocType` 加 `case 'folder'` → `FolderOutlined` + `FOLDER_COLOR = '#faad14'` |
| `web/src/components/reader/DocContent.tsx` | folder 静态占位分支「这是一个目录」（**刻意不懒加载任何渲染器**）；`showWidthControl` 对 folder 关掉 |
| `web/src/pages/BookPage.tsx` | 新增 `newDocKind: 'doc' \| 'folder'`；`isFolderDoc` 用于禁用编辑、隐藏协作/分享、编辑态显示"目录不承载正文" |
| `web/src/components/tree/KnowledgeTree.tsx` | `onNewDoc` 签名扩展为 `(bookId?, parentId?, kind?)`；folder 节点也画文件夹图标；库菜单加「新建目录」、节点菜单加「新建子目录」；folder 时禁用编辑/复制且**不渲染**导出/分享项 |
| `web/src/lib/dashboard.ts`、`tree/DocTree.tsx` | `folder: '未命名目录'`（`Record<DocType, …>` 由 tsc 强制补全，漏了就编不过） |
| `web/src/pages/SharePage.tsx` | 分享页树按 `children.length > 0 \|\| doc_type === 'folder'` 显示文件夹图标 |

**"目录"的三个入口**：知识库标题右侧三横菜单 / 节点右键「新建子目录」/ 正文空态链接；
外加首页快捷操作（见下）。

---

## 三、导入也要能指定目标目录

### 弹窗内选目录
`QuickStartModal.tsx` 新增「目录（存放位置）」表单项：换知识库时目录选项重载并回落根目录；
未选库时下拉 `disabled` + 占位符「请先选择知识库」；`showSearch optionFilterProp="label"` 支持按名称搜索。

### 从首页直达某目录导入
首页快捷操作选好「知识库 + 目录」后跳转：

```tsx
navigate(`/books/${bookId}?import=${kind}${parentId ? `&parent=${parentId}` : ''}`)
```

知识库页解析 `&parent=`（非正整数一律回落 `ROOT_DIR_VALUE`），打开导入对话框后
**立刻把 `import`/`parent` 从 URL 清掉**（`setSearchParams(replace)`），避免刷新重开。

---

## 四、验证

### 新增端到端脚本 `e2e-folder-dir.sh`（49 项断言，**49/49 PASS**）

覆盖：三个新建目录入口、目录占位页文案、目录下拉显示名称而非数字、
**新文档落在所选子目录下（不是 0）**、导入的 3 个文件**全部落在所选子目录下 3/3**、
目录不出现导出/分享项、目录不进「最近更新」、删除目录级联子树。

> 脚本全部走**单源生产形态**（vite build → embed → go build → 浏览器），
> 断言基于 API 回查的 `parent_id` 精确值，而不是看界面"像不像"。
> 截图目录：`/home/macro/.workbuddy/tmp/e2e-folder-1789816884/shots`（含 `08-newfolder-done.png` 目录占位页）。

写这个脚本时踩到 5 类 **AntD 交互的"脚本假失败"**（产品一直是好的，见技能 §3.3.4）：
`Button` 的 `autoInsertSpace` 会在**恰好两个汉字**间插空格（`创建`→`创 建`）；
`Modal` 步骤切换动画期间**两个 Modal 同时在 DOM**（必须按 `.ant-modal-title` 定位）；
裸 `input` 会先命中 Select 内部的 selection-search（要用 `.ant-input`）；
受控输入必须走原生 setter + `input` 事件；Tree 只渲染已展开层级（要逐级 `expandNode`）。

### 全量回归（无回归）

| 套件 | 结果 |
| --- | --- |
| `go test ./... -count=1 -p 1` | 全绿（含新增 `TestRecentDocsExcludeFolder`、`TestFolderDocAsParent`） |
| `gofmt -l .` / `go vet ./...` | 0 / 无告警 |
| `tsc --noEmit` | 0 错误 |
| `verify:dashboard` | 全绿（+15 条目录契约断言） |
| `e2e-folder-dir.sh` | **49/49**（新增） |
| `e2e-dashboard.sh` | **40/40**（断言从"2 个下拉"更新为 3 个并补目录下拉文案/非禁用态） |
| `embed-prod-check.sh` | 17/17 |
| `check-lazy-routes.sh` / `check-route-fallback.sh` | 14/14 · 14/14 |
| `ui-doc-types.sh` / `e2e-import.sh` / `gantt-fold-check.sh` | 18/18 · 10/10 · 30/30 |

**分包不变量维持**（目录功能没有破坏按需加载）：
入口 JS **755,375 B**、入口 CSS **4,083 B**；`wx-gantt / svar / GanttChart / vxe / luckysheet /
vditor / simple-mind-map / mermaid / pdfjs` 在入口 chunk 计数**全为 0**；
`BookPage` 独立 chunk 1,319,958 B（较上轮仅 +1,889 B），`DashboardPage` 24,962 B + CSS 3,934 B。
生产形态：embed **3001 文件 / 86 MB**，二进制 105,000,336 B。

---

## 五、文档与知识沉淀

- `docs/寄海文库功能指南.md`：§6.1 重写（补全三个新建目录入口）、§6.2 菜单表补「新建子目录」与
  「目录不提供导出/分享/协作」、**新增 §6.5 目录（文件夹）**、**新增 §7.11 目录（容器，非内容类型）**、
  §10.1 导入补目标目录说明、FAQ 加 Q11；PDF 重生成 **2,447,148 B / 32 页**（抽查 p10 渲染正常）。
- `~/.workbuddy/skills/haiku-wiki-build-verify/SKILL.md`：新增 **§3.3.4**（AntD 5 类脚本假失败对照表，
  含关闭下拉必须用 `press Escape`）与 **§6.1**（新增一个 `doc_type` 的 8 步改动清单）。

---

## 六、顺带：回归套件与构建脚本入库 `tools/`

收尾时发现一个隐患：**11 套浏览器回归脚本全住在 `/home/macro/.workbuddy/tmp/`**，
而那个目录正要清理 —— 套件、夹具、生成器会一起消失。已全部收进仓库并做耐久化。

```
tools/build/    build-embed.sh（前端 → embed → go build）、build-guide-pdf.sh（指南 → PDF）+ README
tools/verify/   14 个套件（全部登记进 run-all）+ run-all.sh
                fixtures/e2e-data/        种子库快照（book 1 固定 1=md 2=sheet 3=mindmap 4=flowchart 5=file）
                fixtures/import-fixtures/ xlsx（含空表）/docx/pdf + 重生成脚本
                gen-upload-js.py          夹具 → 页面注入 JS（agent-browser upload 静默失效的替代）
```

三处耐久化改造（否则「入库」只是搬了个壳）：

1. **夹具快照 + 临时副本**：原先 4 套直接读 tmp 下那个数据目录。现在默认把仓库夹具**复制成临时副本**
   再交给服务端写（夹具保持原样、可反复跑），`E2E_DATA=<dir>` 可覆盖。
   快照前用 `PRAGMA wal_checkpoint(TRUNCATE)` 把 WAL 落盘，否则拷出来的是「半个库」。
2. **路径参数化**：`HAIKU_BIN` / `PORT` / `UPLOAD_JS_OUT`，`REPO` 改为按脚本位置推导，
   删掉所有对 tmp 既有文件的引用；`.gitignore` 加例外 `!tools/verify/fixtures/**/*.db`。
3. **`run-all.sh` 重写**：跑前探测端口（被幽灵实例占用的套件直接跳过并标注原因，不再产出假结果）、
   统一三种计数口径、失败时打印明细并以非 0 退出。

### 一个值得记住的「假失败」

全套回归里 `e2e-import` 报 `❌ 注册失败`，**用时只有 1 秒**。真因是端口 18081 被上一个会话留下的服务
占着（在另一个 PID 命名空间，`ps` 看不到）：套件自己的服务 `bind: address already in use` 起不来，
于是它连上了**别人的**服务、在**别人的库**里注册用户 → 注册失败。看起来像产品故障，其实是环境问题。
换 `PORT=18099` 重跑 → **10/10 通过**。现在这两套自带端口预检，遇到占用会直接明确报错。

### 仓库内脚本的全套结果

`embed-prod-check` 17 · `e2e-folder-dir` 49 · `e2e-dashboard` 40 · `e2e-import` 10（换端口后）·
`e2e_export` 15 · `ui-doc-types` 18 · `gantt-fold-check` 30 · `gantt-fold-edge-check` 22 ·
`gantt-api-check` 21 · `gantt-ui-check` **24**（修活 + 新增 3 条断言）· `check-lazy-routes` 14 ·
`check-route-fallback` 14 · `ui-shot` 截图 · `sim-docker-web` OK（内含一次完整 `npm build`）。

这批收尾前后共复跑过**两次**全套（14 套全在册、都没有套件被端口占用跳过），两次都是 `ALL_SUITES_PASS`：

| 时点 | 结果 | 耗时 |
| --- | --- | --- |
| `gantt-ui-check` 修活并重新登记进 `run-all.sh` 之后 | ✅=272 ❌=0 | 23m04s |
| 临时 id 归一化 + 优先级外框修复之后（改了前端，重跑 `build-embed.sh`） | **✅=275 ❌=0** | 17m29s |

分包不变量维持：入口 JS **755,375 B**、入口 CSS **4,083 B**（与修复前逐字节相同），
`wx-gantt` / `svar` / `GanttChart` / `vxe-gantt` 在入口 chunk 的计数**全为 0**；
甘特代码仍只在独立 chunk（`GanttChart-*.js` 266,756 B / `GanttChart-*.css` 36,492 B）。
生产形态：静态资源 3001 文件 / 86 MB，二进制 104,661,373 B。

### 把那套「过期」的旧套件修活了（11✓/9✗ → 21/21 → 24/24）

补入甘特套件时一并收了 `gantt-ui-check.sh`（编辑态增删任务的界面冒烟），**首次实测 11 ✓ / 9 ✗**。
逐条排查确认是**脚本与产品交互漂移**、不是产品缺陷，随后修到 **21/21 全绿**（`GANTT_UI_OK`）：

| 漂移 | 真因 | 修法 |
| --- | --- | --- |
| 找不到「新建文档」入口 | 入口已改到**知识库节点的「⋯」菜单**，且节点挂在「私人知识库」分组下（没展开就不在 DOM 里）；菜单只负责打开「选择位置」，第二步才是「文档类型」下拉 | 先 `expandNode` 展开分组 → 点节点上的 `.anticon-more` → 读菜单 → 下一步再读类型下拉 |
| 新增任务不生效 | 交互改成**弹窗表单**了（填「任务名称」→ 页脚「新增」），脚本还在假设点一下直接插入 | 按标题定位 `.ant-modal` → 原生 setter 填 `input[placeholder="例如：接口联调"]` → 点归一化后的「新增」 |
| 读正文「拿回空响应」刷了一屏 traceback | **新建文档的 `content` 本来就是空串**（默认 3 条任务是前端默认值，改过才落库），不是网络问题 | 用 `or '{}'` 兜住；正文为空时明确跳过拖拽段而不是级联报错 |

顺带揪出两个**断言陷阱**（其中一个原先让套件「假绿」）：

- **汇总条也有进度手柄**：`type=summary` 的条上同样有 `.wx-progress-marker`，但它的进度由子任务派生、拖了不会变。
  旧脚本取「第一条带手柄的条」→ 取到的正是 id=1 的汇总条 → 误报「进度未变化」。改成必须选**叶子任务**后，
  实测 `0 → 27` 落库成功。
- **「没找到任务条」会让横向拦截断言恒真通过**：那条断言原本是「起始日没变 → 通过」，而找不到条时起始日当然没变。
  已把「找到条」改成前置条件，找不到即判失败。
- **副产品 → 追出了一个真缺陷**：界面新增的任务落库 id 形如 `temp://1789819763453`，DOM 里渲染成
  `:temp://...`（多一个 `:` 前缀），默认示例任务则是数字 id。当时先记成 ℹ️ 观察项，随后追到底并修掉了 ——
  见下一节。

### 顺藤摸出的产品缺陷：临时 id 落库 + 优先级外框静默消失

那条「新增任务 id 是 `temp://…`」的观察项，追下去不是脚本怪癖，而是**两个真实缺陷**：

| # | 现象 | 真因 | 修法 |
| --- | --- | --- | --- |
| ① | 新增任务的 id 被持久化成 `temp://1789821459269` | `api.exec('add-task', { task })` 没给 id，SVAR 补一个临时 id，`api.serialize()` 原样交回 → 直接落库 | `lib/gantt.ts` 的 `ganttFromSvar()`（唯一出口）里加 `stabilizeIds()`：非纯数字 id 按出现顺序分配 `max(数字 id)+1、+2…`（跳过占用），并**同步改写 `parent` 与 links 的 `source`/`target`**；纯数字原样保留 |
| ② | 新增的任务条**没有优先级外框**（其它条都有，且存盘重载后依旧没有） | 外框靠「按 id 拼 CSS 选择器」注入，而 SVAR 渲染时给非数字 id 加了 `:` 前缀（`temp://x` → DOM 上是 `:temp://x`）→ 选择器静默失配 | `GanttChart.tsx` 改用 `svarDataIdCandidates(id)`，对非数字 id 同时给出「原样」与「`:` 前缀」两种形态 |

②是实测出来的（一次性探针）：新增那条的 `getComputedStyle(bar).boxShadow === 'none'`，
其余三条都是紫罗兰外框 —— **界面上一眼能看出来，但此前没有任何断言盯它**。

`stabilizeIds` 被刻意写成**纯函数**（同一输入永远同一结果）：同一会话里的多次自动保存会反复调用它，
映射一旦不稳定，同一个任务就会在几次保存之间换 id。

回归新增：

- `cd web && npm run verify:gantt-ids` —— 22 项纯函数断言（归一化 / 幂等 / parent 与 links 同步改写 / 候选形态）；
- `gantt-ui-check.sh` 21 → **24** 项：落库不含 `temp://`、**所有**任务条都有外框、
  重载后 `data-id` 全为纯数字。

> 写这类断言时踩了一个坑：`agent-browser eval` 的返回值是**带转义的 JSON 字符串**（`{\"a\":1}`），
> 直接交给 `python3 -c "json.loads(...)"` 会解析失败、断言莫名变红。已改成让 JS 返回 `总数|缺项;缺项`
> 这种不含引号的裸串，并记进 `tools/verify/README.md` 的「已知坑」第 6 条。

### 顺带的收获：清理扫描揪出三处「验证依赖还在 tmp」的残留

准备清理 `/home/macro/.workbuddy/tmp`（**6.9 GB / 506 项**）时发现：套件仍依赖那个「会被清理的目录」
里的文件 —— `e2e-dashboard` 用的 `seed-demo.py` **从未入库**、`e2e-folder-dir` 调的是 tmp 里的
**旧副本** `gen-upload-js.py`、`embed-prod-check` 硬编码 `$TMP/vendor/lr/...` 的 DWG 转换器
（转换器不在时那条断言会报**假红**）。三处都已收回仓库 / 参数化（缺转换器时明确 skip）。

验证方式是把 tmp 里的副本**真的挪走**再跑：`embed-prod-check` / `e2e-dashboard` / `e2e-folder-dir`
→ **17 / 40 / 49 全绿**；再把 `tmp/vendor/lr` 临时改名 → `embed-prod-check` **16 通过 0 失败**
（skip 生效，套件仍 `ALL_SUITES_PASS`）。

清理清单（分档 + 可直接粘的命令 + 回滚说明）：`/home/macro/.workbuddy/tmp-cleanup-plan-2026-09-19.md`。
清单里 `haiku-wiki`、`vendor/lr/`、`gotmp`、`xdg`、`agent-browser-chrome-*`、`regress` 六项是
工具链依赖，不能删。

**清理已执行（全程只 `mv`，未删除任何文件）**：**500 项 / 6.1 GB** 进入 `tmp/_trash-20260919/`，
`tmp` 自身由 **6.9 GB → 822 MB**（剩下的主要是 `vendor/lr` 553 MB + `haiku-wiki` 101 MB）；
搬完后复跑 **12 套 ✅=274 ❌=0 `ALL_SUITES_PASS`**，并单独复验了 `embed-prod-check`（17/17，
覆盖 `vendor/lr` 里的 DWG 转换器与一次完整 `go build`）与 `gantt-api-check`（21/21，覆盖 `gotmp`）。

**最后一步已执行**：删前先做了一次「不可再生内容」体检 —— 体检对象的 500 项里，`find` 只命中各套件
运行时产生的临时库（`e2e-folder-*/data/haiku.db`、`imp-data-*/haiku.db`、`gantt-*-data/haiku.db` …）、
测试上传件，以及从 `node_modules` 解包出来的 SVAR 源码副本（`svar-src/`、`svar-store-src/`）——
**全部可再生**，无 `.go` / `.ts` / `.key` / `.pem` / `.env` 命中，仓库夹具种子库
`tools/verify/fixtures/e2e-data/haiku.db` 不在其中。确认后 `rm -rf _trash-20260919 _trash-stale-scripts`
执行完毕，`tmp` 收敛到 **34 项 / 909 MB**（余下即「必须保留的 6 项」+ 最近一次回归新产生的产物 + 待你确认的
两项 cloud-naotu 产物）；`/home` 分区使用率 47%。

---

## 七、遗留事项

- **`git push` 未执行**：本机没有任何 GitHub 凭据，需要你自己推。
- **本机没有 Docker**：`Dockerfile` 未真实构建，只能陈述 `go build` 与 embed 产物的实测数字。
- `/home/macro/.workbuddy/tmp` 的清理**已全部完成**：500 项 / 6.1 GB 先 `mv` 进 `_trash-20260919/`
  （搬完 12 套回归全绿），体检确认无可再生之外的内容后已删除，tmp 自身 **6.9 GB → 909 MB**。
  余下的 909 MB 是「必须保留的 6 项」（`vendor/lr`、`haiku-wiki`、`gotmp`、`xdg`、
  `agent-browser-chrome-*`、`regress`）+ 最近一次回归新产生的日志/截图/`dist-backup` + 下面两项待定。
  清单：`/home/macro/.workbuddy/tmp-cleanup-plan-2026-09-19.md`。
  另外 `naotu-verify`、`mindmap-server`（都属于 cloud-naotu 那个仓库）按清单第四档**没有动**。
  **回归套件与夹具已不在其中**（已入库 `tools/`），清理时不必担心弄丢验证手段；唯一要记住的是
  那六项工具链依赖（见上一节末）。
- **「目录」当前刻意不支持**：跨库挂载、拖拽移动、目录级分享/权限继承。
  如果后续要做「目录权限继承」，`services/book_service.go` 的可读性判定需要按祖先链向上回溯，
  这是唯一一处会牵动权限模型的地方。
- ~~新增任务的 id 不是稳定数字~~ —— **本轮已修**（`ganttFromSvar` 落库前归一化 + 外框候选形态，
  见第六节）。存量文档里若还留着历史的 `temp://` id，打开后改一次并保存即会被归一化过去，
  不影响打开与渲染。
