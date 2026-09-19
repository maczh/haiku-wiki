# 寄海文库（haiku-wiki）

高仿语雀 UI 的**企业知识库系统**：书架式知识库 + 多级目录树 + 多类型文档（文档/表格/思维导图/流程图/绘图/附件）+ 全文搜索 + 公开分享 + 多格式服务端导出 + Docker 一键部署。

```
monorepo
├── server/          Go 后端（Gin + GORM，SQLite 默认 / MySQL 可配）
├── web/             前端（Vite + React 18 + TypeScript + Ant Design 5 + Vditor + dnd-kit）
├── Dockerfile       多阶段构建（前端构建 → Go embed → 单容器）
└── docker-compose.yml
```

## 快速启动（本地开发）

依赖：Go 1.22+、Node 18+

```bash
# 1. 启动后端（默认 SQLite，数据落在 ./data/）
cd server
go run ./cmd/server            # 监听 :8080

# 2. 启动前端 dev server（/api、/uploads 自动代理到 8080）
cd web
npm install
npm run dev                    # 打开 http://localhost:5173
```

首次注册的账号自动成为**管理员**（role=admin）。

> `npm install` 后的首次 `npm run dev` / `npm run build` 会先执行两个资源同步脚本：
>
> - `scripts/copy-vditor-assets.mjs`：把 Vditor 运行期所需的静态资源（lute 解析器、highlight.js、
>   KaTeX、图标、语言包）同步到 `web/public/vditor/dist`。原因是 Vditor 默认从 `https://unpkg.com`
>   拉取这些资源，**离线或内网环境下 Markdown 正文会渲染为空白且控制台无报错**。
> - `scripts/copy-drawio-assets.mjs`：把 draw.io 绘图组件同步到 `web/public/drawio`。
>   原始资源来自 `web/vendor/drawio`（由 `npm run fetch:drawio` 按白名单从官方发行版拉取，约 44MB）。
>   两者缺失时构建**不会失败**，只会让「绘图」文档类型提示组件未部署。
>
> 详见下方「前端静态资源自托管」。

### 生产模式单进程运行

```bash
cd web && npm run build        # 产出 web/dist（会自动带入 public/vditor）
cp -r web/dist server/internal/static/dist   # 覆盖占位目录
cd server && go build -o haiku-wiki ./cmd/server
DATA_DIR=./data ./haiku-wiki   # 前端由 Go 直接托管（embed），访问 http://localhost:8080
```

### 前端静态资源自托管

系统**不依赖任何外部 CDN**，全部前端资源随二进制分发，可在完全离线的内网运行：

| 资源 | 来源 | 说明 |
| --- | --- | --- |
| Vditor（编辑器 / 预览） | `web/scripts/copy-vditor-assets.mjs` → `web/public/vditor/dist` | 组件内统一设置 `cdn: '/vditor'` |
| draw.io（绘图组件） | `web/scripts/fetch-drawio-assets.mjs` → `web/vendor/drawio` → `web/public/drawio` | iframe 嵌入 `embed=1&proto=json`，入口 `/drawio/index.html` |
| KaTeX（思维导图公式插件） | `import 'katex/dist/katex.min.css'` | 由 Vite 打包并重写字体路径 |
| pdf.js worker | pdfjs-dist `?url` 导入 | 由 Vite 作为静态资源输出 |
| Mermaid / SheetJS / simple-mind-map / pptx-preview | npm 依赖 | 由 Vite 打包 |

自托管资源仅包含项目启用能力的子集（Vditor 约 7.5 MB、draw.io 约 44 MB），未启用的重型渲染器
（mathjax / mermaid / echarts / markmap / graphviz 等）不参与构建。

