# 寄海文库（haiku-wiki）

面向企业内部的**一体化知识库与文档协作平台**：以「知识库 → 目录树 → 文档」三级结构组织内容，
把文档、表格、思维导图、流程图、绘图、白板、待办、日历、甘特图、接口文档、图片库、需求原型
等十余种内容形态，连同 Word / Excel / PDF / PPT / CAD 图纸的在线预览，收进同一套账号、权限、搜索与导出体系。

前后端一体化交付：Go 后端用 `embed` 直接托管前端产物，**单个二进制 + 一个数据目录**即可运行，
全站无任何外部 CDN 依赖，可在完全离线的内网部署。另提供**独立的 H5 手机版**（自动识别手机访问，
支持全部类型的只读阅读与原地分享）与**微信扫码登录**。

```
haiku-wiki/
├── server/                  Go 后端（Gin + GORM；SQLite 默认 / MySQL 可选）
│   ├── cmd/server/          程序入口
│   ├── cmd/cadprobe/        CAD 渲染离线排查工具
│   └── internal/
│       ├── config/          配置加载（yml + 环境变量）
│       ├── model/           GORM 模型
│       ├── repository/      数据访问（含搜索、最近更新、回收站、内置模板）
│       ├── service/         业务逻辑（+ exportx 导出子系统、imgconv 图片归一化）
│       ├── handler/         HTTP 处理
│       ├── middleware/      JWT / 权限 / CORS / 限流
│       ├── router/          路由注册 + SPA 兜底
│       └── static/dist/     前端构建产物（embed）
├── web/                     前端（Vite 5 + React 18 + TypeScript + Ant Design 5）
│   ├── src/pages/           桌面页面
│   ├── src/h5/              H5 手机版（独立 /m 路由树）
│   ├── src/components/      编辑器 / 阅读器 / 目录树 / 工作台 / 弹窗等
│   ├── src/lib/             各文档类型的内容契约与纯逻辑
│   ├── scripts/             资源自托管与前端自检脚本
│   └── vendor/drawio/       draw.io 发行版资源（白名单拉取）
├── conf/application.yml     主配置文件
├── docs/                    功能指南与用户手册（含手册截图）
├── tools/                   构建与回归脚本（tools/build、tools/verify）
├── Dockerfile               四阶段构建 → Alpine 单容器
└── docker-compose.yml
```

---

## 一、快速开始

### 1.1 本地开发

依赖 **Go 1.25+** 与 **Node 18+**（前端未声明硬性 engines 下限，建议 18+）。

```bash
# 后端（默认 SQLite，数据落在 ./data/）
cd server && go run ./cmd/server        # 监听 :8080

# 前端 dev server（/api、/uploads 自动代理到 8080）
cd web && npm install && npm run dev    # 打开 http://localhost:5173
```

`npm install` 后的首次 `npm run dev` / `npm run build` 会先执行两个资源同步脚本
（`predev` / `prebuild` 钩子）：

| 脚本 | 作用 | 缺失后果 |
| --- | --- | --- |
| `scripts/copy-vditor-assets.mjs` | 把 Vditor 运行期资源（lute 解析器、highlight.js、KaTeX、图标、语言包）同步到 `web/public/vditor/dist`，约 7.5 MB | **离线 / 内网下 Markdown 正文渲染为空白，且控制台无任何报错** |
| `scripts/copy-drawio-assets.mjs` | 把 draw.io 组件从 `web/vendor/drawio` 同步到 `web/public/drawio`，约 44 MB | 「绘图」文档提示组件未部署 |
| `scripts/copy-excalidraw-assets.mjs` | 把 Excalidraw 字体 / 语言包同步到 `web/public/excalidraw`，约数 MB | 「白板」文档画布无法渲染 |

三者缺失**不会让构建失败**，详见「§6 前端静态资源自托管」。

> 首次拉取 draw.io 资源用 `npm run fetch:drawio`（按白名单从官方发行版下载，默认 `DRAWREF=v31.4.6`），
> 可用 `DRAWIO_GH_API` / `DRAWIO_CDN` 指向内网镜像；`--force` 强制重拉。

### 1.2 生产模式（单进程）

```bash
cd web && npm run build                      # 产出 web/dist
cp -r web/dist/. server/internal/static/dist/   # 覆盖 embed 占位目录
cd ../server && go build -o haiku-wiki ./cmd/server
DATA_DIR=./data ./haiku-wiki                 # 前端由 Go 托管，访问 http://localhost:8080
```

仓库提供了现成流水线：`bash tools/build/build-embed.sh`
（前端构建 → 刷新 embed 目录 → 编译二进制，全程用 `mv` 让位而非删除）。

### 1.3 Docker Compose 部署（推荐）

```bash
cp .env.example .env             # 至少修改 JWT_SECRET
cp conf/application.yml ./conf/  # 已存在；按需修改数据库 / 存储配置
docker compose up -d --build     # 访问 http://<服务器IP>:8080
```

- 数据卷 `haiku-data` 持久化 SQLite 文件与 `uploads/`（容器内 `/app/data`）；配置卷把 `./conf` 挂到 `/app/conf`。
- 镜像为**四阶段构建**：
  `dwg-builder`（编译 libredwg 的 `dwg2dxf` / `dwgread`）→ `web-builder`（Node 构建前端）
  → `server-builder`（`CGO_ENABLED=0` 静态编译，embed 前端产物）→ `alpine` 运行。
- 构建期若拉不到 `ftp.gnu.org`，可用 `--build-arg LIBREDWG_URL=<内网镜像>` 换源。
  **libredwg 构建失败不阻断镜像**，只是 `.dwg` 退化为内嵌预览位图。
