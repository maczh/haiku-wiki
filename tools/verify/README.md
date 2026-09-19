# tools/verify —— 回归套件

这些是**浏览器/接口端到端套件**，跑在「单源生产形态」上：
`vite build` → 拷进 Go embed 目录 → `go build` → 起单端口服务 → agent-browser 操作真实界面
→ 用 API 回查断言落库结果。之所以不用 Vite dev server：dev server 由自己的静态中间件服务，
**静态资源兜底、embed 完整性一类的问题在它上面根本不复现**。

> 这些脚本原先散在 `/home/macro/.workbuddy/tmp/` 下，而该目录会被清理 —— 套件会随之消失，
> 所以收进仓库。改动套件后请同步更新下面的清单。

## 前置条件

```bash
# 1) 生产形态二进制（套件默认读 $TMPDIR/haiku-wiki，即 /home/macro/.workbuddy/tmp/haiku-wiki）
bash tools/build/build-embed.sh          # 前端构建 → 刷新 embed → go build

# 2) agent-browser + Chrome（脚本内已设好这些环境变量）
#    AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
#    AGENT_BROWSER_ARGS=...--no-proxy-server...
# 3) 本机 http_proxy 会劫持 localhost → 脚本内 curl 一律带 --noproxy '*'
```

**改了前端代码必须先重跑 `build-embed.sh`**，否则套件测的还是旧产物 —— 这是最容易自欺的地方。

## 跑法

```bash
bash tools/verify/e2e-folder-dir.sh                       # 单跑一套
bash tools/verify/run-all.sh                              # 全套，逐套汇总 ✅/❌
SUITES="e2e-folder-dir ui-doc-types" bash tools/verify/run-all.sh   # 只跑指定几套
```

`run-all.sh` 会先探测每套的端口：**被占用就跳过并标注原因**（见「已知坑」第 5 条），
再逐套打印实际 ✅/❌ 并给总账；任一套失败则退出码非 0 并打印 `ALL_SUITES_FAIL`。
全套跑一次约 **23 分钟**（2026-09-19 实测 23m04s，14 套 ✅=272 ❌=0 `ALL_SUITES_PASS`），
其中 `sim-docker-web` 单独要 ~11–14 分钟（它跑一次完整 `npm build`）。

可覆盖的环境变量：

| 变量 | 作用 |
| --- | --- |
| `E2E_DATA` | 指定数据目录（默认：从 `fixtures/e2e-data` 复制一份临时副本，服务端只写副本） |
| `HAIKU_BIN` | 指定后端二进制（`e2e-import` / `e2e_export` 支持；其余读 `$TMPDIR/haiku-wiki`） |
| `PORT` | 换端口（`e2e-import` 默认 18081、`e2e_export` 默认 18080、`gantt-*` 同理）——**端口被幽灵实例占用时用它重跑** |
| `TMPDIR` | 输出（日志、截图）与二进制的落点，默认 `/home/macro/.workbuddy/tmp` |
| `OUT` | `run-all.sh` 的汇总日志与各套 stdout |
| `SUITES` | `run-all.sh` 的子集 |

**必须顺序执行**：多套共用 `XDG_RUNTIME_DIR` 与同一个 Chrome profile，并行会互相干扰
（表现为随机 `no-btn` / 页面串台）；其中 4 套还共用端口 8080。

## 套件清单（2026-09-19 基线）