draw.io 组件按**白名单**裁剪：官方发行版完整静态目录约 154 MB，其中 41 MB 的 `stencils/`
形状定义已被 `js/stencils.min.js` 内联（204 个形状库随组件一起打包），因此无需下载；
`shapes/`（通用形状）、`plugins/`、`styles/`、`images/`、`img/`、`mxgraph/`、`stencils/clipart/`
与中英文语言包则必须保留。白名单定义与版本号在 `web/scripts/fetch-drawio-assets.mjs`
（默认 `DRAWIO_REF=v31.4.6`）中，可用 `DRAWIO_GH_API` / `DRAWIO_CDN` 指向内网镜像：

```bash
npm run fetch:drawio                       # 首次拉取
DRAWIO_REF=v31.4.6 npm run fetch:drawio -- --force   # 强制重拉
```

## Docker Compose 部署（推荐）

```bash
cp .env.example .env           # 修改 JWT_SECRET 等
docker compose up -d --build   # 一条命令起完整系统
# 访问 http://<服务器IP>:8080
```

- 数据卷 `haiku-data` 持久化 SQLite 文件与上传附件（`/app/data`）。
- 镜像为四阶段构建：libredwg（DWG → DXF 转换器）→ Node 构建前端 → Go 静态编译（免 CGO）→ Alpine 单容器运行。
- 构建期若拉不到 `ftp.gnu.org`，可用 `--build-arg LIBREDWG_URL=<内网镜像>` 换源；
  libredwg 构建失败不会阻断镜像，只是 `.dwg` 退化为内嵌预览位图。

## MySQL 切换

默认使用 SQLite（WAL 模式，免 CGO，零配置）。切换 MySQL：

```bash
DB_DRIVER=mysql
DB_DSN=user:password@tcp(127.0.0.1:3306)/haiku?charset=utf8mb4&parseTime=True&loc=Local
```

表结构由 GORM AutoMigrate 自动创建，SQLite/MySQL 无需手工建库差异处理（MySQL 需先 `CREATE DATABASE haiku`）。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `8080` | HTTP 监听端口 |
| `DB_DRIVER` | `sqlite` | `sqlite` / `mysql` |
| `DB_DSN` | `DATA_DIR/haiku.db` | 连接串（mysql 必填） |
| `JWT_SECRET` | 开发默认值 | JWT 签名密钥，**生产必须修改** |
| `DATA_DIR` | `./data` | 数据目录（SQLite + uploads/） |
| `GIN_MODE` | `debug` | `debug` / `release` |
| `EXPORT_FONT_PATH` | 自动探测 | 中文字体文件路径（`.ttf` / `.ttc`），PDF 与 PNG 导出用；不可用时会告警并自动改用其他候选 |
| `EXPORT_DWG_CONVERTER` | 自动探测 | DWG → DXF 转换器可执行文件路径（见下方「DWG 矢量预览」） |

### 导出所需的中文字体

`.pdf` 与 `.png` 导出需要在服务器上找到一份覆盖中文的字体。解析顺序：

1. 环境变量 `EXPORT_FONT_PATH` 指定的字体文件；
2. 常见系统字体路径（Linux `wqy-microhei` / `wqy-zenhei` / `arphic`，macOS `Arial Unicode` / `PingFang` / `Songti`，Windows `msyh`）；
3. 字体目录扫描兜底（`.ttf` / `.ttc`，自动识别是否含中文字形）。

`.ttc`（TrueType Collection）会自动提取首个字体重建为独立 `.ttf` 供 PDF 嵌入。安装示例：

```bash
# Debian/Ubuntu
apt-get install -y fonts-wqy-microhei
# Alpine（Dockerfile 已内置；注意该包在 community 仓，未在 main 仓）
apk add --no-cache font-wqy-zenhei
```

