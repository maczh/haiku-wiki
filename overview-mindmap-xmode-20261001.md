# 思维导图基础样式：落库与三态（阅读/H5/分享）一致

日期：2026-10-01　范围：`web/src/**` + `tools/verify/**`　后端零改动。

## 需求

1. 上一轮新增的连线线型 / 箭头 / 连线色彩 / 节点边框线型等，要能真正存进数据库，
   并且阅读模式、分享模式、H5 模式都能看到与编辑模式相同的样式。
2. 连线线型里的「从粗到细」，粗端宽度 8、细端宽度 2。

## 结论先行

查下来「其它模式看不到样式」不是一个 bug，而是**三个叠在一起的 bug**，其中最狠的那个
根本没被任何人察觉：

| # | 问题 | 位置 | 现象 |
|---|------|------|------|
| 1 | 三态用错读入函数 | `reader/MindmapView.tsx:254` | 只读 `theme` 的旧键，读不到 `theme.__baseStyle` |
| 2 | `getBase()` 闭包过期 | `MindMap.tsx` `useImperativeHandle` 依赖数组 | **每改一项基础样式，就把之前设的其它项全抹掉** |
| 3 | `borderStyle` 没做双向映射 | `lib/mindmap.smm.ts` | 节点边框线型根本没进存储契约，存出去就是丢 |

外加两处「顺手就修」的：切主题会清空基础样式（且把「已清空」落库）、taper 粗细端是个
随 `linkWidth` 浮动的派生值而不是产品口径的 8/2。

## 问题 1：三态用错读入函数

`MindmapView` 是阅读 / H5 / 分享**共用**的唯一只读组件，它当初这么取基础样式：

```ts
base: smmThemeToBase(theme)
```

但 `smmThemeToBase()` 只搬 `backgroundColor / lineColor / lineWidth / radius / strokeWidth /
fontFamily / fontSize` 七个**旧键**，压根不认 `theme.__baseStyle`。而 `theme.__baseStyle` 才是
新样式（连线线型 / 箭头 / 连线色彩）的存放处。同一个文件里其实还躺着能读 `__baseStyle` 的
`snapshotBase()`：

```ts
export function snapshotBase(theme) {
  const stored = theme?.[BASE_STYLE_KEY]        // '__baseStyle'
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) return { ...stored }
  return smmThemeToBase(theme)                  // 旧文档自动回落
}
```

改成 `snapshotBase(theme)` 即对齐；旧文档没有 `__baseStyle` 时自动走回落，不用做迁移。

顺带把 `themeId` 也一并带上（原来没传）。**注意不能写成 `themeId: x ?? undefined`** ——
`MindMapCanvas` 是 `{...DEFAULT_CONFIG, ...defaultConfig}` 浅合并，`undefined` 会把默认值
`classic-blue` 冲掉，所以没有存过 id 时整键省略。

## 问题 2：`getBase()` 闭包过期（最隐蔽）

这次真正的元凶。宿主「基础样式」的语义是**全量覆盖**：

```ts
const next = { ...api.getBase(), ...patch }   // 拿到旧 base 再盖上去
api.setConfig({ base: next })
```

而 MindMap 的 `useImperativeHandle` 依赖数组里**没有 `config`**：

```ts
getBase: () => config.base ?? {},     // ← 闭包永远指向首次渲染那份 config
```

于是 `getBase()` 每次都返回空的初始 base，每次改一项都把之前设的其它项抹掉。表现就是：
面板上 chip 明明高亮着、画布也立刻变样，但**存库后只剩最后点过的那一项**。实测复现：

```
点 从粗到细 + 向外箭头 + 单色 → 落库只有 {"linkColorMode":"single"}
```

这不是「样式存不下」，而是「存了但每次丢一片」。解法是让 getter 走 ref 而不是闭包
（`configRef` / `transformRef` 本来就有）：

```ts
getConfig: () => configRef.current,
getBase:   () => configRef.current.base ?? {},
getScale:  () => transformRef.current.scale,
getView:   () => ({ scale: transformRef.current.scale, ... }),
```

`getScale` / `getView` 是同一类病（`transform` 每次平移都换引用），顺手一起治了。

## 问题 3：`borderStyle` 没进存储契约

`lib/mindmap.smm.ts` 是 SMM 存储格式 ⇄ 组件 `MindNode` 的唯一转换口。两边都没映射
`borderStyle`：

- `nodeStyleToSmmStyle()` 输出里没有它 → **存出去就丢**；
- `smmStyleToNodeStyle()` 输入解析里没有它 → **读回来也丢**。

补了双向映射，读入侧加了白名单（`solid/dashed/dotted/dashdot`）再放行，避免任意字符串混进样式。

## 顺带修的两处

**切换主题清空基础样式。** 原来 `handleThemeSelect` 把 `themeRef` 整份换成
`{[THEME_ID_KEY]: id}`：`__baseStyle` 被丢弃，还会把「已清空」这一状态落库 ——
切一次主题就永久丢掉连线样式。但只写 `themeId` 也会踩坑：`applyBaseToSnapshot` 只搬
`__baseStyle`、不认 `THEME_ID_KEY`，所以补完 base 保留之后必须**显式把主题 id 写回
`themeRef`**，否则主题 id 反被冲掉，刷新又变回经典蓝。

