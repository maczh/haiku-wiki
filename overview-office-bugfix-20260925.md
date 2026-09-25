# 三个 BUG 修复报告（2026-09-25）

> 用户报告：①导入的 .pptx/.xlsx 打开编辑报错、存的文件扩展名不对；②三类文件阅读模式 OnlyOffice 画布高度不随浏览器自适应；③三类文件分享到微信后 H5 打不开、被弹到登录页。
> 复现方式：临时起本地服务 + 真实导入 xlsx/docx/pptx + 无头 Chrome 走真实页面，逐条抓证据。

## BUG ①：编辑「报错」——真正的根因是自动保存从未生效（数据会丢）

复现证据（修复前）：双击单元格输入文字 → OnlyOffice 底栏显示**「所有更改已保存」**，但后端落库的正文**完全没变**——只有手点右上角「保存」按钮才会落库。也就是说：编辑看起来正常，改动随时可能丢；这也能解释「一会正常一会报错」。

**根因**：`OnlyOfficeEditor` 挂载时立刻 `manager.getEditor().subscribe('asc_onDocumentModifiedChanged', …)`。此刻编辑器 iframe 里的 SDK API（`Asc.editor`）往往还没就绪，`subscribe` 抛出「OnlyOffice SDK API is not ready」，被原来的 `try/catch` **静默吞掉且不再重试** → 修改事件永远没人监听 → 3 秒防抖自动保存从未运行。

**修复**（`web/src/components/editor/OnlyOfficeEditor.tsx`）：订阅失败后按 1s 间隔自动重试（最多 60 次），成功后走原有的 3s 防抖保存。验证：编辑后落库 content 更新、文件名与扩展名保持原样（`多工作表.xlsx`）、0 控制台错误。

另外两处「报错」体验修复：
- 后端 SPA 兜底不再吞掉静态资源 404（`server/internal/router/router.go`）：`/assets/`、`/packages/` 缺失时返回真 404。此前 PPT 编辑器加载 `sdkjs/slide/themes//themes.js`（SDK 内部主题 id 为空）404 时被喂了 index.html，控制台刷「Uncaught SyntaxError: Unexpected token '<'」假语法错误——SDK 本身对 404 有容错、编辑器实际可用，但这个报错极具误导性。
- OnlyOfficeEditor 加载引用文件时校验内容：空文件 / text/html（原文件被清理后 404 被兜底成网页）时，直接给出「原文件不存在或已被清理，请删除后重新导入」，不再抛玄学转换错误。

## BUG ②：阅读模式画布高度固定 556px → 已随窗口自适应

复现证据（修复前）：窗口高 700/900/1200 时画布恒为 556px（minHeight 兜底值 600 − 44 工具条）。

**修复**：给 office 三类补上与接口文档相同的「标题固定 + 正文占满剩余高度」高度链：
- `BookPage.tsx` 阅读分支：`sheet/word/ppt` 与 `api` 一样走 `height:100%` 弹性列；
- `DocContent.tsx`：`fillHeight` 扩展到 office 类型，外层改 flex 列、正文包 `flex:1 minHeight:0`；
- `DocSharePage.tsx`（桌面分享页）同样处理。

验证（修复后）：窗口 700 / 900 / 1200 → 画布 556（小窗兜底）/ 608 / 908，随窗口伸缩。

## BUG ③：微信 H5 打开分享链接被弹到登录页 → 已修

复现证据（修复前）：手机 UA 打开 pptx 的 `/doc-share/:slug` → 整页跳到登录页，Network 里一条 `POST /api/attachments/pptx-localize` 返回 **401**。

**根因链**：pptx 阅读组件挂载时会补做「外链图片本地化」（需要登录的接口）→ 公开分享页的访问者没有 token → 401 → 前端全局拦截器把**整个页面**弹去登录页。

**修复**：
1. `api/request.ts`：在公开分享页（`/share/`、`/doc-share/`）上，401/40101 只清 token、**不再跳登录**；
2. `PptxView.tsx`：没有 token 就直接跳过本地化补做（省一次注定失败的请求）；
3. `h5/readerMap.ts` 新增 `pickReader()`：表格/Word/PPT 的正文是 office 文件引用时，H5 统一降级为附件阅读卡。修复前 H5 的 SheetView 会把引用 JSON 误判成损坏数据并「**已重置为空表格**」——看起来就像数据丢了。

验证（修复后）：三类文件分享页全部停在 `/doc-share/`、无任何 4xx：
- docx → mammoth 正文预览；
- pptx → pptx-preview 幻灯片翻页/播放；
- xlsx → 附件卡（文件名/大小 + 下载原文件）。

## 回归

全量 `run-all.sh`（25 套）在修复后重跑，结论见文末；受影响最直接的套件：`ui-doc-types`、`e2e-import`、`h5-reader-check`、`pptx-zoom-check`、`check-route-fallback`、`embed-prod-check`（后端路由改动）。

## 改动文件

- `web/src/components/editor/OnlyOfficeEditor.tsx` —— 自动保存订阅重试 + 引用文件内容校验
- `web/src/api/request.ts` —— 公开分享页不弹登录
- `web/src/components/reader/PptxView.tsx` —— 无 token 跳过本地化
- `web/src/h5/readerMap.ts` —— 新增 pickReader
- `web/src/h5/pages/MDoc.tsx`、`MShareDoc.tsx` —— 改用 pickReader
- `web/src/pages/BookPage.tsx`、`pages/DocSharePage.tsx`、`components/reader/DocContent.tsx` —— 阅读态高度链
- `server/internal/router/router.go` —— 静态资源 404 不再喂 index.html