> **每个候选都必须通过「最终渲染器」复验才会被采用**：只有含中文字形还不够，还要能真正被
> PDF 渲染器（gopdf）加载，否则换下一个候选。原因是 freetype 与 gopdf 对 cmap 的容忍度不同，
> 出现过「字体有中文却被选中、导出时全线报 No Unicode encoding found」的情况（曾长期被误判为
> 「环境缺中文字体」）。参见代码注释里的跨平台实测矩阵：macOS `STHeiti Light.ttc`、
> `Hiragino Sans GB.ttc`、Linux `NotoSansCJK*.ttc` 都不可用；macOS `Arial Unicode.ttf`
> / `Songti.ttc`、Linux `wqy-microhei` / `wqy-zenhei` 可用。
>
> 因此**不建议改用 `font-noto-cjk`**：其 TTC 内部是 CFF 轮廓，当前管线（freetype truetype +
> TTC 抽首字体）无法消费，换过去反而彻底无字体可用。

若想显式指定，指定字体后重启即可：

```bash
EXPORT_FONT_PATH=/usr/share/fonts/truetype/wqy/wqy-microhei.ttc ./haiku-wiki
```

> `EXPORT_FONT_PATH` 指向的字体若**读不到**、或**读得到但渲染器加载不了**，程序都会打印警告
> 并回退到自动探测，不会让所有导出功能一起失效。

### DWG 矢量预览所需的转换器

`.dwg` 是 AutoCAD 的专有二进制格式，纯 Go 无法解析。导入 `.dwg` 后服务端保存原文件，并
按两级策略生成 `.svg` + `.png` 预览：

1. **矢量还原（推荐）**：调用外部转换器把 DWG 转成 DXF，再交给内置的 DXF 渲染器
   （支持 LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / ELLIPSE / SPLINE / TEXT / MTEXT /
   INSERT 块展开 / 凸度圆弧 / ACI 与真彩色 / 图层）。自动探测 `dwg2dxf`、`dwgread`
   （libredwg）与 `ODAFileConverter`，也可用 `EXPORT_DWG_CONVERTER` 显式指定。
2. **内嵌预览图降级**：转换器不可用时，从 DWG 头部抽取 AutoCAD 写入的预览位图（PNG/BMP）
   直接当预览图。分辨率低、不含矢量信息，导入结果会标记为「降级预览」并在界面上说明。

部署 libredwg（Alpine 镜像已在 Dockerfile 阶段 0 自动构建，无需手工操作）：

```bash
# Debian/Ubuntu：源码编译（libredwg 未收录进主流发行版仓库）
curl -fsSLO https://ftp.gnu.org/gnu/libredwg/libredwg-0.14.tar.gz
tar -xzf libredwg-0.14.tar.gz && cd libredwg-0.14
./configure --disable-bindings --disable-python --disable-shared --enable-static --disable-docs
make -j"$(nproc)" -C src && make -j"$(nproc)" -C programs dwg2dxf dwgread
sudo install -m755 programs/dwg2dxf programs/dwgread /usr/local/bin/

# 或指定任意自编译/第三方的转换器
EXPORT_DWG_CONVERTER=/opt/libredwg/programs/dwg2dxf ./haiku-wiki
```

启动日志会打印 `DWG 转换能力：...`；也可用 `GET /api/cad/converter` 查询当前状态：

```json
{ "code": 0, "data": { "available": true, "detail": "已启用 dwg2dxf（/usr/local/bin/dwg2dxf）" } }
```

`.dxf` 无需任何外部工具，内置渲染器直接解析。

### 真实 DWG 端到端测试

仓库不含真实图纸夹具，集成测试默认跳过；指向一份 DWG 目录（例如 libredwg 自带的
`test/test-data`，覆盖 R1.4 ~ 2018 各代格式）即可跑通「转换器 → DXF → 矢量 SVG/PNG」全链路：

```bash
cd server
DWG_FIXTURE_DIR=/path/to/libredwg/test/test-data \
EXPORT_DWG_CONVERTER=/path/to/dwg2dxf \
go test ./internal/service/exportx -run TestConvertDWGRealFixtures -v
```

### 回归基线

后端全量测试必须在**默认环境**（不设置 `EXPORT_FONT_PATH` 等任何绕过开关）下全绿：

```bash
cd server && go test ./... -count=1 -p 1
```

