# 寄海文库（haiku-wiki）本轮改造 · 完成报告

日期：2026-09-17　范围：Go 后端 + Vite/React 前端
（另见文末「七、第三轮：DWG / PPTX / 绘图三项新增功能」，2026-09-18 完成）

## 一、7 项需求的落地情况

| # | 需求 | 状态 | 实现要点 |
| --- | --- | --- | --- |
| 1 | 导出按类型提供格式，全部后端转换、前端只下载 | ✅ | 自研导出引擎 `exportx`；14 种格式；`GET /api/export/docs/:id?format=` + `/formats`（格式清单为单一事实来源） |
| 2 | docx / pdf 按原文件保存、不可编辑、可阅读 | ✅ | 新增附件型文档 `doc_type=file`；正文禁改（40001）；`FileView` 用 pdf.js / mammoth 只读预览 |
| 3 | xlsx 转表格，每个有内容 sheet 成为其下一个表格子文档 | ✅ | 导入时按工作表拆分，「父文档 + N 个子表格」 |
| 4 | 阅读页右侧大纲改浮动层、可折叠、不随正文滚动 | ✅ | 浮动卡片（`position:absolute`，top/right 16px），关闭后收起为入口按钮 |
| 5 | 左侧文档库可折叠、可调宽 | ✅ | 折叠 + 拖拽调宽（180–480），两者均持久化到 localStorage |
| 6 | 品牌改「寄海文库」+ 寄海 LOGO + favicon | ✅ | 内联 SVG 组件 + `logo.svg`/`favicon.png`/`apple-touch-icon.png`，全站文案替换 |
| 7 | 思维导图仿 Simple Mind Map Demo 三处浮动工具条 | ✅ | 顶部左 14 按钮 + 右上保存区 + 右侧竖排 6 入口 + 右下缩放条 |

## 二、验证结果

### 后端
- `go build ./...` 通过，`gofmt -l` 干净，`go vet` 无输出
- `go test ./internal/...` 全绿（handler / router / service / exportx / fracidx）
- 导出端到端 15/15：14 种格式 HTTP 200 且 `file -b` 识别正确（Word 2007+ / PDF 1.7 / Excel 2007+ /
  CSV with BOM / JSON / XMind zip / XML / PNG / SVG）；非法格式 400、未登录 401、
  目录穿越 404、附件正文改写 40001、知识库 zip 内附件为原字节

### 前端界面（单源生产形态：embed 进 Go 二进制，仅 8080）
连续两轮结果一致，控制台零错误，**本地以外请求数为 0**：

| 检查项 | 结果 |
| --- | --- |
| 品牌 | title「寄海文库」、无「海库」残留、favicon 生效、LOGO svg 存在 |
| 大纲浮动层 | 出现，3 条（导出测试 / 列表 / 表格），`absolute top=16 right=16` |
| 正文渲染 | `.doc-content` 414 字符（此前为 0） |
| 收起大纲 | 点击生效，浮层消失并收起为入口按钮 |
| 收起左栏 | aside 移除，展开按钮出现 |
| 思维导图 | 顶部左 14 按钮 / 右上工具条 / 右侧 6 入口 / 右下缩放条（`absolute bottom=12 right=12`，100%）/ 5 个节点 |
| 附件 PDF | pdf.js 分页渲染，信息条与「下载原文件」到位，「编辑」按钮 disabled |

### 导入链路（真实文件端到端，10/10 通过）

用真实夹具走浏览器导入对话框：多工作表 xlsx（其中一个是空白表）、后端导出的 docx、真实 PDF。

| 检查项 | 结果 |
| --- | --- |
| 多工作表父文档 | 「多工作表」→ `sheet` |
| 每个有内容工作表 → 子「表格」 | 「产品」「区域」均为 `sheet` 且 `parent_id` 指向父文档 |
| **空白工作表** | 未生成任何文档（子文档数恰为 2） |
| 子表格内容契约 | `{"version":1,"cells":{"0-0":{"text":"产品"},...}}` |
| docx / pdf | 导入为 `file` 附件类型，只读（编辑按钮 disabled） |
| docx 预览 | 标题、列表、带边框表格、引用均正确渲染 |
| 页面错误 | 无 |