- 运行镜像内置 `font-wqy-zenhei`（PDF/PNG 导出用的中文字体）。
- 健康检查：`GET /api/auth/me`（未登录返回 401 属正常）。

### 1.4 默认管理员

系统内置管理员账号 `admin`（初始密码 `Jihai2026`）。**首次登录后请立即在「账号设置 → 修改密码」中修改**。
新注册账号一律是普通成员（`role=member`），管理员权限只能在「用户管理」中由现有管理员授予。

---

## 二、配置

配置优先级：**环境变量 > `conf/application.yml` > 内置默认值**。
配置文件目录由 `CONF_DIR` 指定，其次 `./conf`，Docker 内为 `/app/conf`；YAML 解析失败**不阻断启动**。

| 配置键 | 环境变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| `server.port` | `PORT` | `8080` | HTTP 监听端口 |
| `server.mode` | `GIN_MODE` | `debug` | `debug` / `release` |
| `jwt.secret` | `JWT_SECRET` | 开发默认值 | JWT 签名密钥，**生产必须修改** |
| `database.driver` | `DB_DRIVER` | `sqlite` | `sqlite` / `mysql` |
| `database.dsn` | `DB_DSN` | sqlite 时 `{data dir}/haiku.db` | 连接串 |
| `database.host/port/user/password/name` | — | `127.0.0.1` / `3306` | MySQL 拆分字段；`dsn` 为空时由程序按 `charset=utf8mb4&parseTime=True&loc=Local` 拼装 |
| `storage.type` | `STORAGE_TYPE` | `local` | `local` / `s3`（未知值回落 `local`） |
| `storage.local.dir` | `DATA_DIR` | `./data` | 数据目录（SQLite 文件 + `uploads/`） |
| `s3.*` | `S3_*` | 空 | Endpoint / Region / Bucket / AccessKey / SecretKey / prefix / `force_path_style` / `public_read` / `presign_ttl`（分钟，0 → 60） |
| `wechat.app_id` / `app_secret` / `redirect_uri` | — | 空 | 微信扫码登录（三者齐全 → `WeChatEnabled=true`；否则走 dev 模式） |
| `upload.max_size_mb` | — | `64` | 单文件上限（≤0 时按 64 处理） |
| — | `EXPORT_FONT_PATH` | 自动探测 | PDF / PNG 导出用的中文字体文件 |
| — | `EXPORT_DWG_CONVERTER` | 自动探测 | DWG → DXF 转换器可执行文件 |

**表结构由 GORM AutoMigrate 自动创建**，SQLite / MySQL 无需手工建表
（MySQL 需先 `CREATE DATABASE`）。历史 `doc_type=datatable` 由启动迁移改写为 `sheet`，
`WeChatBinding` 等新增表随启动迁移补齐。

配置文件可通过管理端「系统配置」页在线修改并触发后端自动重启（约 1~2 秒）；
写回时使用 YAML 节点级改写，**保留你的注释与键顺序**。

### 2.1 SQLite 与 MySQL

默认 SQLite（WAL 模式，免 CGO，零配置）。切换 MySQL：

```bash
DB_DRIVER=mysql
DB_DSN='user:password@tcp(127.0.0.1:3306)/haiku?charset=utf8mb4&parseTime=True&loc=Local'
```

管理端还提供 **SQLite ↔ MySQL**、**本地磁盘 ↔ S3** 的可视化迁移：先连通性测试，再异步复制数据，
完成后可热切换到新库 / 新存储（幂等、带进度查询）。

### 2.2 导出所需的中文字体

`.pdf` 与 `.png` 导出需要在服务器上找到一份覆盖中文且**能被最终渲染器加载**的字体。解析顺序：

1. `EXPORT_FONT_PATH` 指定的字体文件；
2. 常见系统字体路径（Linux `wqy-microhei` / `wqy-zenhei` / arphic，macOS `Arial Unicode` / `PingFang` / `Songti`，Windows `msyh`）；
3. 字体目录扫描兜底（`.ttf` / `.ttc`，自动识别是否含中文字形）。

`.ttc`（TrueType Collection）会自动提取首个字体重建为独立 `.ttf` 供 PDF 嵌入。

> **每个候选都必须通过「最终渲染器」复验才会被采用**：只有含中文字形还不够，还要能被 gopdf 真正加载，
> 否则换下一个候选。原因是 freetype 与 gopdf 对 `cmap` 的容忍度不同，出现过
> 「字体有中文却被选中、导出时全线报 `No Unicode encoding found`」的情况（曾长期被误判为「环境缺中文字体」）。
>
> 因此**不建议改用 `font-noto-cjk`**：其 TTC 内部是 CFF 轮廓，当前管线（freetype truetype + TTC 抽首字体）
> 无法消费，换过去反而彻底无字体可用。

```bash
# Debian/Ubuntu
apt-get install -y fonts-wqy-microhei
# Alpine（Dockerfile 已内置；注意该包在 community 仓）
apk add --no-cache font-wqy-zenhei
```

### 2.3 DWG 矢量预览所需的转换器

`.dwg` 是 AutoCAD 的专有二进制格式，纯 Go 无法解析。导入后服务端保存原文件，并按两级策略生成预览：

1. **矢量还原（推荐）**：调用外部转换器把 DWG 转成 DXF，再交给内置 DXF 渲染器
   （支持 `LINE` / `LWPOLYLINE` / `POLYLINE` / `CIRCLE` / `ARC` / `ELLIPSE` / `SPLINE` /
   `TEXT` / `MTEXT` / `INSERT` 块展开 / 凸度圆弧 / ACI 与真彩色 / 图层）。
   自动探测 `dwg2dxf`、`dwgread`（libredwg）与 `ODAFileConverter`，也可用 `EXPORT_DWG_CONVERTER` 显式指定。