- **`-p 1` 不可省**：各包测试共用同一份 SQLite 测试库的连接习惯，并发跑会相互踩库。
- **当前基线：155 PASS / 0 FAIL / 2 SKIP**。两条 SKIP 是设计如此、非缺陷：
  `TestConvertDWGRealFixtures`（缺真实图纸夹具，见上一节）与 `TestGenerateSamples`（生成样例用）。

**判定规则（重要）**：

- `internal/service::TestDocExportAllFormats` **不再以「环境缺中文字体」豁免**。该豁免历史上掩盖了
  一个真实缺陷：字体筛选用 freetype、消费用 gopdf，两者容忍度不同，导致本机明明有可用中文字体，
  PDF/PNG 导出却全线失败。现已改为「gopdf 复验」筛选（见上一节），该用例在正常环境下必须通过。
- 因此：**任何一条 `--- FAIL` 都视为真实缺陷**，不要先去找环境借口，请先确认是不是 «用 A 校验、
  用 B 消费» 这类语义漂移，或权限在中间件与 service 两层不一致（历史上出过同类问题）。

前端自检脚本同样计入回归：

```bash
cd web && npm run build          # tsc --noEmit + vite build
npm run verify:import            # HTML 导入清洗（20 项断言，直接转译产品源码）
npm run verify:drawio            # draw.io 静态资源体检（16 项）
npm run verify:sheet             # 表格存储契约 + 导出扩展名映射（42 项）
npm run verify:dashboard         # 首页纯逻辑 + 目录下拉 {value,label} 契约
npm run verify:gantt-ids         # 甘特临时 id 归一化（temp:// → 数字，含 parent/links 同步改写，22 项）
```

这几个脚本用 esbuild 现场把产品源码（`src/lib/import/htmlClean.ts`、`src/lib/sheet.ts`、
`src/lib/dashboard.ts`、`src/lib/dirOptions.ts`、`src/lib/gantt.ts` 等）转译成 ESM 后 import 再断言，
**改了产品逻辑这里会立刻失败**，不是复刻品，可放心作为回归依据。

### 浏览器端到端套件（`tools/verify/`）

上面两节是「不启浏览器」的回归。真正操作界面、并用 API 回查落库结果的套件在 **`tools/verify/`**
（14 套 + `run-all.sh`，含端口表、数据夹具与已知坑说明）：

```bash
bash tools/build/build-embed.sh                    # 必须先跑：产出生产形态二进制 $TMPDIR/haiku-wiki
bash tools/verify/run-all.sh                       # 全套，逐套 ✅/❌ 汇总（实测约 23 分钟）
SUITES="e2e-folder-dir ui-doc-types" bash tools/verify/run-all.sh   # 只跑子集
```

覆盖：embed 完整性与 SPA 兜底、新建/导入的存放位置、首页 Dashboard、导入导出双通道、
文档类型读写、甘特图（折叠丢行 / 边界态 / API / 界面冒烟）、按需加载与路由占位、Dockerfile 两个阶段模拟。
**改了前端不重跑 `build-embed.sh`，套件测的就是旧产物** —— 这是最容易自欺的一点。

## 功能清单

