# 思维导图引擎切换：simple-mind-map → mindmap-vite（`v1-mm` 分支）

## 目标

在 `v1` 基础上新建 `v1-mm` 分支，把前端思维导图渲染/编辑引擎整体换成自建组件
`mindmap-vite`（源码源 `/home/Macro/Work/js/src/github.com/maczh/mindmap-vite`），
**编辑 / 阅读 / 分享 / H5 四种模式功能不变，后端与存储数据格式不变**。

两个前置决策（已与用户确认）：

1. mindmap-vite 未实现 simple-mind-map 的部分插件能力 → **在组件源码里补齐**（不是下线按钮）。
2. 组件接入方式 → **源码 vendor 进仓库**，由 Vite 直接构建，不依赖 `file:` 依赖或 dist-lib 产物。

## 改动清单

### 新增（vendor 组件）

- `web/src/components/mindmap-vite/src/**`：从上游仓库复制 `src/`，删掉 demo 专用条目
  （`main.tsx` / `App.tsx` / `index.css` / `data/youdaoMindmap.raw.json`）。
  保留 `components/MindMap/**` 与 `data/adapter.ts`。
- `web/src/lib/mindmap.smm.ts`：适配层，SMM 契约 ⇄ `MindNode` 双向转换
  （节点树、图片/标签/公式/外框/概要/关联线、layout、theme），是两层之间**唯一**转换口。
- `web/src/lib/mindmap.ts` 改为再导出契约类型，`parse/stringify` 逻辑不动。

### 组件源码扩展（补齐 7 类 simple-mind-map 插件能力）

| 能力 | 实现位置 |
| --- | --- |
| 节点缩略图 | `extras.tsx` `NodeImage`（SVG `<image>` 固定 40×40 方框） |
| 标签 | `extras.tsx` `NodeTags`（小色块 pill，`layout.ts` `measureTagWidth` 量宽） |
| LaTeX 公式 | `extras.tsx` `FormulaText`（`foreignObject` + katex，`latexWidth` 缓存量宽） |
| 关联线 | `extras.tsx` `ExtrasLayer` 读根节点 `assocLines`，三次贝塞尔 |
| 外框 | `ExtrasLayer` 子树包围盒虚线框 |
| 概要 | `ExtrasLayer` 子树末端虚线汇总 |
| 格式刷 | 宿主侧暂存源节点 style，选中落地时 `setNodeStyle` 套用 |

配套改动：`types.ts`（新增补齐项接口 + 缩放/选中上报回调 + `MindMapApi`）、
`layout.ts`（图片/标签/公式的宽度计量）、`MindMap.tsx`（改为 `forwardRef` +
`useImperativeHandle` 暴露 `MindMapApi`，含 `getView/setView` 供 H5 手势直驱视图变换、
`borderRadius` 逐节点圆角），并在 `index.ts` 补导出补齐项类型与 `MindMapApi`。

### 宿主改造

- `components/editor/MindmapEditor.tsx`：由 `new MindMap({el,…})` + `usePlugin`
  改为渲染 `<MindMapCanvas ref={apiRef} editable showToolbar={false} fitOnMount …/>`，
  保留三条浮动工具条、3s 防抖自动保存、手动保存、VersionDrawer、
  超链接/备注/标签/公式/概要/外框/图片上传的 Modal，以及格式刷与关联线拾取。
- `components/editor/mindmap/mmShared.ts`：`MmHandle` 改为包装 `MindMapApi`
  （`api` / `nodeStyle()` / `setNodeStyle()` / `setTheme()` / `execCommand()` …）。
- `components/editor/mindmap/MindmapSideToolbar.tsx`：全部 `execCommand` 调用换到新句柄；
  `resetTheme` 支持传入预设。
- `components/reader/MindmapView.tsx`：**重写**为 `editable={false}` 的只读渲染，
  保留 H5 原生无级缩放（改用 `setView` 直驱画布变换，等价旧版 `view.scale/x/y`）、
  双指锚点缩放、单指平移、`xx% · 重置` 按钮、320ms/760ms 双次延时 fit 与
  `ResizeObserver` 重 fit。分享模式经 `DocContent → MindmapView` 复用，随阅读态生效。

