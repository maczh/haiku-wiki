# 前端组件运行资源

## 构建准备与校验

`npm run dev` 和 `npm run build` 自动准备 KaTeX、OnlyOffice、draw.io、Excalidraw 的静态资源。OnlyOffice 和 draw.io 缺失时会下载，失败会停止构建。

`npm run verify:assets` 检查本地运行资源；`npm run build` 完成后还会检查 dist，覆盖 SDK、draw.io 的完整脚本链及 JS 语法、Excalidraw、PDF/x2t/MD5 worker、公式字体和 Markdown 动态组件。

| 组件 | 资源来源 | 发布路径/方式 |
| --- | --- | --- |
| OnlyOffice Word/Excel/PPT | 固定提交的原仓库 SDK，按 Git blob SHA 校验，支持本地目录 | `public/packages` → `dist/packages` → Go embed |
| draw.io | `jgraph/drawio` 的 `v31.4.6`，本地 vendor 缓存 | `public/drawio` → `dist/drawio` |
| Excalidraw | npm 包内字体、语言包和 data | `public/excalidraw` → `dist/excalidraw` |
| KaTeX / Crepe | npm KaTeX 字体补入 Crepe 相对引用目录 | Vite 生成带哈希的字体资源 |
| PDF 阅读 | `pdfjs-dist` | Vite 打包 PDF worker |
| Office 转换 / MD5 | 项目内 worker | Vite 打包 worker |
| Mermaid、Markdown、思维导图、甘特等 | npm 依赖或项目内组件 | Vite 打包动态 JS/CSS |

OnlyOffice 初次下载体积较大。详细的离线准备及 Docker 说明见 [OnlyOffice SDK 构建输入](./onlyoffice-sdk-setup.md)。

修复前发现的实际缺失：OnlyOffice SDK 整目录、draw.io 的 `js/stencils.min.js`、Crepe 相对引用的 KaTeX 字体目录。draw.io 先前清单有 2384 项，但未包含运行时加载的 stencil bundle，旧校验也遗漏了该文件；现已增加明确必需清单，并在运行时诊断中一起检查。

静态资源被 Git 忽略，部署时必须重新生成实际运行的 Docker 镜像或嵌入前端的 Go 二进制；仅修改源码或只构建 web 不会更新已有后端二进制内的资源。

## 实测记录

- 完整 SDK 的 19629 个文件已获取；下载按 15602 个唯一 Git blob 去重并逐个校验。
- 浏览器隔离组件检查：空白 Word 显示中文工具栏及“第1页共1页”；Excel 显示 A1、公式栏和 Sheet1；PPT 显示编辑工具栏及“幻灯片第1张，共1张”。
- draw.io 显示中文编辑菜单、图形栏和画布；Excalidraw 显示中文绘图工具和画布。
- draw.io 缺失的 stencils bundle 已补齐，并与 v31.4.6 的 Git blob SHA 匹配。
- 本地静态资源校验与 TypeScript 检查通过；测试页面使用隔离请求适配器，不保存真实服务器文档，完成后已移除。
- 完整生产构建和构建后 dist 校验通过；dist 已包含 OnlyOffice SDK、draw.io、Excalidraw、worker 和公式字体，KaTeX 相对字体路径警告已消除。代码复制 18 项回归和 Mermaid 运行时检查通过。