**taper 粗细端 = 8 / 2。** 原来是 `taperFillPath(d, linkWidth, Math.max(0.6, linkWidth * 0.28))`，
随连线粗细浮动。改为两个常量：

```ts
const TAPER_THICK_W = 8
const TAPER_THIN_W = 2
```

并且让箭头尺寸跟着**所在端**的线宽走（taper 时父端 8、子端 2），否则箭头会明显比带子细。

**只读态不该画编辑选中环。** reducer 初始化时 `selectedId: data.id`，即**一打开就默认选中根节点**，
于是阅读 / 分享 / H5 三态里也照画了一圈蓝色虚线选中框（`mm-ui-only`），顺带把选中节点的
描边加粗到 `strokeWidth + 0.6`。这个是写第 7 段断言时被 `.mm-rect` 的 `stroke-width` 值 2.6 反查出来的。
修法是把两处选中态表现都挂到 `editableNow` 上 —— 选中环和「加粗 0.6」都只属于编辑态。
新增断言 `阅读·无编辑选中环(mm-ui-only)` 盯死它。

## 验证

新增 `tools/verify/mm-xmode-check.sh`（23 项，端口 8195，已登记进 `run-all.sh` 的
`DEFAULT_SUITES` 和 `PORT_OF`）。亮点是最后一段不靠肉眼：直接从 DOM 里 taper 填充带的
`path.d` 反解两端宽度（路径是用户单位，不随画布缩放变化）——

```
实测粗细端 = 8.00:2.00
```

链路覆盖：编辑态设样式 → 3s 防抖自动保存 → API 回读 `content` 里的 `theme.__baseStyle` →
阅读模式 / H5 / 文档级分享三态渲染断言。

还有一段**旧文档兼容**（第 7 段）：造一份只有旧 theme 键、没有 `__baseStyle` / `__canvasThemeId`
的文档，确认 `snapshotBase` 的回落分支（`→ smmThemeToBase`）没被这次改动带崩。
写这段时自己踩了两个坑，都是**断言写错、不是产品回归**：

- 画布底色不是 SVG `<rect>`，是 `.mm-stage` 的 CSS `background`（`<rect>` 只在导出克隆里临时塞），
  而且 Chrome 会把 `#fff3e0` 序列化成 `rgb(255, 243, 224)`；
- 默认 `linkColorMode = auto` 时连线走各分支色，`theme.lineColor` 只在**没有**分支色时兜底 ——
  直接断言连线 `stroke` 等于旧 `lineColor` 会误判成回归；改用无歧义的 `lineWidth` 回落来证明。

顺带修了 `mm-style-shot.sh`：它一直在读 `#hk-mindmap-base-probe`，但**前端代码里根本没这个
元素**，所以「是否落库」这项恒为 `noprobe`，等于什么都没验（已改成真断言 + 注释说明）。

### 结果

**全量 `run-all.sh`：29 套，✅=593 ❌=0。** 唯一插曲：`e2e-import` 被判「port 18081 busy」
（另一个会话留下的幽灵实例占着 18081，`port_busy` 探测命中→跳过），单独用备用端口补跑通过，
见下表最后一行。

| 套件 | 结果 |
|------|------|
| `mm-xmode-check`（新增 17 项） | ALL_SUITES_PASS |
| `mm-editor-check`（新增 2 项 → 20 项） | ALL_SUITES_PASS |
| `mm-style-shot` | ALL_SUITES_PASS（8 项） |
| `mm-h5-pan-check` | ALL_SUITES_PASS（5 项） |
| `preview-zoom-check` | ALL_SUITES_PASS（13 项） |
| `ui-doc-types` | ALL_SUITES_PASS（18 项） |
| `h5-reader-check` | ALL_SUITES_PASS（68 项） |
| `e2e-editor-menus` | ALL_SUITES_PASS（48 项） |
| `e2e-import` | 全量里被跳过；`PORT=18085` 单独补跑 **17 通过 / 0 失败** |

`tsc --noEmit` 0 错误，`build-embed.sh` ALL_OK。

> 补跑幽灵端口的小抄：套件端口都支持环境变量覆盖（`PORT=${PORT:-18081}`），
> 撞到别的会话占着时直接 `PORT=18085 bash tools/verify/e2e-import.sh`，
> 不必去抢那个端口。

## 写回归套件时踩的坑（留给后来人）

- 分享页用 `/doc-share/:slug`（**文档级**）。`/share/:slug` 是**文库级**，打开只默认选第一篇文档。
- H5 必须先 `localStorage.setItem('haiku_view_mode','h5')` 再 `open` `/m/doc/3`：
  `/m/*` 只在 `H5Router` 登记，无头 Chrome 是桌面 UA，不切模式路由压根不挂载；
  第 6 段量宽度前要切回 `'desktop'`。
- 刷新回显类断言：popover 是收起的，得先点开 combo 再查 `.mm-pop-label`，否则选择器查不到。
- 文档保存接口是 **`PATCH** /api/docs/:id`（不是 PUT）。