| 脚本 | 项数 | 端口 | 覆盖 |
| --- | --- | --- | --- |
| `embed-prod-check.sh` | 17 | 8099 | embed 完整性、drawio 目录未被 SPA 兜底吞掉、大资源非 HTML 兜底、CAD 转换器可用 |
| `e2e-folder-dir.sh` | 49 | 8181 | 新建目录三入口、目录占位页、**目录下拉显示名称而非数字**、**落库 parent_id 精确值**、导入落在所选子目录、目录不进最近更新、删除级联 |
| `e2e-dashboard.sh` | 40 | 8150 | 视频/封面真的随包分发（Content-Type + 字节数 + MP4 `ftyp`）、播放器解出真实时长、向导与视频可关闭且持久、快捷操作链路 |
| `e2e-import.sh` | 10 | 18081 | xlsx 多工作表拆父子、空表跳过、docx/pdf 存为附件并可预览、表格 v3 契约 |
| `e2e_export.sh` | — | 18080 | 导出双通道：服务端逐格式响应头/字节校验 |
| `e2e-workbench-dnd.sh` | 30 | 8195 | 首页工作台三卡与搜索、目录树右键移动/复制弹窗（跨库+多级+防环）、拖拽落点（中部=子文档，落库断言） |
| `e2e-book-dashboard.sh` | 25 | 8196 | **文库工作台**（书页空态）：概览/快捷操作、`book_id` 限定的三卡与搜索（API+界面）、逾期口径（今天到期≠逾期）、最近更新、无裸 0 |
| `ui-doc-types.sh` | 18 | 8080 | markdown / sheet / mindmap / flowchart / file 的读写渲染 |
| `gantt-fold-check.sh` | 30 | 8112 | 甘特折叠右时间轴后左表格**不得丢行**、只读态拦截 |
| `gantt-fold-edge-check.sh` | 22 | 8131 | 折叠的边界态（相对不变量、滚动、折叠态气泡） |
| `gantt-api-check.sh` | — | 8098 | `doc_type=gantt` 未被静默降级、正文回读、导出 md/xlsx |
| `gantt-ui-check.sh` | 24 | 8097 | 甘特界面冒烟：编辑态增删任务（弹窗表单）、阅读态仅可拖进度、数据落库、按需加载、**临时 id 已归一化 + 优先级外框齐全** |
| `check-lazy-routes.sh` | 14 | 8080 | 按需加载的**实证**：`/login` 不下载知识库页 chunk |
| `check-route-fallback.sh` | 14 | 8080 | 有/无布局壳的路由在 `LazyBoundary fill` 下都正常落位、不卡占位 |
| `ui-shot.sh` | 截图 | 8080 | 各页面截图留证 |
| `sim-docker-web.sh` | — | — | 无 docker 时逐字复现 `Dockerfile` 的 web-builder 阶段（证明 prebuild 能在干净上下文生成 Vditor 资源）。**要跑一次完整 `npm build`，约 11 分钟** |

`run-all.sh` 会打印每套的实际 ✅/❌，上表项数是 2026-09-19 那次全绿的基线。

### 曾经的坑：`gantt-ui-check.sh` 修活记录（2026-09-19）

它一度整体失效（11 ✓ / 9 ✗），排查后确认是**脚本与产品交互漂移**、不是产品缺陷，现已修好（21/21）：

1. 「新建文档」入口已改到知识库节点的「⋯」菜单，且节点在「私人知识库」分组下 → **先 `expandNode`** 再点；
2. 编辑态「新增任务 / 新增子任务」现在走**弹窗表单**（填「任务名称」→ 页脚「新增」）；
3. 「读正文拿回空响应」其实是**新建文档 content 本来就是空串**（默认 3 条任务在前端），
   旧脚本硬解 JSON 于是刷了一屏 traceback 把真正原因盖住了。

顺带修掉两个**断言陷阱**（细节见技能 §3.3.5）：

- **汇总条也有进度手柄**：`type=summary` 的条上同样有 `.wx-progress-marker`，但它的进度由子任务派生，
  拖了不会变 → 拖拽断言必须选**叶子任务**（旧脚本拖到了 id=1 的汇总条才误报「进度未变化」）；
- **「没找到任务条」会让断言恒真通过**：横向改期那条原本写成「起始日没变 → 通过」，
  而找不到条时起始日当然没变 → 必须把「找到条」当前置条件判失败；
- 另外发现：界面**新增的任务**落库 id 形如 `temp://1789819763453`，DOM 里渲染成 `:temp://...`（多一个 `:` 前缀），
  而默认示例任务是数字 id → 断言锚点一律挑**数字 id** 的叶子。

### 临时 id 与优先级外框（2026-09-19 已修，套件盯着它）

上面那条 `temp://` 不是「脚本要绕开的怪现象」，而是**产品缺陷**，已经在 `lib/gantt.ts` 的
`ganttFromSvar()` 里统一归一化（非纯数字 id → `max(数字 id)+1、+2…`，并同步改写 `parent` 与
links 的 `source/target`）。同一根因还让**新增任务的优先级外框整个消失**（外框靠按 id 拼的
CSS 注入，而 DOM 上非数字 id 多一个 `:` 前缀 → 选择器静默失配）。

本套件因此多了三条端到端断言（也是 21 → 24 的来源）：

- 落库正文**不含** `temp://`；
- **所有**任务条的优先级外框都在（`getComputedStyle(bar).boxShadow !== 'none'`，含刚新增的那条）；
- 重载后 `data-id` **全为纯数字**（不再出现 `:` 前缀）。

纯函数侧另有 `cd web && npm run verify:gantt-ids`（22 项：归一化 / 幂等 / 引用改写 / 候选形态）。