### 构建阶段（无 docker daemon，按 Dockerfile 逐字复现）
按 `.dockerignore` 复现 `COPY web/ ./`（剔除 `node_modules`/`dist`/`public/vditor`）后执行
`npm run build`：`prebuild` 钩子从零生成 356 个 Vditor 资源文件，`dist` 产出 17 MB
且 `vditor/dist/js/{lute,highlight.js,katex,icons,i18n}` 全部就位 → `DOCKER_WEB_STAGE_OK`。

## 三、本轮修掉的 4 个真实缺陷

界面「看起来对、实际不工作」类问题，全部由浏览器实测发现（构建/类型检查均通过）：

1. **大纲浮动层永不出现（死锁）** — `TocAnchor` 是 `tocCount` 的唯一上报者，却挂在以
   `tocCount > 0` 为渲染条件的浮层内部。修：在 `onRendered` 中先行统计标题数。

2. **思维导图编辑页整页白屏** — 为承载大纲浮层新增的 `paddingRight` 包装层是 auto 高度，
   打断了 `height: 100%` 链，画布容器塌陷为 0 → `new MindMap()` 抛错 →
   **effect 内异常导致 React 卸载整棵树**。修：包装层补 `height: '100%'`；并为画布初始化加
   「下一帧重试 + 可恢复降级态」，不再一错就白屏。

3. **阅读页正文完全空白（最严重）** — Vditor 默认从 `unpkg.com` 拉 `lute.min.js`，
   失败后 `after` 回调不触发，且**控制台零报错**。修：把 vditor 资源子集自托管到
   `web/public/vditor/dist`（构建期自动同步，约 7.5 MB），组件统一 `cdn: '/vditor'`。
   系统现已**无任何外部 CDN 依赖**，可在完全离线的内网运行。

4. 两个 Go 测试文件未格式化 → 已 `gofmt -w`。

> 另有 2 处是**测试脚本自身**的问题（`agent-browser upload` 静默失效、接口字段路径写错），
> 已修正脚本并记入技能库，不是产品缺陷。

## 四、新增的工程约束（已写入 README 与项目记忆）

- `npm run dev` / `npm run build` 会先执行 `scripts/copy-vditor-assets.mjs` 同步 Vditor 资源；
  若新增依赖 Vditor 的能力，需确认对应资源已纳入自托管子集。
- `.gitignore` 新增 `web/public/vditor/`、`server/internal/static/dist/*`（保留 `.gitkeep`）；
  `.dockerignore` 同步排除，避免构建上下文膨胀。
- `Dockerfile` 注释品牌更新为「寄海文库」。

## 五、前端按需分包（首屏体积降到 17%）

### 5.1 三层拆分

原先 Vditor、simple-mind-map（含 katex）、x-data-spreadsheet、pdf.js、mermaid、SheetJS
全部打包进首屏。分三层拆完：

| 层 | 做法 |
| --- | --- |
| ① 库级 | `React.lazy` + 新增 `components/common/LazyBoundary`，在 `DocContent`（阅读）/`BookPage`（编辑）/`SharePage`（公开预览）按需加载渲染器与编辑器 |
| ② 路由级 | `App.tsx` 内 9 个页面全部 `lazy()` + `<LazyBoundary fill>`；布局保持静态，外壳先出现 |
| ③ 堵漏网 | 修掉两条「组件已 lazy、但它静态引入重量级兄弟」的链路 |

第 ③ 层是本轮最有价值的发现——靠浏览器实测抓出来，读代码很难注意到：

- `VditorEditor` → `VersionDrawer` →（静态）`MarkdownView`
  → **4 个编辑器全都会下载整个 Vditor**（≈304 KB JS + 40 KB CSS），哪怕文档类型不是 markdown、
  哪怕从不打开版本历史。已改为在 `VersionDrawer` 内懒加载。
- `BookPage` → `DocTree` →（静态）`ImportDialog` → `lib/import/parse.ts` → SheetJS/turndown/jszip
  → **打开任意知识库就下载 ≈400 KB 导入解析代码**，哪怕从不导入。
  已改为懒加载，并只在导入对话框打开时才挂载（该组件自带 `destroyOnClose`，
  且所有 effect 均以 `open` 为条件，延迟挂载不改变行为）。

