# v2-oo Markdown 编辑器迁移

基准：`v1-typo`，提交 `b014f844a37c6e6320b90b939047c1aea9bbffb6`。

## 界面与交互基准

沿用 v1-typo 的现有界面，不新增视觉方案。文档编辑面向日常知识库作者，阅读面向桌面和移动端访问者；采用现有简洁文档排版、相同字体、留白、表格、代码块及交互样式。

- 编辑：相同的 typo-md-editor bundle、Crepe 主题、局部样式覆盖及大纲。外壳和工具栏填满可用宽度，正文初始 80%，由组件原生手柄调整。
- 阅读：MarkdownView、Markdown 排版 CSS、JSON/章节折叠、代码复制与 Mermaid/KaTeX 渲染均来自基准分支。正文由 MdBodyWidth 调整，避免再次套用旧像素宽度控件。
- 分享：书级分享的 Markdown 标题与正文使用相同百分比宽度容器；文档级分享沿用原有页面结构，共用新的 DocContent/MarkdownView。
- H5：保留 v2-oo 的 pickReader 办公文件分流，仅将 Markdown 映射换成基准的 MdBodyWidth + MarkdownView。
- 导出：使用同源 toHtml 和 Markdown 样式。

保留 v2-oo 的 OnlyOffice、Word/PPT/Excel、思维导图及其他文档类型实现。移除已替换的 Vditor 编辑器、命令模块、依赖及静态资源构建步骤。

## 验证记录

- 238 个编辑器、渲染器、CSS、宽度组件及 vendor 文件与基准逐字节相同。
- TypeScript 检查通过，代码复制回归 18/18 通过。
- Mermaid 运行时链路检查通过；生产构建通过（Node 堆上限 8GB）。
- 浏览器组件核对：编辑外壳 413px，正文 330.39px（80%），只有一个原生宽度手柄。
- 普通代码块与无语言 JSON 折叠块的计算背景均为 `rgb(246, 248, 250)`；JSON 展开/折叠正常。
- 360px H5 核对：正文 288px（80%），页面宽 360px，无页面横向溢出；表格与代码块正常显示。

组件核对使用临时本地页面，完成后已移除。受保护页面需要登录，本次没有修改真实文档或执行线上分享。

另修复原入口的 Spectrum UMD 默认导出读取错误，改为按副作用注册插件；浏览器已确认主入口能进入登录页。