> 写断言时注意：`agent-browser eval` 的返回值本身是**带转义的 JSON 字符串**（`{\"a\":1}`），
> 直接丢给 `python3 -c "json.loads(...)"` 会解析失败。要么先反转义，要么让 JS 返回
> `a|b;c` 这种**不含引号**的裸串（外框那条就是这么写的）。

## 夹具（`fixtures/`）

- `fixtures/e2e-data/`：**种子数据快照**（`haiku.db` + `uploads/`）。
  `ui-doc-types` / `ui-shot` / `check-lazy-routes` / `check-route-fallback` 依赖它：
  book 1 固定是 `1=markdown 2=sheet 3=mindmap 4=flowchart 5=file`。
  套件每次运行都会把夹具**复制成临时副本**再交给服务端写，所以夹具本身始终保持原样。
  更新夹具：从一次跑出来的数据目录里取 `haiku.db`（先 `PRAGMA wal_checkpoint(TRUNCATE)` 把 WAL 落盘）
  与 `uploads/`，替换本目录内容。
- `fixtures/import-fixtures/`：导入用的真实 `.xlsx`（含空工作表）/ `.docx` / `.pdf`，
  以及重生成它们的 `gen.cjs`。
- `fixtures/exports/doc.pdf`：导出套件用的上传样例。
- `gen-upload-js.py`：把上述夹具内嵌成一段页面内注入的 JS（见下面「已知坑」第 1 条）。
  夹具目录可用 `UPLOAD_FIX` 覆盖，产物 JS 路径用 `UPLOAD_JS_OUT`（默认 `$TMPDIR/imp-upload.js`）。
- `seed-demo.py`：`e2e-dashboard.sh` 的数据播种脚本（全部走公开 API，不直接写库），
  只读 `BASE` / `OUT` 两个环境变量、无硬编码路径；产出 `ids.json` 供后续定位页面。

## 已知坑（写新断言前先看这几条）

1. **`agent-browser upload` 在本机静默失效**：命令打印 `✓ Done`，但 `input.files.length` 仍是 0。
   替代方案是 `gen-upload-js.py` 生成的注入脚本：页面内用真实 `File` + `DataTransfer` 设置
   `input.files` 再派发 `change`，走的是应用真实的 `onChange → parseFile` 链路。
2. **AntD 的 5 类「脚本假失败」**（产品其实是对的）：
   `Button` 的 `autoInsertSpace` 会在**恰好两个汉字**间插空格（`创建`→`创 建`）→ 比对前归一化空白；
   `Modal` + `destroyOnClose` 步骤切换期间**两个 Modal 同时在 DOM** → 按 `.ant-modal-title` 定位；
   裸 `input` 会先命中 `Select` 内部的 search input → 用 `.ant-input`；
   React 受控输入要走原生 value setter + `input` 事件；
   AntD Tree 只渲染**已展开**层级 → 断言深层节点前逐级 `expandNode`（批量点会因重渲染失联）。
3. 关闭下拉/菜单用 `agent-browser press Escape`（命令是 `press`，不是 `key`）。
4. **agent-browser 的 ref 与页面状态不跨 Bash 调用保留**（下一次调用页会变 `about:blank`）
   → 所有浏览器步骤必须封进同一个脚本。
5. 端口被「幽灵实例」占用时，`ps` 看不到那些进程（在别的 PID 命名空间）。
   **症状极具误导性**：套件自己的服务起不来（`server.log` 里 `bind: address already in use`），
   于是它连上**别人的**服务、在别人的库里注册用户 → 报「注册失败」，很容易被误读成产品缺陷
   （2026-09-19 全套回归里 `e2e-import` 就是这么「假失败」的）。
   现在 `e2e-import` / `e2e_export` / `gantt-*` 都带**端口预检 + `PORT` 覆盖**：占用时直接报错并提示换端口重跑；
   其余套件若表现异常，先 `curl --noproxy '*' -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<端口>/`
   确认是 `000`（空闲）。本会话自己起的服务可以用任务管理回收，别的会话留下的只能换端口。
6. **`q()` 拿回的 JSON 是带转义的**：`agent-browser eval` 输出后再被 `sed` 剥掉首尾引号，
   字符串内部仍是 `{\"a\":1}` —— 直接 `python3 -c "json.loads(...)"` 必然解析失败
   （症状是断言结果变成兜底值、莫名其妙地红）。要么先反转义，要么让 JS 返回
   `总数|缺项;缺项` 这类**不含引号**的裸串。这条是 2026-09-19 给外框断言踩出来的。