### 5.2 实测体积

| | 最初 | 第 ① 层后 | 第 ②③ 层后 |
| --- | --- | --- | --- |
| 入口 chunk | 3819 KB（gzip 1125 KB） | 1727 KB（gzip 573 KB） | **649 KB（gzip 213 KB）** |
| 入口 CSS | 43 KB | 43 KB | **3.0 KB** |
| `BookPage` chunk | — | 623 KB | **216 KB** |

- 入口 chunk 累计 **-83%**。`index.html` 只预加载入口 JS + 入口 CSS 两个文件。
- 入口 chunk 内 `vditor`/`smm-container`/`x-spreadsheet`/`mermaid`/`pdfjs`/`sheet_to_json` 出现次数均为 **0**。
- Vditor 的 CSS 从 `main.tsx` 移入 `MarkdownView` / `VditorEditor`，随组件懒加载；入口 CSS 已不含 `vditor`。

### 5.3 按需加载的实证（不只是体积数字）

新增 `check-lazy-routes.sh`（14 项）：逐页对比浏览器**实际下载**的 chunk。

| 访问 | 下载 | 未下载 |
| --- | --- | --- |
| `/login` | 入口 + `LoginPage` | `BookshelfPage`/`BookPage`/`SettingsPage`/`TrashPage`/`MindmapEditor` |
| `/` | + `BookshelfPage` | `BookPage`、`MindmapEditor`、`ImportDialog` |
| `/books/1?docId=3&tab=edit` | + `BookPage` + `MindmapEditor` | `MindmapView`（阅读器）、`ImportDialog` |

另有 `check-route-fallback.sh`（14 项）覆盖占位与落位：`/login`、`/register` 正常渲染且未卡在加载态，
AppLayout 内 4 个路由 `main` 高度均为 844px（未塌陷），未知路由正确重定向到 `/login`。

### 5.4 回归结果

改完后**全部**套件重跑，无一失败：

| 套件 | 结果 |
| --- | --- |
| `ui-doc-types.sh`（5 类型阅读 + 4 编辑器） | 18/18，控制台 error 数 0 |
| `ui-shot.sh`（截图 + DOM + 外部依赖） | 全通过，非本地请求 0 |
| `e2e-import.sh` | 10/10（重点：`ImportDialog` 改按需挂载后导入链路仍完好） |
| `e2e_export.sh` | 15/15 |
| `check-lazy-routes.sh` | 14/14 |
| `check-route-fallback.sh` | 14/14 |
| `sim-docker-web.sh` | `DOCKER_WEB_STAGE_OK` |
| Go：`build` / `gofmt -l` / `vet` / `test ./internal/...` | 全部通过 |

## 六、后续可选项（未做，供参考）

- 入口 chunk 仍有 649 KB，主体是 react + react-dom + antd + 路由。继续压缩的性价比已经很低：
  需要动 antd 的按需引入策略（目前已是 ESM tree-shaking）或换更轻的组件库，属于架构级改动。
- 可给路由 chunk 加 hover 预取（`<link rel="prefetch">`）来消除首次进入页面时的短暂占位，
  属于体验优化，不影响体积。
- 附件预览目前限 PDF 120 页，docx 走 mammoth 转 HTML（复杂排版会有损失）。
- SheetJS 社区版对超大 xlsx 有性能上限，导入侧已限制 500 行 × 50 列。


---

# 七、第三轮：DWG / PPTX / 绘图三项新增功能

日期：2026-09-18　范围：Go 后端 + Vite/React 前端

## 7.1 需求与落地

