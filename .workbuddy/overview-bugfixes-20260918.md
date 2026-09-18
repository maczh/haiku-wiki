# BUG 修复概览（2026-09-18）

## 修复内容

### 1. 阅读模式宽度调节无效
- **根因**：`web/src/index.css` 中 `.doc-content` 硬编码了 `max-width: 780px; margin: 0 auto;`，MarkdownView 渲染出的正文容器始终固定在 780px，导致 DocContent 外层通过 `useReaderWidth` 控制的宽度被架空。
- **改动**：移除 `.doc-content` 的 `max-width` 与 `margin`，仅保留版式 padding/font/line-height。宽度现在完全由 DocContent 外层容器和阅读宽度滑块决定。

### 2. draw.io 保存时未生成阅读/分享页可用的 SVG 预览
- **根因**：draw.io `export` 事件对 SVG 格式有时会返回 `data:image/svg+xml;base64,...` 形式的 data URI，原逻辑未解码，`isUsableSvg` 直接判为不可用，保存后 svg 仍为空，阅读页继续显示「尚未生成矢量预览」。
- **改动**：
  - `web/src/lib/drawioDoc.ts` 新增 `decodeSvgDataUri`，统一将 base64/urlencoded data URI 解码为裸 SVG 文本。
  - `web/src/components/editor/DrawioEditor.tsx`：`ensureSvg` 与历史文档 SVG 补生成逻辑先 `decodeSvgDataUri` 再校验；手动保存时若仍无可用 SVG 会强制重试一次，失败则给出提示。
  - `web/src/components/reader/DrawioSvgView.tsx`：清洗前同样先解码，兼容已以 data URI 形式落库的 SVG。

### 3. 目录树知识库名称换行
- **根因**：`KnowledgeTree.tsx` 中分类/知识库/文档节点的 titleRender 未统一声明 `whiteSpace: 'nowrap'`，知识库节点外层使用 `inline-flex` 在 antd Tree 的 flex 布局下可能出现标题被挤到下一行的情况。
- **改动**：为三类 titleRender 统一加上 `whiteSpace: 'nowrap'`，知识库节点外层改为 `display: 'flex'`，确保知识库图标与名称始终在同一行。

## 验证

- `tsc --noEmit -p web/tsconfig.json`：仅余 5 个既有沙箱缺失依赖错误（docx / jquery / html2canvas / jspdf / pptxgenjs），与本次改动无关。
- 提交：`ba88a91`。

## 待办

- 当前 master 领先 origin/master 11 个 commit，需用户授权后执行 `git push origin master`。
- 完整浏览器冒烟需在能正常 `npm install && npm run build` 的环境进行。