7. **别把验证依赖留在 `$TMPDIR`**：那个目录是要清理的，清理后套件会静默跑旧逻辑或直接挂。
   2026-09-19 扫描时揪出三处残留：`seed-demo.py` 压根没入库、`e2e-folder-dir` 调的是 tmp 里的
   **旧** `gen-upload-js.py`、`embed-prod-check` 硬编码 `$TMP/vendor/lr/...` 的 DWG 转换器（找不到就假红）。
   规则：**脚本与夹具一律进本目录**（用 `HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)` 定位），
   只有**可变的运行产物**（日志/截图/临时库/生成的注入 JS）才留在 `$TMPDIR`；
   外部工具路径必须参数化，且**缺失时要明确 skip 而不是判失败**。

### ⚠️ `$TMPDIR` 里哪些东西不能删

清理 `/home/macro/.workbuddy/tmp`（动辄数 GB）之前先看这张表 —— 下面几项是**工具链依赖**：

| 路径 | 用途 |
| --- | --- |
| `tmp/haiku-wiki` | `build-embed.sh` 的产出；**所有**套件启动的就是它 |
| `tmp/vendor/lr/` | `embed-prod-check.sh` 的 DWG 转换器（`EXPORT_DWG_CONVERTER` 默认指向它；缺失时该断言 skip） |
| `tmp/gotmp` | `gantt-api-check.sh` 的 `TMPDIR` |
| `tmp/xdg` | agent-browser 的 `XDG_RUNTIME_DIR` |
| `tmp/agent-browser-chrome-*` | Chrome profile |
| `tmp/regress` | `run-all.sh` 的日志（`run-all.log` + 逐套 `.out`） |

其余（`dist-backup*`、`dockersim-web-*`、`e2e-*`、`*-out-*`、`shots-*`、旧 `gocache`/`npmcache`、
一次性排查脚本 `gantt-diag*.sh` / `gantt-*-probe*.sh` / `capture-video-shots*.sh` 等）都是
**可再生产物**，可以清。

## 非浏览器套件：`cad-render-probe.sh`

上面那一堆是浏览器/接口 e2e，**必须**跑在生产形态上。CAD 预览的字号问题不属于这一类 ——
它出在纯渲染链路（DXF → 图元 → SVG/PNG），起服务反而看不出来，所以单独有一套：

```bash
bash tools/verify/cad-render-probe.sh
```

无端口、无浏览器、不需要 `build-embed.sh`。它先跑 `cad_text_qa_test.go` 的断言，
再把两套**按真实尺度构造**的 DXF 渲成 SVG/PNG 落盘，打印 `font-size` 区间：

| 夹具 | 图幅 | 要点 | 期望 |
| --- | --- | --- | --- |
| `site` | 400m×240m | 36 个区域标注仅 250mm；含 `\P` 分段的多行说明 | font-size `0.97~9.31px`；说明必须是 5 行且互不重叠 |
| `metric` | 40m×30m | 字高由 STYLE 固定为 0.5m（实体不写组码 40） | font-size 恒为 `19.20px`（= 0.5 × 38.4），**不是 96px** |

**为什么必须有这一层**：字号是**世界单位**，脱离图幅就没有意义，所以「数值对不对」必须靠
单元测试断言比例不变量，而「看起来对不对」只能落成图看。历史上两类文件都出过事：

1. 米制图幅 + 样式固定字高 —— 旧实现拿写死的 `2.5` 世界单位兜底，等于 2.5m 高的字（`metric` 期望 19.2px，实得 96px）；
2. 大图幅 + 小标注 —— SVG 侧把 `<6px` 一律抬到 `6px`，实得值是真实值的 6 倍多，密排标注叠成一团黑。

`site` 的标注按设计就只有 0.97px（和 AutoCAD 缩放到全图的观感一致）——
**不要**为了「看得清」去加大它：SVG 是矢量的，放大 60 倍仍然清晰，而抬升下限会让它
失去与图元的真实比例，那正是用户报的 bug。

## 新增套件

1. 放进本目录，沿用「自起服务 + `trap cleanup EXIT` + ✅/❌ 计数」的结构；
2. 挑一个**独占端口**（避免和 8080 那几套撞），并在上面清单里登记；
3. 把脚本名加进 `run-all.sh` 的 `DEFAULT_SUITES`；
4. 依赖的数据走 `fixtures/` + 临时副本，**不要**直接引用 `/home/macro/.workbuddy/tmp/` 下的既有目录
   （那个目录会被清理）。
