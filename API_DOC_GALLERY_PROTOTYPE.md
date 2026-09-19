# 图片库（gallery）与需求原型（prototype）接口文档

> 两类文档都是「清单型」文档：正文是一份 JSON，列出库里每个条目（图片 / 原型）。
> 阅读态只渲染清单，编辑态在浏览器里完成上传/增删/改名，服务端只负责落盘 + 生成派生图 + 记录。
> 两者都走文档级写权限（`loadDocForAccess write=true`），与公司文库的「所有人可编辑」同口径。

## 图片库 doc_type=gallery

正文结构 `GalleryContent { version, images: GalleryImage[] }`。每张图三份文件：

- `url` 原件（永远保留，可下载、可重新生成派生图）
- `preview` 标准尺寸预览图（最长边 1600，灯箱用）
- `thumb` 缩略图（最长边 400，网格用）

SVG 等矢量图 `preview/thumb` 直接等于 `url`（浏览器按容器缩放，不失真）。

### POST /api/docs/:id/gallery/images
批量上传图片（multipart `files[]`）。服务端立刻为每张生成预览图 + 缩略图（走 `imgconv`：
原生格式出图；HEIC/PSD/CDR/AI 等缺外部转换器时单张降级——仍入库、仍可下载，只是没有预览图）。
逐张处理，一张坏不影响其余（失败项进 `rejected`）。

请求：`multipart/form-data`，字段 `files`（多文件）。
返回：`{ images: GalleryImage[], rejected: {name,reason}[] }`。

### DELETE /api/docs/:id/gallery/images/:imageId
删除一张图（原件 + 两张派生图一并清理）。

### PATCH /api/docs/:id/gallery/images/:imageId
改显示名：`{ "name": "新名字" }`。

### GET /api/images/converter
当前服务端图片转换能力（前端上传前提示哪些格式会降级）。
返回：`{ converter, heif_converter, native_formats, external_format, vector_formats, allowed_ext, preview_max, thumb_max }`。

## 需求原型 doc_type=prototype

正文结构 `PrototypeContent { version, items: PrototypeItem[] }`。每条原型必须带标题、可选需求描述：

- `title` 标题（上传时必填）
- `desc` 需求描述
- `kind`：`html`（Axure/Mockplus 导出网页包、单页 HTML，直接嵌入展示） / `image`（图片原型，生成预览） / `other`（.rp/.mp/.sketch 工程文件，服务端无法渲染 → 保原件下载）
- `url` 原件下载地址
- `entry` kind=html 时的入口页（iframe src）
- `preview` / `thumb` 预览图（image 有；other 缺转换器时为占位）
- `degraded` 是否降级（没有可展示的预览）
- `note` 降级原因 / 处理说明

### POST /api/docs/:id/prototype/items
批量上传原型（multipart）。**每个文件必须带标题**：并列三个表单字段
`files[]`、`titles[]`（JSON 数组，与 files 等长）、`descs[]`（JSON 数组，可空）。
服务端按格式处理：html→嵌入、图片→预览、zip/.rp/.mp/.sketch→尽量解包抽入口/预览、否则降级保原件。
逐张处理，失败进 `rejected`。
返回：`{ items: PrototypeItem[], rejected: {name,reason}[] }`。

### PATCH /api/docs/:id/prototype/items/:itemId
改某条原型的标题与需求描述：`{ "title": "...", "desc": "..." }`（title 必填）。

### DELETE /api/docs/:id/prototype/items/:itemId
删除一条原型（原件 / 预览图 / 解压出的网页包一并清理）。

## 通用说明
- 文档类型白名单 `validDocTypes` 已含 `gallery` / `prototype`，「新建文档」向导直接可选。
- 单文件大小上限与全局上传上限同源（`conf/application.yml` 的 `upload.max_size_mb`）。
- 存储抽象：文件按 `uploads/...` 相对键存（local 或 S3 通用），切换存储无需改写任何业务数据。