- **认证**：邮箱注册/登录（JWT 7 天，localStorage `hk_token`），首个用户自动 admin，同 IP 60s 注册限频
- **知识库**：书架卡片页、封面色、可见性三档（私有/成员可见/公开），公开库自动生成分享短链
- **文档树**：多级目录、dnd-kit 拖拽排序/移动（fractional indexing，O(1) 写放大）、右键菜单、软删回收站
- **编辑器**：Vditor IR 模式（Markdown+富文本混合）、表格（x-data-spreadsheet）、思维导图（simple-mind-map，浮动工具条仿官方 Demo）、流程图（Mermaid）、绘图（内嵌 draw.io）、图片/附件上传（白名单 + 64MB）、3s 防抖自动保存
- **版本快照**：内容变化自动快照 + 手动快照 + 回滚快照，保留最近 20 版可回滚
- **阅读页**：Vditor preview 渲染 + DOMPurify 防 XSS、代码高亮、左侧文档库可折叠/拖拽调宽、右侧大纲浮动层（可折叠、不随正文滚动）
- **导入**：`.md` / `.txt` / `.html` / `.pptx` / `.xlsx` / `.docx` / `.pdf` / `.dwg` / `.dxf` / `.drawio` / `.vsd` / `.vsdx` 等
  - `.docx` / `.doc` / `.pdf`：**按原文件保存为「附件」文档**，正文不可编辑，阅读界面直接预览（PDF 用 pdf.js 分页渲染、Word 用 mammoth 转 HTML），并提供原文件下载
  - `.xlsx` / `.xls` / `.csv` / `.et`：转为「表格」文档；多工作表时以文件名建父「表格」，**每个有内容的工作表**作为其下「表格」子文档
  - `.pptx`：**按原文件保存为「附件」文档**，前端用 pptx-preview 纯前端渲染，支持逐页浏览、自动播放（3/5/10 秒间隔）、全屏与键盘翻页，并可下载原文件
  - `.dwg` / `.dxf`：按原文件保存，服务端自动转出 `.svg`（矢量，优先展示）+ `.png`；预览支持滚轮缩放（以光标为锚点）、按住拖动平移、双击复位、`+/-/0/方向键` 快捷键，可导出原图 / SVG / PNG
  - `.drawio` / `.vsd` / `.vsdx`：转为**「绘图」文档**，阅读时用内嵌 draw.io 只读预览，编辑时进入完整 draw.io 编辑器（形状库、素材库、导入导出、历史快照齐全）
- **搜索**：标题+正文 LIKE，按权限过滤（公开库支持匿名搜索），结果关键词高亮 + 上下文片段
- **导出**（全部在服务端转换，前端仅保存返回的二进制流）：
  | 文档类型 | 可选格式 |
  |----------|----------|
  | 文档（markdown） | `.md` / `.docx` / `.pdf` |
  | 表格（sheet） | `.xlsx` / `.csv` / `.json` |
  | 思维导图（mindmap） | `.km`（百度脑图） / `.smm`（Simple Mind Map） / `.xmind` / `.mm`（FreeMind） / `.png` |
  | 流程图（flowchart） | `.md`（含 ```mermaid 源码） / `.svg` / `.png` |
  | 绘图（drawing） | `.drawio`；`.svg` / `.png` 在编辑器内导出。（`.vsdx` **只能导入不能导出**：vsdx 导出是 draw.io Atlassian 版专属能力——`vsdxExportEnabled()` 要求服务名为 `atlassian`，开源版恒为 `draw.io`，且导出类 `VsdxExport` 未随开源包发布） |
  | CAD 附件（dwg/dxf） | 原图 + 全部派生格式（`.dwg` / `.dxf` / `.svg` / `.png`） |
  | 附件（file） | 原文件原样下载 |
  | 知识库整体 | `.md.zip`（按目录结构，附件按原文件打包，绘图导出为 `.drawio`） |
- **回收站**（P1）：恢复 / 彻底删除（含快照）
- **部署**（T10）：多阶段 Dockerfile + compose + 数据卷（内置中文字体）

## 权限模型

| 可见性 | 读 | 写 |
|--------|----|----|
| `private` 私有 | 仅 owner | 仅 owner |
| `members` 成员可见 | 所有注册用户 | owner + 所有登录用户 |
| `public` 公开 | 任何人（含匿名，凭分享链接） | 仅 owner |

管理操作（改名/删除/改可见性）仅 owner。

## API 约定

统一前缀 `/api`，响应 `{"code":0,"message":"ok","data":...}`；错误码：`40001` 参数 / `40101` 未登录 / `40301` 无权限 / `40401` 不存在 / `40901` 冲突 / `41301` 文件超限 / `41501` 类型不允许 / `42901` 请求过于频繁 / `50000` 内部错误。

完整接口清单见 `docs/02-architecture.md` §三。