2. **内嵌预览图降级**：转换器不可用时，从 DWG 头部抽取 AutoCAD 写入的预览位图（PNG / BMP，含无文件头 BMP）
   直接当预览图。分辨率低、不含矢量信息，导入结果标记为 `degraded` 并在界面上说明。

```bash
# Debian/Ubuntu：源码编译（libredwg 未收录进主流发行版仓库）
curl -fsSLO https://ftp.gnu.org/gnu/libredwg/libredwg-0.14.tar.gz
tar -xzf libredwg-0.14.tar.gz && cd libredwg-0.14
./configure --disable-bindings --disable-python --disable-shared --enable-static --disable-docs
make -j"$(nproc)" -C src
make -j"$(nproc)" -C programs dwg2dxf dwgread   # 顶层 Makefile 没有这两个目标，必须指定 programs
sudo install -m755 programs/dwg2dxf programs/dwgread /usr/local/bin/
```

启动日志会打印 `DWG 转换能力：...`；也可用 `GET /api/cad/converter` 查询。

`.dxf` 无需任何外部工具，内置渲染器直接解析。

---

## 三、功能全景

| 分类 | 能力 |
| --- | --- |
| **组织** | 书架式知识库、多级目录树（`folder` 容器节点）、拖拽排序与跨库移动、置顶、复制子树、软删回收站 |
| **内容** | 15 种 `doc_type`（见 §5），其中 **12 种可新建**（含白板），每类都有专用编辑器与阅读器 |
| **附件** | Word / PDF / PPT / CAD（DWG/DXF）/ Visio 原文件保存 + 内置预览（pdf.js、mammoth、pptx-preview、自研 DXF 渲染） |
| **图片** | 图片库（相册）与需求原型两套专项文档；`imgconv` 统一产出 原件 + 预览图 + 缩略图 |
| **检索** | 标题 + 正文 LIKE 搜索（按可见性过滤，公开库支持匿名），关键词高亮 + 上下文片段；文库内搜索 |
| **工作台** | 首页与知识库内的待办 / 甘特 / 日历三卡聚合，最近更新，快捷操作 |
| **协作** | 文档级协作者邀请、团队与团队文库（三角色）、公司知识库写授权 |
| **分享** | 知识库公开分享（免登录只读）、文档分享（可选密码 + 有效期）、微信二维码分享、H5 移动端一键分享 |
| **版本** | 内容变化自动快照 + 手动快照 + 回滚快照，保留最近 20 版 |
| **流转** | 12 类格式导入（含网页链接与 HTML 包）、服务端多格式导出、整库打包导出、CAS 秒传 |
| **模板** | 内置 **366** 个场景模板（文档 54 / 表格 38 / 脑图 39 / 甘特 5 / 绘图 45 / 流程图 160 / 白板 25），模板中心一键套用 |
| **手机版** | 独立 H5 路由（自动识别手机 UA），全部类型只读阅读、白板/待办/日历可编辑、原生缩放、移动端导入与分享 |
| **账号** | 账号密码登录、微信扫码登录（桌面 + H5）、自助注册、管理员用户管理 |
| **运维** | 单容器部署、SQLite / MySQL 双选、local / S3 双存储、在线系统配置、用户与文库管理、数据迁移 |
| **离线** | 前端资源全部随二进制分发，运行期零外部请求 |

### 3.1 权限模型

| 可见性 | 读 | 写 |
| --- | --- | --- |
| `private` 私有 | 仅 owner（团队文库成员亦可读） | 仅 owner |
| `members` 成员可见 | 所有注册用户 | owner + 所有登录用户 |
| `public` 公开 | 任何人（含匿名，凭分享链接） | 仅 owner |

补充口径（见 `internal/middleware` 与 `service.canReadBook` / `CanWriteDoc`）：

- **知识库**：改名 / 删除 / 改可见性仅 owner；公司知识库对所有成员**只读**，写权限由管理员单独授权。
- **文档**：除 owner 外，`members` 库的登录用户、团队 `admin` / `read_write` 成员、以及**文档级协作者**均可写。
- **公司知识库「所有人可编辑」**：管理员或库 owner 可对单篇文档开启 `public_edit`，开启后任何登录用户可编辑（用于收集建议 / 意见 / bug）。
- `folder` 目录节点不承载正文，不参与搜索、最近更新、导出与分享。
- **团队文库**（`team_id` 非空）不走上表：团队任意成员按角色（admin / 读写 / 只读）可见可写。

---

## 四、H5 手机版

系统内置一套**独立于桌面的 H5 路由树**（`web/src/h5/`，挂载在 `/m` 下），在不改动桌面版的前提下提供移动端体验。

### 4.1 入口与切换

- **自动识别**：命中手机 UA（iPhone / Android / iPod / 微信内核等）且用户无记忆时，自动进入 H5。
- **强制切换**：桌面页脚与「设置」页均有「切手机版 / 切桌面版」入口；视图模式写入 `localStorage['haiku_view_mode']`，
  优先级高于 UA，下次访问沿用。
- **分享链接同理**：`/share/:slug`（文库级）与 `/doc-share/:slug`（文档级）在手机与桌面各走各的路由，
  无需为手机单独换路径；分享页均**免登录**。

### 4.2 移动端结构

- 底部 Tab 导航：**首页 / 文库 / 搜索 / 我的**；登录 / 注册复用桌面组件（全屏、隐藏 Tab）。
- 文库页右下角 FAB 唤起**导入面板**，可用手机文件选择器（微信内置浏览器里可直接选「微信文件」）导入手机里的资料。
- 文档页按 `getDocMode` 矩阵判定：`whiteboard` / `todo` / `calendar` **可编辑**，其余 **12 类一律只读**；
  `folder` 为容器导航（渲染子项列表）。

