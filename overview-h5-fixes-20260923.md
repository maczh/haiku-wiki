# H5 划屏 Bug 修复 + 分享阅读支持 H5（2026-09-23）

## 已完成（Task #1 / #2 / #3）

### BUG1 · H5 阅读态纵向划屏不响应（MD / DOCX / PDF / 目录树）
- **根因**：`web/src/index.css` 中 `html, body { overflow-x: hidden }` 按 CSS 规范把 `overflow-y` 强制算成 `auto`，`<body>` 变成滚动容器，导致嵌套 `overflow:auto` 的触屏滚动在 iOS Safari / 微信内核失效。
- **改动**
  - `web/src/index.css`：`overflow-x: hidden` → `overflow-x: clip`（不创建滚动容器）；`.doc-content`、`.docx-preview` 加 `touch-action: pan-y`。
  - `web/src/h5/H5DocContainer.tsx`：内层滚动 `touchAction` 由 `manipulation` → `pan-y`。
  - `web/src/h5/MobileLayout.tsx`：`<main>` 滚动容器加 `touchAction: pan-y`。

### BUG2 · LuckySheet 阅读态二次点击单元格下偏移 ~6 行
- **根因**：阅读态表格嵌在滚动文档流中，容器几何缓存；二次点击落在 200ms 防抖 `refresh()` 窗口内、几何未重测，点击→单元格映射用旧几何（A10 实选 A16）。编辑态容器 `height:100%` 固定故无此 bug。
- **改动** `web/src/components/reader/SheetView.tsx`
  - 200ms 防抖刷新改为 `requestAnimationFrame` 立即重测；
  - 新增 `pointerdown` 捕获阶段 handler，在 Luckysheet 自身 mousedown 前同步 `refresh()` 重测几何。

### 功能 · 分享阅读模式支持 H5
- **设计**：同一分享 URL 在桌面/手机各走各路由，无需手机换路径。
- **改动**
  - `web/src/App.tsx`：删除 `isSharePath` 与 `useLocation`，`mode==='h5'` 一律渲染 `<H5Router/>`（含分享路径）。
  - `web/src/h5/H5Router.tsx`：在「非 `/m` 收口」之前拦截 `/share/`、`/doc-share/`，挂载 `<MShare/>`、`<MShareDoc/>`；新增两者 lazy import。
  - 新增 `web/src/h5/pages/MShare.tsx`（文库级：顶栏 + 正文 + 左侧 Drawer 目录，复用 `READER_MAP`+`H5DocContainer`，免登录）。
  - 新增 `web/src/h5/pages/MShareDoc.tsx`（文档级：顶栏 + 正文 + 密码门/失效判定复用 `PasswordGate`/`getDocShareMeta`/`verifyDocShare`）。

## 验证状态
- `tsc --noEmit`（过滤本机缺失的 docx/jquery/html2canvas/jspdf/pptxgenjs 5 个模块报错）对全部改动文件 **零报错**。
- 全量 `vite build` / 真机·无头浏览器回归：因 `main.tsx` 静态 `import jquery from 'jquery'` 在本机缺失 `node_modules` 下本就失败，与本次改动无关 → **待依赖装好后复验**。

## 待办（未动）
- **Task #4**：有左右面板结构的页面在 H5 改为抽屉/弹窗式布局（更大范围重构，需先确认范围与优先级）。

---

> **后续更新（2026-09-23 晚）**：本文的「验证状态」已过期 —— `web/node_modules` 现已完整，
> `vite build` / `build-embed.sh` 均正常。本轮的六项 H5 反馈（含 **Task #4 的接口文档抽屉**、
> **分享阅读模式的 H5 布局实测**）见 `overview-h5-reader-fixes.md`（回归
> `tools/verify/h5-reader-check.sh`，41/41 全绿）。