| # | 需求 | 状态 | 实现要点 |
| --- | --- | --- | --- |
| 1 | 导入 `.dwg`：后端存原件并自动转 `.svg`/`.png`；前端可缩放、上下左右拖动；可导出 `.dwg`/`.svg`/`.png` | ✅ | 新增 `attachment_service`/`attachment_handler`：`POST /api/attachments/prepare` 落派生文件、`GET /api/cad/converter` 报能力；`exportx` 新增 CAD 引擎（自研 DXF 解析 → SVG + GG PNG）；前端 `CadView` 支持滚轮以光标为锚点缩放、按住拖动、`1:1`/适应窗口/键盘 `+`/`0`，导出三条直链 |
| 2 | 导入 `.pptx`：保存源文件、前端预览 + 播放、提供原文件下载 | ✅ | `pptx-preview@1.0.7`（懒加载独立 chunk）；`PptxView` 提供翻页、自动播放（间隔可选）、原文件下载 |
| 3 | 新增绘图文档类型：内嵌完整 draw.io；可导入 `.drawio`/`.vsd`/`.vsdx` 与素材（形状库）；可导出 `.drawio`/`.vsdx` | ✅ | 新增 `doc_type=drawing`；`DrawioEditor`/`DrawioView` 以 iframe 内嵌**自托管** draw.io（2384 文件 / 44MB 白名单子集）；支持导入绘图文件、Visio（`data:application/vnd.visio;base64`）、调起原生「形状」素材库、导出 `.drawio`/`.svg`/`.png`、官方 save 事件回写并生成版本快照 |

> 关于 `.vsdx` **导出**：需求原文要求「导出成 .drawio/.vsdx」，经查实**这是组件能力缺失，不是实现取舍**——
> 自托管 draw.io 里 `EditorUi.prototype.vsdxExportEnabled(){ return "atlassian" == getServiceName() }`，
> 而 `getServiceName()` 恒返回 `"draw.io"`，故菜单项 `exportVsdx` 永不加入；
> 且 `VsdxExport` 类**未随包发布**（只在 `app.min.js` 里被调用，全包无定义；
> `extensions.min.js` 里只有 `mxgraph.io.vsdx.*` 导入解析器）。
> 即 vsdx 导出是 Atlassian 版专属。前端与 README 均如实标注 `.vsdx` 仅支持导入，
> `.drawio`/`.svg`/`.png` 导出正常；如需 vsdx 导出只能服务端自研 mxGraphModel → VSDX 写出器。
>
> 界面文案已按该事实改写（原先写的「官方未定义导出协议」不准确），并在生产形态下复核：
> 编辑器说明条显示「`.vsdx` 导出是 draw.io 企业版（Atlassian）专属能力，开源版未随包提供导出实现，
> 故菜单中无此项」，导出菜单仍为 3 项，`/drawio/` 静态路径回归正常。

**DWG 两级策略**：① 外部转换器（`dwg2dxf`/`dwgread`/`ODAFileConverter`）转 DXF 后由自研渲染器出**矢量** SVG+PNG；
② 兜底抽取 DWG 内嵌预览位图并标 `Degraded`。`Dockerfile` 扩为四阶段（阶段 0 编译 libredwg，
**失败不阻断镜像**，运行期如实报降级）。

## 7.2 验证结果

### 后端
- `go build ./...` 干净、`gofmt -l` 空、`go vet` 无输出、`go test ./...` 全绿（handler/router/service/exportx/fracidx）。
- **真实 DWG 端到端**：libredwg 自带夹具 **15 个（R1.4 → 2018）** 全部走矢量还原，
  产物经 `file` 识别为 `SVG Scalable Vector Graphics image` / `PNG image data`。
  集成测试默认 skip，`DWG_FIXTURE_DIR` + `EXPORT_DWG_CONVERTER` 驱动。

### 前端生产形态（embed 进 Go 二进制，单端口 :8099）
资源与接口自检 **17/17**：drawio 入口/目录/大资源（`app.min.js` 9.7MB、`stencils.min.js` 7.7MB）返回真实内容而非 HTML 兜底、
chunk 可达且不含旧探测逻辑、vditor 资源、`/api/cad/converter available=true`、SPA 兜底正常。

浏览器实测三功能全通过：