### 依赖清理

- `web/package.json`：删除 `simple-mind-map`。
- `web/vite.config.ts`：删除 `optimizeDeps.include`（原为预打包 `@svgdotjs/svg.js`）。
- `web/src/types/vendor.d.ts`：删除 simple-mind-map 系列模块声明。
- 注释口径更新（LazyBoundary / DocContent / BookPage）。
- 业务代码里残留的 `simple-mind-map` 字样仅为注释（说明存储契约来源），行为无残留。

## 验证结果

| 项 | 结果 |
| --- | --- |
| `tsc --noEmit -p tsconfig.json` | **EXIT=0**（全工程零错误） |
| `vite build` | **EXIT=0**，2m11s，产物正常 |
| 数据/布局层 Node 校验 | **78 项断言全过** |
| 浏览器渲染（无头 Chrome） | **4 个场景全部渲染成功，运行时错误 0 条** |

Node 侧校验覆盖：

- SMM ⇄ `MindNode` 往返：text / uid / note / hyperlink / tags / formula / image(url+title) /
  `expand:false` → `collapsed` / style（含 `borderRadius`、`shape: rect → rectangle`）。
- **存储契约不变**：`stringifyMindmap(mindNodeToSmm(tree), theme, layout)` 再解析，
  `version=2`、`root.children`、`layout`、`theme` 全部保留；再转 `MindNode` 图片/公式仍在。
- 7 种结构布局（`mindmap` / `logical±right/left` / `org` / `timeline` / `fishbone` / `catalog`）
  在带补齐项的数据上均产出 6 个节点的有限坐标。
- layout ⇄ structure 双向映射；未知 layout 回退 `mindmap`。
- 主题 ⇄ `BaseStyle` 转换（radius / lineWidth / backgroundColor）。
- 兜底：空内容、`v1` 旧格式升级、坏 JSON 三个分支。

## 已知限制 / 后续

### 浏览器渲染验证（无头 Chrome 154）

用 `esbuild` 把组件 + 夹具数据打成一个 IIFE，起静态服务，无头 Chrome 打开后统计 SVG 元素：

| 场景 | svg | path | rect | text | image | foreignObject | 带 rx 的 rect | fit 后的 scale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 编辑态（logicalStructure） | ✓ | 19 | 18 | 10 | 1 | 1 | 16 | 1.3 |
| 阅读态（logicalStructure） | ✓ | 19 | 18 | 10 | 1 | 1 | 16 | 1.3 |
| 时间轴 timeline | ✓ | 17 | 18 | 10 | 1 | 1 | 16 | 1.09 |
| 鱼骨图 fishbone | ✓ | 18 | 18 | 10 | 1 | 1 | 16 | 1.29 |

`image=1` 证明**节点缩略图**渲染出来了，`foreignObject=1` 证明 **katex 公式**渲染出来了，
`rectWithRx=16` 证明**逐节点圆角**生效，`sampleText` 里能看到独立渲染的标签 `重点|P0`。
四种结构的 path 数与 scale 各不相同，说明结构切换真实生效（不是同一个渲染结果）。
`window.onerror` 与 `console.error` 均捕获到 **0 条错误**。

截图存档：`deliverables/mindmap-vite-render-check.png`（自上而下 = 编辑态 / 阅读态 / 时间轴 / 鱼骨图）。
可见根节点胶囊、绿色标签 pill、里程碑节点的蓝色缩略图与绿色公式胶囊、风险节点的虚线外框（带「本期」标注）、
左下角缩略图 minimap，编辑态与阅读态都能完整还原这些补齐项。

- 仍未验证：H5 双指手势拖拽、`MindmapEditor` 与三条浮动工具条的联动
  （格式刷 / 关联线拾取 / 外框 / 图片上传 / 保存落库）。
  建议后续在能跑通 `agent-browser` 的环境补一轮端到端交互核对。
- `MindMapApi.expandAll` 现已使用「全展开」语义（此前误写为 `setCollapsedBelow(2)`）。
- 分享模式与 H5 阅读均复用 `MindmapView`，随阅读态改造自动生效；
  `h5/readerMap.ts` 里的 `mindmap: MindmapView` 映射未改动。
