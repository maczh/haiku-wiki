# 白板文档类型（Excalidraw 集成）— 交付总览

## 完成内容

新增「白板」文档类型（`doc_type=whiteboard`），基于 `@excalidraw/excalidraw@0.18.1` **全自托管**（字体/语言包零 CDN），全链路落地：

### 1. 编辑器（截图 whiteboard-editor.png）
- Excalidraw 画布 + 自绘顶部工具条：**导入白板**（.excalidraw 文件）/ **导入素材库**（.excalidrawlib）/ **清除画布**（红色图标，需求指定）/ **导出** / **保存** / **历史**
- Excalidraw 原生素材库面板可用，`updateLibrary` 注入
- 3 秒防抖自动保存 + 卸载前兜底落库，与 DrawioEditor 同一套保存/版本模式

### 2. 预览与阅读态（whiteboard-read.png）
- 保存契约 `{version, elements, appState, files, svg}`：**SVG 预览随保存同步落库**
- 阅读态/分享页优先显示落库 SVG；无 svg 时用 `exportToSvg` 现场渲染（模板预览同路径）

### 3. 导入（截图 whiteboard-import.png）
- 「导入文件」与「新建」流程支持 `.excalidraw`，导入即建 whiteboard 文档
- 编辑器内支持导入 `.excalidraw` 文件与 `.excalidrawlib` 素材库
- 导入抽屉提示文案已补 `.excalidraw` 说明；已浏览器实走全链路并 DB 复核：正文正确剥壳（version=1 wrapper + elements，无官方壳字段）

### 4. 导出
| 格式 | 通道 | 说明 |
|---|---|---|
| .excalidraw | 服务端 exportx | 回官方壳 `{type:"excalidraw",version:2,elements…}` |
| .svg | 服务端 exportx | 用落库的 svg 预览 |
| .png / .pdf | 浏览器端（jspdf） | 服务端对 png 返 400 + 浏览器指引（属设计行为） |
| 书导出 zip | 服务端 | 白板文档落成 `.excalidraw` 打包 |

### 5. 模板（whiteboard-templates.png）
- `tools/templates/gen-whiteboard.py` 程序化生成 **25 个**场景模板（流程图/组织架构/SWOT/看板/时间轴/用户旅程/网络拓扑等），进种子库 `whiteboard.json`
- 模板中心出现「白板」类型筛选与「白板模板」分类；画廊选模板 → 预览 → 建文档链路复用

## 关键实现决策
- **资源自托管**：`web/scripts/copy-excalidraw-assets.mjs` 同步 fonts/locales 到 `public/excalidraw`（gitignore），`EXCALIDRAW_ASSET_PATH=/excalidraw/dist/prod/`，挂 predev/prebuild
- **踩坑记录**：包样式必须显式 `import '@excalidraw/excalidraw/index.css'`，否则画布撑到 2^25px（无头 Chrome 实测定位）
- 白板模板不进 gen.py/polish.py 管线，独立生成脚本

## 验证结果
- 前端 tsc 零报错；vite build + embed 刷新 + go build 全通过
- 后端 exportx 白板导出测试通过
- 新增回归套件 `tools/verify/whiteboard-check.sh`（14 项断言，端口 8109，登记 run-all.sh）：**14/14 全绿**（含浏览器实走 .excalidraw 导入抽屉 + 正文剥壳断言）
- 冒烟覆盖：模板 ≥20、创建/保存、formats 清单、.excalidraw 官方壳、.svg、png 指引、书 zip 含白板、编辑器挂载（含样式防回归探针）、阅读态 SVG、模板中心

## 改动清单（33 文件）
- 新增：`WhiteboardEditor.tsx` `WhiteboardView.tsx` `whiteboardDoc.ts` `whiteboardExport.ts` `exportx/whiteboard.go`(+test) `copy-excalidraw-assets.mjs` `gen-whiteboard.py` `whiteboard-check.sh` `templates/whiteboard.json`
- 修改：types/BookPage/SharePage/DocContent/ExportDialog/dashboard/fileIcon/import×2/export×2/DocTree(死代码对齐)、doc_handler/export_service/template_service/templates_seed/export.go(+test)、package.json/.gitignore/run-all.sh