### 4.3 阅读体验适配

- **原生缩放**：`file` / `drawing` 两类套 `H5ZoomStage`（以自身为滚动视口，双指缩放、单指拖动、缩放后划屏不失效）；
  `mindmap` 走 simple-mind-map 原生矢量缩放（放大到多少都清晰、无级）。
- **划屏加固**：`html,body` 用 `overflow-x: clip`（非 `hidden`，避免 iOS 嵌套滚动失效）；返回文库后复位布局状态并隔离滚动链；
  luckysheet 触摸吞事件由 `lib/luckysheetTouchShim.ts` 收窄到仅拖拽格内手柄时生效。
- **PPTX 全屏**：用 `createPortal(document.body)` 伪全屏，规避 iOS 上 `transform` 容器的定位问题。
- **甘特图**：H5 默认「只显示时间轴」（折叠左表），底部三段式切换条（任务表 / 双栏 / 甘特图）替代桌面四角小箭头。

### 4.4 H5 分享

阅读页顶栏「分享」按钮三级策略（`lib/share.ts`）：优先 `navigator.share` 系统面板（可唤起微信 / 朋友圈 / QQ 等）；
其次 URL Scheme 直呼（先写剪贴板再跳，未装 App 也不丢链接）；最后复制链接兜底。

---

## 五、文档类型矩阵

`doc_type` 的合法值定义在 `internal/handler/doc_handler.go::validDocTypes`；
**非法或缺失的值会被静默归一化为 `markdown`**（不报错，新增类型时最容易踩的点）。
历史值由 `exportx.NormalizeDocType` 归一：`datatable→sheet`、`drawio→drawing`、`todolist→todo`、`workcalendar→calendar`。