| 功能 | 实测结果 |
| --- | --- |
| 绘图（阅读） | 导入 `.drawio` 建为绘图文档；阅读态 iframe `title=draw.io`、22 个 SVG、`hasMxgraph=true`、**`isSPA=false`**（证明加载的是 draw.io 组件本身，不是 SPA 兜底页） |
| 绘图（编辑 + 保存） | 编辑态 iframe `…&saveAndExit=1`、26 个图形；双击画布标签改文本 → blur → 点 draw.io 内部「保存」→ 提示「已自动保存」→ 后端正文 2031B → 2017B 且含新文本、**版本快照 0 → 1** |
| CAD | `DWG 图纸 · 568.9 KB · 矢量预览`，派生 SVG 已加载（549×427）；缩放 36% → 41%（按钮）→ 47%（滚轮，`translate` 同步变化证明以光标为锚点）；拖动 ±160/90 时 `scale` 不变、`translate` 精确跟手；导出 `.dwg`/`.png`/`.svg` 三条直链 |
| PPTX | 1/5 → 2/5 翻页内容正确；3s 自动播放推进至 5/5 后停止；下载链接 `download="新功能验收.pptx"` |
| Visio | `.vsdx` 保留原文件，阅读页由组件转换预览（58 个图形、`isSPA=false`）；「另存为绘图文档」新建 `drawing` 文档（**20103 字节真实 mxGraphModel**）；「素材库」调起 draw.io 原生「形状」对话框（标准/通用/基本/流程图/软件/Atlassian/Bootstrap/C4/实体关系/Salesforce… 全量内置库）；导出 `.drawio`/`.svg`/`.png` 三种均产生真实 blob 下载 |

## 7.3 本轮修掉的 5 个真实缺陷

0. **无文件头 BMP 的降级预览分支实际不可达（后端）** —— 兜底路径里最要紧的一个。
   `extractEmbeddedPreview` 是靠**搜 `"BM"` 两字节魔数**来定位 BMP 的，而「只存 `BITMAPINFOHEADER`、
   没有 `BM` 文件头」这种形态里没有该魔数 → `decodeHeaderlessBMP()` **永远走不到**，
   凡是这种图纸一律被判成「文件内不含预览图」，把本来有救的文件判死。
   而这条兜底恰恰是「目标机没装 `dwg2dxf`/`dwgread`/`ODAFileConverter`」时的唯一希望。
   修：新增按 `BITMAPINFOHEADER` 字段合法性的受控扫描（`biSize ∈ {40,108,124}`、`planes == 1`、
   合法 bpp、`compression <= 3`、宽高 8–20000），且必须整体解码成功才采用，以避免把正文数据误判成位图。
   新增 `internal/service/exportx/cad_degraded_test.go`（5 个用例）以**合成 DWG** 锁住整条降级链路：
   内嵌 PNG / 无文件头 BMP / 服务层契约 / 无转换器且无预览图时的诚实报错 / 假魔数不被误判。
   > 之所以此前一直没被发现：libredwg 自带的 141 个测试夹具都是工具转出来的、**不含内嵌缩略图**，
   > 只能覆盖矢量路径；降级路径**必须靠合成夹具**才测得到。

1. **`/drawio/` 目录被 SPA 兜底吞掉（后端，生产形态致命）**
   静态托管用 `fs.Stat` 判断资源是否存在，而 `fs.ValidPath` 不接受尾随斜杠 ——
   `fs.Stat(fsys,"drawio/")` 返回 `invalid argument` 而非「不存在」，于是目录型请求被判为非静态资源、
   回退成应用自身的 `index.html`。表现：**embed 形态下内嵌 draw.io 的 iframe 拿到的是寄海文库的 HTML，绘图功能整个失效**。
   修：抽出 `router.staticProbePath()`（目录请求补 `index.html`），新增 3 个单测锁住不变量。
2. **draw.io 资源探测误判（前端）** — `drawioAssetsReady()` 用 `Range: bytes=0-64` 探测，
   而入口页前 65 字节是 `<!DOCTYPE html><html><head><title>Flowchart Maker…`，指纹落在窗口外 →
   在严格实现 Range 的服务器上被误判「组件未部署」。修：整取后校验前 4KB，并扩充指纹正则。
3. **容器字体路径错误 + 字体探测硬失败（后端）** — `EXPORT_FONT_PATH` 指向 apk 并不安装的
   `wqy-microhei` 路径，且显式字体不可用时直接报错，会让镜像内所有 PDF/PNG 导出全线失败。
   修：补 Alpine 真实路径（`/usr/share/fonts/wqy-zenhei/`），并降级为告警 + 回退自动探测。
