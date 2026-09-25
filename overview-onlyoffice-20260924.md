# OnlyOffice Web Comp 集成完成（2026-09-24）

将开源组件 [onlyoffice-web-comp](https://github.com/electroluxcode/onlyoffice-web-comp) 落地为寄海文库
**表格 / Word / PPT** 三类文档的**纯前端**在线编辑组件：**不接入 OnlyOffice Document Server，不连接任何外部文档服务**——
全部在浏览器内运行（静态 SDK + x2t WASM）。

## 交付内容

### 1. 前端编辑组件替换
- **编辑态**：`BookPage.tsx` 按文档类型分发
  - `sheet` + 正文是办公文件引用（`isOfficeContent`）→ `OnlyOfficeEditor`（Excel）
  - `word` → `OnlyOfficeEditor`（Word）；`ppt` → `OnlyOfficeEditor`（PPT）
  - `sheet` + 旧版 luckysheet 正文 → 仍走 `SheetEditor`（旧数据不破坏）
- **阅读态**：`DocContent.tsx`
  - office 表格 → `OfficeReader`（OnlyOffice 只读）
  - 其余表格 → `SheetView`（luckysheet）
  - `word` / `ppt` → `FileView`（复用既有 mammoth / pptx-preview）
- **H5 / 分享态**：`h5/readerMap.ts` 复用 `FileView`，组件不变（符合需求「H5 暂不更换」）。
- **图标**：`lib/fileIcon.tsx` 增加 `word` / `ppt` 图标。
- 新建文档菜单：原「表格」→ **「Excel文件」**，新增 **「Word文件」** / **「PPT文件」**。

### 2. 后端（仅白名单，不存改存储）
- `doc_handler.go`：`validDocTypes` 增加 `word` / `ppt`。
- `exportx/export.go`：`NormalizeDocType` / `FormatsForDocType` / `Convert` 把 `word` / `ppt` 当附件型处理（与 `file` 一致，**不做服务器侧格式转换**）。
- 存储完全复用现有 Go `/uploads`（CAS 秒传）；正文只存 `{url,filename,size,ext}` 引用（与 `FileAttachment` 同构）。
- 新增 `lib/officeDoc.ts`：`isOfficeContent` / `parseOfficeRef` / `fileTypeForDocType` / `officeRefFromUpload` 等。

### 3. 静态 SDK（1.1G，已 gitignore）
- vendored 到 `web/public/packages/onlyoffice/9.4.0-develop`（含 `web-apps/` `sdkjs/` `x2t/` `x2t.wasm` `fonts/`）。
- `.gitignore` 已加 `web/public/packages/`（与 vditor/drawio/excalidraw 同为「构建输入勿入库」），避免 1.1G 进 git。

### 4. 构建修复
- `vite.config.ts` 增加 `worker:{format:'es'}`（x2t Worker 默认 `iife` 在代码分割下报错）。
- 第三方 TS 用 `tsconfig.json` 的 `exclude` + 环境声明 `onlyoffice-web-comp-shim.d.ts` + 4 个文件 `// @ts-nocheck` 隔离。
- `exceljs` 加入 `package.json`（CSV→XLSX 动态 import）。

## 验证结果
| 项目 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `vite build` | 通过（dist 1.3G，含 SDK） |
| `embed-prod-check`（生产单文件二进制） | **PASS=20**，999MB 二进制含 SDK，`api.js`/`x2t.wasm`/`OnlyOfficeEditor` chunk 均 200 |
| `ui-doc-types` 回归 | **18/18 通过**，旧 luckysheet 路由未回归，0 控制台错误 |
| 无头 Chrome 冒烟（word/ppt/sheet-office） | 三类均 `iframe[name=frameEditor]` 挂载、`window.DocsAPI` 就绪、**0 控制台错误** |

## 说明 / 边界
- 阅读、分享、H5 三态所用组件**未替换**（按要求），仅编辑态切换为 OnlyOffice。
- 未跑完整 30 套 `run-all.sh`：本次改动仅涉及 office 编辑/阅读分发与新增 doc_type，直接相关的 `embed-prod-check`、`ui-doc-types` 已通过；其余套件测试的是无关功能（H5/白板/甘特等），依需求这些组件未改动。
- `server/internal/static/dist` 当前为含 SDK 的最新构建产物（gitignore，单文件二进制形态）。