| `doc_type` | 名称 | 可新建 | 正文存储 | 编辑组件 | 阅读组件 | 服务端可导出 |
| --- | --- | --- | --- | --- | --- | --- |
| `markdown` | 文档 | ✅ | Markdown 源码 | Vditor（IR 模式 + Notion 风格行菜单） | Vditor preview + DOMPurify | **.md** / .docx / .pdf |
| `sheet` | 表格 | ✅ | Luckysheet 原生多工作表 JSON（v3，兼容 v1/v2） | Luckysheet | Luckysheet 只读 | **.xlsx** / .csv / .json |
| `mindmap` | 思维导图 | ✅ | simple-mind-map 节点树（v2，兼容 v1） | simple-mind-map（三套浮动工具条） | simple-mind-map readonly | **.km** / .smm / .xmind / .mm / .md / .json / .png |
| `flowchart` | 流程图 | ✅ | Mermaid 源码 | 左源码 / 右实时预览 | Mermaid 渲染 | **.md**（含 ```mermaid）/ .svg / .png |
| `drawing` | 绘图 | ✅ | mxGraph XML | 内嵌 draw.io 编辑器 | 渲染已保存的 SVG | **.drawio**（.svg / .png / .vsdx 需在前端 draw.io 内核内导出） |
| `whiteboard` | 白板 | ✅ | Excalidraw `{version,elements,appState,files,svg}` | Excalidraw（全自托管） | 落库 SVG（无则现场渲染） | **.excalidraw** / .svg |
| `todo` | 待办清单 | ✅ | `{version,items[]}` | 待办面板 | 待办面板（只读） | **.xlsx** / .md / .json |
| `calendar` | 工作日历 | ✅ | `{version,tasks[]}` | 日历面板 | 日历面板（只读） | **.xlsx** / .ics / .json |
| `gantt` | 甘特图 | ✅ | `{version,tasks[],links[]}` | SVAR React Gantt | SVAR Gantt（可写用户仅可改进度） | **.xlsx** / .md / .json |
| `api` | 接口文档 | ✅ | `{version,base_host,groups[]}` | 仿 Apifox（含在线调试） | 只读视图（调试仍可用） | **.md** / .json |
| `gallery` | 图片库 | ✅ | `{version,images[]}`（每图 url/preview/thumb） | 图片库编辑器 | 相册视图 | —（原图下载） |
| `prototype` | 需求原型 | ✅ | `{version,items[]}`（文件 + 需求描述） | 原型编辑器 | 原型视图（网页包可 iframe 打开） | —（原文件下载） |
| `file` | 附件 | ❌（导入产生） | `FileRef{url,filename,size,ext,derived,degraded,note}` | 不可编辑 | 按扩展名分发：pdf.js / mammoth / pptx-preview / CAD / draw.io 内嵌 | 原文件；DWG/DXF 额外 .svg / .png |
| `web` | 网页 | ❌（导入产生） | `WebRef{kind:url\|html,...}` | 不可编辑 | iframe 嵌入（`sandbox="allow-scripts allow-forms allow-popups allow-modals"`） | — |
| `folder` | 目录 | ❌（新建目录产生） | 恒为空 | 不可编辑 | 占位提示 | — |

- **新建入口**：`markdown / sheet / mindmap / flowchart / drawing / whiteboard / todo / calendar / gantt / api / gallery / prototype` 共 **12** 类可选；
  `file`、`web` 由导入产生，`folder` 由「新建目录」产生。
- **自动保存**：Vditor / Sheet / Mindmap / Flowchart / Todo / Calendar / Gantt / Whiteboard 均为 3s 防抖；
  ApiEditor 2.5s；Drawio 约 2s 节流；白板 3s 防抖 + 卸载前兜底。手动「保存」额外生成一条手动版本快照。
- **阅读宽度**：标准 780 / 宽屏 1100 / 全宽，可拖动调整 600–1800px，偏好存 `localStorage`。

### 5.1 导入矩阵

| 来源扩展名 | 落库结果 |
| --- | --- |
| `.md` `.markdown` `.txt` | `markdown` 文档 |
| `.html` `.htm` | HTML 单页 → `web` 文档（`kind=html`，原样保存后用 iframe 展示） |
| `.docx` / `.doc` / `.pdf` | `file` 附件，原文件保存 + 内置预览（Word 用 mammoth 转 HTML、PDF 用 pdf.js 分页渲染） |
| `.pptx` | `file` 附件，前端 pptx-preview 渲染，支持逐页 / 自动播放 / 全屏；导入时自动把外链图片下载内嵌 |
| `.xlsx` / `.xls` / `.csv` / `.et` | 转为 `sheet` 文档；**多工作表时以文件名建父「表格」，每个有内容的工作表建一个表格子文档** |
| `.smm` / `.km` / `.xmind` / `.mm` | 解析为 `mindmap`（中间树 → v2 `.smm`，扩展名不可信时按内容嗅探） |
| `.dwg` / `.dxf` | `file` 附件，服务端派生 `.svg`（矢量优先）+ `.png` |
| `.drawio` / `.excalidraw` | `drawing` / `whiteboard` 文档，内嵌对应编辑器直接编辑 |
| `.vsd` / `.vsdx` | `file` 附件，阅读页由绘图组件转换预览，可另存为可编辑的 `drawing` |
| `.wps` / `.dps` | `file` 附件 |
| 网页链接（URL） | `web` 文档（`kind=url`）；**服务端只保存网址，不抓取内容**（另有 `GET /api/fetch-title` 仅代理取标题用于展示） |
| 网页目录 / zip 包 | `web` 文档（`kind=html`），原样落存储，入口页 iframe 展示 |

上传白名单与大小限制在 `internal/service/upload_service.go`（默认单文件 64 MB），文件按年月分目录落盘；
相同内容走 **CAS 秒传**（前端 spark-md5 → `/uploads/precheck` → `/instant`），避免重复上传。

### 5.2 导出矩阵

导出**全部在服务端完成格式转换**，前端只负责保存返回的二进制流；排版敏感型（Word / 演示 / PDF）由浏览器端生成。
格式清单的唯一事实来源是 `GET /api/export/docs/:id/formats`。

| 类型 | 服务端格式 | 浏览器端额外格式 |
| --- | --- | --- |
| `markdown` | `.md` / `.docx` / `.pdf` | `.docx` / `.pptx` / `.ppts` / `.pdf`（排版与图片还原更好） |
| `sheet` | `.xlsx` / `.csv` / `.json` | — |
| `mindmap` | `.km` / `.smm` / `.xmind` / `.mm` / `.md` / `.json` / `.png` | — |
| `flowchart` | `.md` / `.svg` / `.png` | — |
| `drawing` | `.drawio` | `.svg` / `.png` / `.vsdx` 需在编辑器内导出 |
| `whiteboard` | `.excalidraw` / `.svg` | `.png` / `.pdf` 由浏览器端（jsPDF）生成 |
| `todo` | `.xlsx` / `.md` / `.json` | — |
| `calendar` | `.xlsx` / `.ics` / `.json` | — |
| `gantt` | `.xlsx` / `.md` / `.json` | — |
| `api` | `.md` / `.json` | — |
| `file`（DWG/DXF） | 原图 + `.dxf` / `.svg` / `.png` | — |
| `file`（其它） | 原文件原样下载 | `.docx` / `.pptx` 原文件、`.pdf` 浏览器生成 |
| 知识库整体 | `.md.zip`（按目录结构；附件按原文件打包，绘图导出为 `.drawio`、白板为 `.excalidraw`） | — |

> `.vsdx` **只能导入不能导出**：vsdx 导出是 draw.io Atlassian 版专属能力
> （`vsdxExportEnabled()` 要求服务名为 `atlassian`，而开源版 `getServiceName()` 恒为 `draw.io`，
> 且导出类 `VsdxExport` 未随开源包发布）。界面已如实标注。

保存方式优先使用 File System Access API 弹出系统保存框，不支持时降级为浏览器下载。

---

## 六、前端静态资源自托管

系统**不依赖任何外部 CDN**，全部前端资源随二进制分发：

| 资源 | 来源 | 说明 |
| --- | --- | --- |
| Vditor（编辑器 / 预览） | `web/public/vditor/dist` | 组件内统一设置 `cdn: '/vditor'` |
| draw.io（绘图组件） | `web/vendor/drawio` → `web/public/drawio` | iframe 嵌入 `embed=1&proto=json`，入口 `/drawio/index.html` |
| Excalidraw（白板） | `web/public/excalidraw` | `EXCALIDRAW_ASSET_PATH=/excalidraw/dist/prod/`；须显式 `import '@excalidraw/excalidraw/index.css'` |
| KaTeX（思维导图公式） | `import 'katex/dist/katex.min.css'` | 由 Vite 打包并重写字体路径 |
| pdf.js worker | `pdfjs-dist` `?url` 导入 | 由 Vite 作为静态资源输出 |
| Mermaid / Luckysheet / SheetJS / simple-mind-map / pptx-preview | npm 依赖 | 由 Vite 打包 |

自托管仅包含**项目启用能力的子集**：Vditor 约 7.5 MB、draw.io 约 44 MB；
未启用的重型渲染器（mathjax / echarts / markmap / graphviz 等）不参与构建。

draw.io 资源按**白名单**裁剪：官方发行版完整静态目录约 154 MB，其中 41 MB 的 `stencils/`
形状定义已被 `js/stencils.min.js` 内联（204 个形状库），因此无需下载；
`shapes/`、`plugins/`、`styles/`、`images/`、`img/`、`mxgraph/`、`stencils/clipart/`
与中英文语言包必须保留。

### 6.1 按需加载三层

体积控制依赖三层机制，改这块前请先读 `web/src/App.tsx`：

1. **库级**：Vditor / simple-mind-map / Luckysheet / pdf.js / mermaid / Excalidraw 等重量级依赖必须经
   `React.lazy` + `components/common/LazyBoundary` 按需加载，禁止改回静态 import。
   入口：`DocContent`（阅读）、`BookPage`（编辑）、`SharePage`（公开预览）、H5 `READER_MAP` / `EDITOR_MAP`。
2. **路由级**：`App.tsx` 内全部页面 `lazy()` + `<LazyBoundary fill>`；
   **布局（`AppLayout` / `BlankLayout` / `H5Router`）保持静态引用**，让顶栏先出现、内容区再补。
3. **静态依赖**：被 lazy 的模块若静态 import 了重量级兄弟，会一起被拉走。

判定标准：入口 CSS `grep -c vditor` 应为 **0**；入口 chunk 不应包含
`smm-container` / `vditor` / `luckysheet` / `x-spreadsheet` / `mermaid` / `pdfjs` / `sheet_to_json`。

---

## 七、微信扫码登录

系统支持**微信扫码登录**（桌面与 H5 共用），无需微信也支持联调。

### 7.1 后端

- 配置 `config.go` 扁平字段 `WeChatAppID / WeChatAppSecret / WeChatRedirectURI`（yml `wechat:` 段），三者齐全 →
  `WeChatEnabled=true`；否则走 **dev 模式**（无凭据也能联调）。
- `model/wechat.go`（`wechat_bindings` 表，唯一索引 `(app_id,open_id)` + `union_id` 索引）→
  `repository/wechat_repo.go` → `service/wechat_service.go`（内存态 ticket 状态机 `pending→authorized/needs_profile/expired`）
  → `handler/wechat_handler.go`。
- 路由挂在 `/api/auth/wechat/`：`qrcode`（生成会话）、`callback`（真实扫码 302 换码）、`status`（轮询）、
  `bind`（无绑定账号时「绑定已有 / 注册新用户」）、`dev-complete`（dev 模式模拟扫码）。
- `User` 表新增 `avatar` 字段（微信昵称/头像注册时带入）；`AutoMigrate` 已含 `WeChatBinding`。

### 7.2 前端

- `api/wechat.ts` + `components/WeChatLoginModal.tsx`（`qrcode` 库 `toDataURL` 渲染二维码、轮询 `/status` 每 1.5s、
  needs_profile 弹「绑定/注册」表单；dev 模式多一个「模拟扫码」按钮）。
- `pages/LoginPage.tsx` 接入（桌面/H5 共用「微信扫码登录」按钮，成功用 `/auth/me` 补 user）。

> 生产启用真实扫码：在 `conf/application.yml` 的 `wechat:` 填 appid/secret/redirect_uri，并把 redirect_uri
> 配成 `/api/auth/wechat/callback` 的可公网访问地址即可（dev 模式自动让位）。

---

## 八、API 约定

统一前缀 `/api`，响应体：

```json
{ "code": 0, "message": "ok", "data": {} }
```

失败时 `code` 非 0，HTTP 状态码与 `code` 同步。

| code | HTTP | 含义 |
| --- | --- | --- |
| `0` | 200 | 成功 |
| `40001` | 400 | 参数错误 |
| `40101` | 401 | 未登录或登录已失效 |
| `40301` | 403 | 无权限（含分享密码错误） |
| `40401` | 404 | 资源 / 接口不存在 |
| `40901` | 409 | 资源冲突（重名、重复邀请等） |
| `41301` | 413 | 文件超限 |
| `41501` | 415 | 文件类型不在白名单 |
| `42901` | 429 | 请求过于频繁 |
| `50000` | 500 | 服务器内部错误 |

鉴权为 JWT（HS256，`{uid,role}`，有效期 **7 天**，前端存 `localStorage` 的 `hk_token`）。
限流：注册**同 IP 60 秒一次**；文档分享密码校验 **slug + IP 5 次/分钟**。
`/uploads/*` 为免鉴权静态访问（历史行为），持有链接即可读取。

### 8.1 路由分组

| 分组 | 前缀 | 主要能力 |
| --- | --- | --- |
| 认证 / 用户 | `/api/auth`、`/api/users/me` | 注册、登录、微信扫码、当前用户、改昵称 / 改密码 |
| 知识库 | `/api/books` | 列表（我是所有者 / 团队 / 公司）、CRUD、可见性、导出 |
| 文档与目录树 | `/api/books/:id/docs`、`/api/docs/:id` | 新建、详情、更新、移动、复制、跨库移动、置顶、软删 |
| 版本快照 | `/api/docs/:id/versions` | 列表、单版本、回滚 |
| 回收站 | `/api/trash`、`/api/docs/:id/restore`、`/api/docs/:id/purge` | 列表、恢复、彻底删除 |
| 搜索 / 工作台 | `/api/search`、`/api/recent-docs`、`/api/workbench` | 全文搜索、最近更新、待办 / 甘特 / 日历聚合 |
| 团队 | `/api/teams` | 团队 CRUD、成员与角色、团队文库 |
| 协作者 / 分享 | `/api/docs/:id/collaborators`、`/api/docs/:id/share`、`/api/public/...` | 邀请协作、文档分享（密码 / 有效期）、公开只读访问 |
| 图片库 / 原型 | `/api/docs/:id/gallery/...`、`/api/docs/:id/prototype/...` | 批量加图 / 删图 / 改名 / 重建预览 |
| 接口文档 | `/api/docs/:id/api-debug-history` | 调试历史（每人每接口 10 条） |
| 上传与导入 | `/api/uploads`、`/api/attachments/prepare`、`/api/import/url`、`/api/import/html`、`/api/mindmap/parse` | 上传、附件预处理、URL / HTML 导入、思维导图解析、CAS 秒传 |
| 导出 | `/api/export/docs/:id`、`/api/export/docs/:id/formats`、`/api/export/books/:id` | 单篇导出、格式清单、整库打包 |
| 代理 | `/api/proxy`、`/api/fetch-title` | 接口在线调试转发、网页标题抓取（含 SSRF 防护） |
| 能力探测 | `/api/cad/converter`、`/api/images/converter` | DWG / 图片转换器可用性 |
| 管理端 | `/api/admin/...` | 用户管理、文库管理、写权限授权、系统配置、数据库 / 存储迁移 |

---

## 九、后端结构要点

### 9.1 服务层

| 文件 | 职责 |
| --- | --- |
| `auth_service` / `user_service` | bcrypt 注册登录、微信绑定、改密、管理员用户 CRUD 与恢复 |
| `book_service` / `doc_service` | 知识库与文档树、复制子树、跨库移动、置顶、权限判定 |
| `search_service` / `recent_docs_service` / `workbench_service` | 搜索片段、最近更新、工作台聚合 |
| `version_service` / `trash_service` | 版本快照（保留 20 版）与回收站 |
| `collaborator_service` / `share_service` / `doc_share_service` | 协作者、书级分享、文档级分享（base62 slug / bcrypt / 有效期 / 限频） |
| `team_service` | 团队、成员角色、团队文库 |
| `attachment_service` | 附件预处理：CAD → svg/png、PPTX 外链图本地化 |
| `upload_service` | 白名单 + 大小限制 + 年月分目录 + CAS 去重 |
| `gallery_service` / `prototype_service` / `web_service` | 图片库、需求原型、网页型文档 |
| `export_service` | 导出编排（单篇 / 整库 zip），文件名清洗与 `Content-Disposition` |
| `system_config_service` / `migrate_service` | 在线配置（延迟重启）与数据库 / 存储迁移 |

### 9.2 `exportx` 导出子系统

- **格式分派**：`Convert(docType, format, content, title)`；`FormatsForDocType` 是格式清单的唯一来源。
- **自研实现**：docx（OOXML + zip）、xlsx、xmind、km、mm、smm、ics、excalidraw 全部手写，**不依赖 excelize**；
  Markdown 解析、Mermaid 渲染子集亦为自研。
- **PDF**：`github.com/signintech/gopdf`，A4 版式 + CJK 字体嵌入（`font.go`，含 TTC → TTF 提取）。
- **PNG 栅格化**：`github.com/fogleman/gg` + `golang.org/x/image/font/opentype`，
  用于思维导图 / 流程图 / CAD / 白板的位图输出。
- **CAD**：`cad.go` 自制 DXF 解析（曲线离散化）、`cad_render.go` 同一几何出 SVG / PNG 两条路径、
  `cad_converter.go` 负责 DWG → DXF 的两级降级策略。
- **白板**：`whiteboard.go` 回官方 `.excalidraw` 壳或导出落库 `svg`。

### 9.3 `imgconv` 图片归一化

原生解码 `jpg` / `png` / `gif` / `webp` / `tiff` / `bmp`；SVG 矢量直通；
`heic` / `heif` / `psd` / `cdr` / `ai` 走外部转换器（`heif-convert` 或 ImageMagick），
缺失时降级为只保留原件。统一产出：

- `Original`：全分辨率；
- `Preview`：最长边 ≤1920；
- `Thumb`：最长边 ≤400。

解码上限 80 MP，JPEG 质量 82。图片库 / 原型 / 附件三处共用同一套产出，
并可通过 `POST .../regenerate` 单独重建预览。

---

## 十、内置模板库

系统内置 **366** 个场景模板，覆盖常用文档类型，可在「模板中心」按类型筛选、预览后一键建文档：

| 类型 | 数量 | 说明 |
| --- | --- | --- |
| 文档（markdown） | 54 | 7 个业务目录，真实示例内容（非填空占位） |
| 表格（sheet） | 38 | 合并标题带、表头底色、斑马纹、合计行、首行冻结 |
| 思维导图（mindmap） | 39 | 4 套色卡完整主题快照（墨蓝 / 青玉 / 绛玫 / 石墨） |
| 甘特图（gantt） | 5 | 排期锚定基准日，状态混合（正常 / 已结束 / 未开始） |
| 绘图（drawio） | 45 | 业务流程 14 / 系统架构 14 / 分析决策 9 / 关系结构 8，XML + 矢量 SVG 同源 |
| 流程图（mermaid） | 160 | 八种图型（流程图 / 时序图 / 类图 / 甘特 / ER / 时间线 / 饼图 / 思维导图）各 20 |
| 白板（excalidraw） | 25 | 流程图 / 组织架构 / SWOT / 看板 / 时间轴 / 用户旅程 / 网络拓扑等 |

模板由 `server/internal/repository/templates/*.json` 提供，启动自动补齐（幂等）；
源文件在 `server/internal/repository/templates/_src/`，经 `tools/templates/gen.py` /
`gen-drawing.py` / `gen-flowchart.py` / `gen-whiteboard.py` 生成，**禁止手改 JSON**。

---

## 十一、测试与回归

### 11.1 后端

```bash
cd server && go test ./... -count=1 -p 1
```

- **`-p 1` 不可省**：各包测试共用同一份 SQLite 测试库的连接习惯，并发跑会相互踩库。
- 在**默认环境**（不设置 `EXPORT_FONT_PATH` 等绕过开关）下必须全绿。
- `TestDocExportAllFormats` **不再以「环境缺中文字体」豁免**——现已改为「gopdf 复验」筛选。
  **任何一条 `--- FAIL` 都视为真实缺陷**。
- 设计如此、非缺陷的 SKIP：`TestConvertDWGRealFixtures`（缺真实图纸夹具）、`TestGenerateSamples`。

### 11.2 前端自检（无需浏览器）

```bash
cd web
npm run build            # tsc --noEmit + vite build
npm run verify:import    # HTML 导入清洗
npm run verify:drawio    # draw.io 静态资源体检
npm run verify:sheet     # 表格存储契约 + 导出扩展名映射
npm run verify:dashboard # 首页纯逻辑 + 目录下拉 {value,label} 契约
npm run verify:gantt-ids # 甘特临时 id 归一化
npm run verify:workbench # 工作台 / 待办聚合口径
```

这些脚本用 esbuild **现场转译产品源码再断言**（`src/lib/*`），**改了产品逻辑会立刻失败**。

### 11.3 浏览器端到端套件（`tools/verify/`）

```bash
bash tools/build/build-embed.sh      # 必须先跑：产出生产形态二进制
bash tools/verify/run-all.sh         # 全套，逐套 ✅/❌ 汇总
SUITES="e2e-folder-dir ui-doc-types" bash tools/verify/run-all.sh   # 只跑子集
```

覆盖：embed 完整性与 SPA 兜底、新建 / 导入的存放位置、首页 Dashboard、导入导出双通道、
文档类型读写、甘特图（折叠丢行 / 边界态 / API / 界面冒烟）、按需加载与路由占位、
DWG 渲染探针、H5 阅读链（68 项）、H5 返回后触摸划屏（24 项）、微信登录 dev 模式（13 项）、
白板（14 项）、Dockerfile 阶段模拟。当前共 **25 套、553+ 项断言**，全绿即 `ALL_SUITES_PASS`。

> **改了前端不重跑 `build-embed.sh`，套件测的就是旧产物** —— 这是最容易自欺的一点。
> 套件依赖的数据夹具在 `tools/verify/fixtures/`。

---

## 十二、已知限制与注意事项

- **`doc_type` 非法值静默降级**：新建接口收到不在白名单内的类型会落成 `markdown` 且不报错。新增类型时必须同步改
  `handler.validDocTypes` → `exportx.NormalizeDocType` / `FormatsForDocType` → 前端 `DocType`
  联合类型 → `iconForDocType` → `DocContent` / H5 `READER_MAP` / `EDITOR_MAP` 分发。
- **`.vsdx` 只能导入不能导出**（draw.io 开源版限制，见 §5.2）。
- **`/uploads/*` 不鉴权**：持有链接即可读取，请勿在其中存放高敏文件。
- **绘图文档的阅读页依赖已保存的 SVG**：历史文档若从未在编辑器中保存过，会提示「尚未生成矢量预览」，
  打开一次「编辑」再保存即可补齐。
- **网页型文档受对方站点限制**：若目标站点设置 `X-Frame-Options`，iframe 会空白，需改用「在新窗口打开」。
- **PDF / PNG 导出依赖服务器中文字体**：字体解析失败时相关导出会失败，请按 §2.2 安装。
- **仓库内的 `conf/application.yml` 含示例密钥**：正式部署前请替换 `jwt.secret`（及数据库口令），
  并从版本控制中排除真实配置。
- **H5 甘特图在有写权限时仍只显示「只读」**：`MDoc` 当前只透传 `canWrite`，未接到 `progressEditable`
  （既有行为，是否放开属需求确认项）。
- **MySQL 下 `GET /api/search` 恒返回 500（已定位，未修复）**：`internal/repository/search_repo.go`
  的 LIKE 子句写作 `LIKE ? ESCAPE '\\'`。Go 双引号字符串里 `\\` 已被还原成单个反斜杠，落到 SQL 文本
  就是 `ESCAPE '\'`——SQLite 的字符串字面量不认反斜杠转义，`'\'` 是合法的单字符常量，因此本地一切正常；
  但 MySQL 会把 `\'` 当成被转义的单引号，字符串不闭合 → 语法错误。用不依赖方言的转义符即可两端通用，
  例如把 `escapeLike` 改为追加转义 `!`（`!`→`!!`、`%`→`!%`、`_`→`!_`）并把 SQL 改成 `ESCAPE '!'`。

---

## 十三、文档索引

| 文档 | 说明 |
| --- | --- |
| `docs/寄海文库用户使用手册.pdf` | **面向最终用户的使用手册**（带界面截图；源文件 `docs/manual/寄海文库用户使用手册.md`） |
| `docs/寄海文库功能指南.pdf` | 功能指南（功能 / 技术对照；源文件 `docs/寄海文库功能指南.md`） |
| `docs/manual/` | 用户手册的 Markdown 源文件与截图资源 |
| `docs/system_design.md` | H5 手机版 UI 系统架构设计 + 任务分解 |
| `docs/h5-mobile-class-diagram.mermaid` / `sequence-diagram.mermaid` | H5 类图 / 时序图 |
| `overview*.md` | 历轮交付说明（白板、模板、H5 修复、微信登录等） |
| `API_DOC_*.md` | 若干专项接口变更说明 |
| `gantt-*.md` | 甘特图相关缺陷修复记录 |
| `tools/verify/README.md` | 回归套件的端口表、夹具与已知坑 |