4. **降级结果被前端标成「矢量预览」（前端，界面与实际不符）** —— 降级链路的 SVG 只是把内嵌位图
   包进 `<image>` 再套一层 SVG 外壳，**并不是真矢量**；但 `CadView` 里判据写作 `isVector = !!svgUrl`，
   于是降级文件的信息条会打出「矢量预览」（与实际不符），并且因为被当作矢量，
   放大超过 3 倍时也不会切 `image-rendering: pixelated` —— 低分辨率位图会被插值糊掉。
   修：`isVector = !!svgUrl && !ref.degraded`，信息条改为三态
   （`降级预览（内嵌位图）` / `矢量预览` / `位图预览`），放大插值策略随之修正。

**降级路径端到端实测**（无转换器 + 合成 DWG，`:8098` 实例）：
接口返回 `degraded=true`、`derived=['png','svg']`、`note` 为「使用 DWG 内嵌预览图（低分辨率位图）…」；
派生文件 200（`image/png` 2726B / `image/svg+xml` 3835B，`file` 识别为 `PNG image data, 64 x 64`
与 `SVG Scalable Vector Graphics image`）；界面显示「`DWG 图纸 · 3.0 KB · 降级预览（内嵌位图）`」
+ 完整降级提示，**未再误标矢量**，缩放 667% → 767% 仍然可用。

## 7.4 新增的工程约束

- draw.io 资源自托管：`web/vendor/drawio` → `web/public/drawio`，两者进 `.gitignore`；
  `.dockerignore` 只排 `public/drawio`（`vendor/drawio` 必须留在构建上下文）。
- 导入上限 20MB → 64MB；导入清单新增 `.pptx`/`.dwg`/`.dxf`/`.drawio`/`.vsd`/`.vsdx`。
- **改了静态资源或内嵌组件后，必须再跑一次生产形态自检**（`embed-prod-check.sh`）——
  本轮有几个缺陷只在 embed 形态暴露，Vite dev server 永远不复现。
- 本机 Go 有**两份**（托管 1.23.4 / 系统 1.25.7），项目 `go.mod` 要求 `go 1.22`，两者都可用；
  真正会坑的是**工具调用的 shell 里 `HOME` 可能为空**——此时 `go` 报
  `module cache not found: neither GOMODCACHE nor GOPATH is set` **且退出码为 0**，
  `go build ./...` 会「静默什么都不做」却看着像成功。必须显式 export `HOME` + `GOPATH`/`GOMODCACHE`/`GOCACHE`。
- 判断后台服务是否存活要用 `curl` 探活：本沙箱的 `ps` 看不到这些进程（`ps aux | grep haiku-wiki` 为空，端口却在监听）。
  但**本会话自己用后台任务起的服务可以用 `TaskStop` 回收**（实测有效，本轮已回收 8098 / 8099 两实例并释放端口）。

## 7.5 既有回归套件重跑（新增三项功能后）

本轮改动触及静态托管、`DocTree` 导入清单、`FileView` 懒加载边界，因此把上一轮的 7 套套件全部重跑，**无一失败**：

| 套件 | 结果 |
| --- | --- |
| `ui-doc-types.sh`（5 种文档类型阅读 + 4 种编辑器） | **18/18**，控制台 error 0 |
| `ui-shot.sh`（品牌 / 大纲浮层 / 左栏 / 思维导图 / 附件 PDF） | 全通过：标题「寄海文库」、旧品牌残留 false、大纲 3 条 `absolute top=16 right=16`、正文 414 字符、思维导图 14 按钮 / 6 入口 / 缩放条 / 5 节点、PDF canvas 1 + 编辑按钮 disabled、**非本地请求 0**、控制台错误为空 |
| `check-lazy-routes.sh` | **14/14**（按需加载仍然按需） |
| `check-route-fallback.sh` | **14/14** |
| `e2e_export.sh` | **15/15** |
| `e2e-import.sh` | **10/10** |
| `sim-docker-web.sh` | `DOCKER_WEB_STAGE_OK`（dist 62M，vditor 资源齐全） |

> 这些套件是自包含的（自己起服务 + `trap` 清理），但硬编码 `8080`；而本机存在遗留服务占用该端口
> （`ps` / `/proc/*/cmdline` 都看不到它们，在另一个 PID 命名空间，端口却仍在监听）。
> 解法是生成**换端口副本**（18080 / 18086 / 18090–18093）顺序执行，
> 脚本在 `/home/macro/.workbuddy/tmp/regress/`（`run-all.sh` 一把跑完并汇总）。
>
> 更正一处此前说法：**本会话自己用后台任务起的服务是可以回收的** —— `TaskStop` 实测有效
> （已成功回收 8080 的 `go run` 与 8099 实例）；只有来自其它会话的进程才真正回收不了。

