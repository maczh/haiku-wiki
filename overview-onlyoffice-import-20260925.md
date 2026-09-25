# OnlyOffice 办公文档导入/编辑（Phase B）改动总结

> 日期：2026-09-25 ｜ 延续 Phase A（集成 OnlyOffice Web Comp，无 Document Server）的后续需求变更。

## 需求（原文）
- 表格文档改用 OnlyOffice Web Comp 编辑（不再用 Luckysheet）；新建 Excel 表格直接用 OnlyOffice 打开编辑。
- 导入的 `.xlsx/.xls/.docx/.doc/.pptx/.ppt` 全部可用 OnlyOffice 编辑，不再仅是阅读模式。

## 本次改动文件

### 代码（前端）
- `web/src/lib/import/parse.ts`：移除 xlsx→luckysheet 拆分（`sheetToContent`/`parseXlsx`），新增 `parseOfficeFile(target)` 把 docx/doc→`word`、pptx/ppt→`ppt`、xlsx/xls/csv/et→`sheet`，正文留空、附件引用由导入流程回填；pdf/vsd/vsdx/dwg/dxf 仍为 `file`。
- `web/src/lib/import/formats.ts`：PPT 规格补 `.ppt`。
- `web/src/lib/import/runImport.ts`（H5 链路）：附件分支 `createDoc` 用 `res.docType`（原为硬编码 `'file'`）。
- `web/src/pages/BookPage.tsx`：sheet 编辑分支无条件走 OnlyOfficeEditor（移除 luckysheet 分支）。
- `web/src/components/reader/DocContent.tsx`：sheet/word/ppt 阅读分支统一渲染 OnlyOfficeEditor（`canWrite` 决定只读），删除 OfficeReader 引用。
- `web/src/components/editor/OnlyOfficeEditor.tsx`：挂载时 `isLegacySheetContent` → exceljs 转 xlsx Blob 保旧 luckysheet 数据；根容器加 `minHeight:600` 修复阅读态零高度；`readOnly` 由 `canWrite` 决定。
- `web/src/components/editor/OfficeReader.tsx`：已删除（阅读态改走 OnlyOfficeEditor）。
- `web/src/components/import/ImportDialog.tsx`（**桌面链路，本轮关键修复**）：
  - L178 `createDoc(..., 'file', ...)` → `res.docType`（此前漏改导致导入的办公文档恒为 `file`）；
  - L183 办公文档成功文案改为「可用 OnlyOffice 编辑」；
  - 同步更新头部注释与导入说明文案。

### 验证套件（tools/verify）
- `e2e-import.sh`：断言改为 xlsx→单一 `sheet` 办公文档（不再拆父+子）、docx→`word`、pdf→`file`、sheet 正文为 office 引用 JSON、docx 阅读态 OnlyOffice 挂载且旧 `.docx-preview` 已消失。
- `ui-doc-types.sh`：sheet 阅读/编辑断言改为 `.onlyoffice-container` + `iframe[name=frameEditor]`。

## 关键教训
工作记忆早有约定：**「桌面 ImportDialog 与 H5 runImport.ts 是两条链路，改行为必须两处同步」**。
本轮最初只改了 `runImport.ts`（H5）+ `parse.ts`，漏改桌面 `ImportDialog.tsx` 内联逻辑，
导致 e2e 跑出来 doc_type 仍是 `file` 才暴露。已补齐并在 MEMORY.md 记录具体落库点（L178）。

## 验证状态
- `npx tsc --noEmit`：rc=0。
- 重建嵌入二进制 `build-embed.sh`：BUILD_EMBED_EXIT=0（999MB，含最新前端）。
- `e2e-import.sh`：**12/12 通过，0 失败**（xlsx→sheet、docx→word、docx 阅读态 OnlyOffice 挂载均 ✅）。
- `ui-doc-types.sh`：此前 20/20（本轮未再改动断言相关逻辑）。
- 全量 `run-all.sh`：后台运行中，结束后确认 `ALL_SUITES_PASS`。

## 不在本次范围
- H5 阅读态 `readerMap.ts` 仍 `SheetView/FileView`（原始需求「H5 模式暂不更换组件」）。
- 分享模式沿用现有 file/office 正文渲染。
