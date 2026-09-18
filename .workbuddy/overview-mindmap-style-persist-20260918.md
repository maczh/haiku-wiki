# 思维导图样式持久化修复

## 问题
用户反馈：思维导图的「文档样式」修改后保存，没有真正保存到后端；阅读 / 编辑重新打开时样式也不展示。

## 根因（关键）
之前的实现整体用错了 simple-mind-map 的主题 API，导致样式**既不生效也不保存**：

- `setTheme(obj)` 只接受**已注册的主题名**。构造时 `handleOpt` 会把 `opt.theme` 强制成名字（如 `"default"`），传入自定义配置对象并不会重算渲染用的 `themeConfig`——所以主题预设 / 基础样式 / 字体的修改在画布上**根本没生效**。
- 真正生效、且会被 `render → initTheme` 重算渲染主题的配置来自 `opt.themeConfig`，只能通过 **`setThemeConfig(config)`** 写入。
- `getTheme()` 返回的是主题**名字**而不是配置对象。因此：
  1. 基础样式面板的 `themeValue()` 读到的永远是 `undefined`，控件不回显当前值；
  2. 旧代码保存 / 加载用的是 `themeRef` + `setTheme(data.theme)`（一个无效对象），样式等于没存没取；
  3. 主题高亮 `matchThemeKey(getTheme(), …)` 永远对不上，预设卡片从不高亮。

## 修复内容
| 文件 | 改动 |
|---|---|
| `web/src/types/vendor.d.ts` | `MindMap` 类型补 `getCustomThemeConfig()` / `setThemeConfig(config)` 声明 |
| `web/src/components/editor/MindmapEditor.tsx` | 初始化时取默认基准 `defaultThemeRef`；有 `data.theme` 则 `setThemeConfig(data.theme)` 还原；保存 / 卸载直接读 `getData()` + `getCustomThemeConfig()` 写后端（不依赖被节流的 `data_change`）；`handle` 暴露 `baseTheme`(实时配置) / `defaultTheme`(默认基准) / `scheduleSave`；`applyFont` 改用 `setThemeConfig`；删除失效的 `view_theme_change` 监听 |
| `web/src/components/editor/mindmap/MindmapSideToolbar.tsx` | `themeValue` 改读 `getCustomThemeConfig()`（面板正确回显）；`applyThemePatch` 与主题卡片改用 `setThemeConfig`（`defaultTheme()` 为基准做「干净切换」）+ 显式 `scheduleSave()` |
| `web/src/components/reader/MindmapView.tsx` | 阅读态 `setThemeConfig(data.theme)` 还原样式 |

> 节点级样式（颜色 / 字号 / 边框 / 连线 / 形状等）本就保存在 `root` 节点树里，随 `data_change` 一并写入后端，本次无需改动。

## 行为确认
- **编辑态**：改主题 / 基础样式 / 字体 → `setThemeConfig` 即时生效并防抖保存；切到别的文档前若有未保存改动会兜底保存。
- **阅读态**：打开文档时 `setThemeConfig(data.theme)` 还原与编辑态一致的视觉样式。
- **持久化契约**：`docs.content` 的 v2 结构 `{ version, root, layout?, theme? }` 中 `theme` 现在是真正生效的自定义主题配置对象。

## 验证
- `tsc --noEmit` 对改动文件零错误（全量仍仅 5 个既有缺失依赖：docx / jquery / html2canvas / jspdf / pptxgenjs，与本修复无关）。
- 受沙箱限制无法跑整站 `npm run build` 与浏览器冒烟；建议联网环境构建后在编辑 / 阅读两种模式下各做一次样式改动→保存→刷新验证。

## 提交状态
已修改未提交。此前 master 已领先 origin/master 共 15 个 commit，本次修复叠加后待 `git push origin master` 授权（沙箱无 push 凭据）。