> 改完 `.vsdx` 文案重新构建后，又跑了一遍 6 套 UI/接口套件（`run-post-rebuild.sh`），**同样全绿**：
> ui-doc-types 18/18、ui-shot 全通过、check-lazy-routes 14/14、check-route-fallback 14/14、
> e2e_export 15/15、e2e-import 10/10。

> **第三次重跑**（改完 `CadView` 降级标签 + 抽取器修复后，`run-after-cadfix.sh`）**仍然全绿**：
> ui-doc-types 18/18、ui-shot 全通过、check-lazy-routes 14/14、check-route-fallback 14/14、
> e2e_export 15/15、e2e-import 10/10 → `ALL_SUITES_DONE`。
> 即：本轮三次重跑（功能完成后 / 文案重建后 / CadView 改动后）均为零回归。

> ✅ **遗留清理项已处理（用户批准后执行）**：每次「前端重建 → 刷新 embed」都会把 62MB 旧产物 `mv` 进
> `/home/macro/.workbuddy/tmp/dist-backup/`，本轮结束时 `~/.workbuddy/tmp` 累计到 **3.4GB**。
> 已删除 `dist-backup` / `stale-dist-*` / `dockersim-web-*` / `npm-probe` / `npm-cache` / `ab-tmp`，
> **3.4GB → 1.1GB（释放约 2.3GB）**；`vendor/`（含 libredwg 与 `dwg2dxf`，DWG 转换必需）、
> 最终二进制与复用脚本/夹具均保留。

## 7.6 仓库卫生与镜像上下文（收尾审计）

这轮引入了 60MB+ 的生成产物，因此专门核对了「它们不会被误提交、也不会拖累镜像构建」：

| 检查项 | 结果 |
| --- | --- |
| `web/dist`、`web/public/drawio`、`web/vendor/drawio`、`web/node_modules` | ✅ 均已正确忽略（`git check-ignore` 复核） |
| `server/internal/static/dist` | ✅ `.gitignore` 用 `.../dist/*` + `!.../.gitkeep` 忽略内容、保留占位，行为正确 |
| untracked 列表里有无大产物 | ✅ 无（只有新增源码 `web/src/lib/drawio.ts` 等应当被跟踪的文件） |
| `.dockerignore` 方向 | ✅ 排 `web/public/drawio`、**保留** `web/vendor/drawio`（镜像内复用，省掉构建时联网拉 2384 个文件） |

**一处改进**：`.dockerignore` 补上 `server/internal/static/dist`。它是 `web/dist` 的拷贝，
镜像内本就会由 `COPY --from=web-builder /app/web/dist ./internal/static/dist` 覆盖，
留在上下文里纯属每次构建多传 62MB，且会让构建结果受本地残留状态影响。

**该改动已实证（本机无 docker，改为本地逐行复刻镜像阶段）**：
`tar --exclude=internal/static/dist`（≈ `COPY server/ ./`）→ `cp web/dist`（≈ `COPY --from=web-builder`）→
`CGO_ENABLED=0 go build`。结果：拷贝后 embed 目录确实不存在、编译成功（71,491,768 字节）、
二进制起服后 `/drawio/` 返回 **200 / 2759 字节的真实 drawio 页面**（不是 ~620 字节的 SPA 兜底页），
`app.min.js` 9,683,028B、`stencils.min.js` 7,688,864B、`lute.min.js` 3,739,251B、SPA 兜底 200。

> 为什么必须验证这一类改动：`//go:embed all:dist`（`server/internal/static/static.go`）
> **要求 `dist` 目录在编译时就存在**，所以 `Dockerfile` 里
> `COPY server/`(44) → `COPY --from=web-builder`(46) → `go build`(47) 的顺序不能动；
> 加了 ignore 之后若顺序被破坏，镜像会在 `no matching files found` 上直接失败。
> 验证目录用完已删，`tmp` 回到 1.1GB。
