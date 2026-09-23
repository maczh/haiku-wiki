# 第二批 BUG 修复（6 项）与实测

> 2026-09-24 ｜ 单源生产形态（后端内嵌 dist）+ 无头 Chrome（移动视口 390×844 / 桌面 1600×1000）
> 回归：`h5-reader-check.sh` → **68 项全绿**；`preview-zoom-check.sh` → **13 项全绿**（含新增表格命中断言）
> 连带：桌面甘特三套（fold / fold-edge / ui）→ **82 项全绿**

## 结果一览

| # | 反馈 | 结论 | 根因 / 关键改动 |
| --- | --- | --- | --- |
| 1 | 桌面版表格阅读模式**二次点击差 6 行** | ✅ 已修（根因级） | CSS **包含块错配**：`reader/SheetView.tsx` 宿主补 `position:relative` |
| 2 | DOCX/PDF 在 H5 默认大小**划不动**、放大后反而能拖 | ✅ 已修 | `h5/H5ZoomStage.tsx` 自己成为滚动视口（`height:100%` + `overflow:auto` + `overscroll-behavior:contain`） |
| 3 | 思维导图 H5 双指放大**严重虚化**，要无级清晰缩放 | ✅ 已修 | 去掉 CSS `transform` 拉伸位图，改 `MindmapView` 驱动 `mm.view.scale` 原生矢量缩放 |
| 4 | 打开文档返回文库后**目录划不动了** | ✅ 已加固 | `h5/MobileLayout.tsx` 路由切换复位布局状态 + `<main>` `overscroll-behavior:contain` |
| 5 | H5 各类型阅读页**都要有「分享」**，能唤起常见 App | ✅ 已实现 | 新增 `lib/share.ts`（三级策略）+ `h5/ShareSheet.tsx` + `h5/useShareLink.ts`，接入 MDoc / MShare / MShareDoc |
| 6 | H5 甘特左右面板折叠**操作不便** | ✅ 已重做 | 底部三段式切换条（任务表 / 双栏 / 甘特图）替代四角小三角 |

---

## 1｜表格二次点击偏 6 行：是 CSS 包含块，不是时序

之前的判断方向（refresh 时机 / 200ms 防抖）都不对。探针实测：

```
容器 rect.top 260 → 104（外层滚动 156px 后）
#luckysheet-cell-main rect.top 恒为 280        ← 网格根本没跟着滚
第一次点击 → selRow=4；第二、三次 → selRow=10（Δ129px ≈ 6 行）
```

`luckysheet.css` 给根节点 `.luckysheet` 写的是 `position:absolute` 且 **没有 top/left**。
宿主 div 是 `static` 时，它的包含块落到滚动容器之外的某个定位祖先上 —— 于是
**网格不随页面滚动**，而 luckysheet 计算点击命中行用的是 `$("#"+container).offset().top`
（宿主位置，会随滚动走）→ 两者脱钩 → 第二次起整行下移约 6 行。

修法：宿主 `position:relative`。这样包含块就是宿主本身，网格随滚动同步移动，
「宿主偏移量」恒等于「网格原点」，命中恒正确（含滚动之后）。

顺带把原先**每次 pointerdown 都 `refresh()`** 降级为「漂移守卫」——只有宿主与网格
原点差值偏离一行（24px）时才重测，避免整表重绘闪烁。

回归断言（`preview-zoom-check.sh` 第 5 段）：同一网格内相对偏移连点 3 次 + 外层滚动
250px 后再点 1 次，**4 次必须命中同一行**。实测 `3,3,3,3`。

## 2｜DOCX/PDF 默认大小划不动：嵌套滚动视口冲突

原来 `H5ZoomStage` 只负责手势，滚动交给祖先容器（`minHeight` 撑开）。
iOS WebKit 的嵌套 `overflow` 容器在这种结构下会「默认比例划不动、放大后反而能拖」。

改为：**这一层自己就是滚动视口** —— `height:100%`（不是 `minHeight`）、
`overflow: zoomed ? 'hidden' : 'auto'`、`WebkitOverflowScrolling:touch`、
`overscrollBehavior:contain`、`touchAction: zoomed ? 'none' : 'pan-x pan-y'`。
`H5DocContainer` 相应改为传 `height:100%` 确保它有确定高度。

## 3｜思维导图放大虚化：CSS transform 是把位图拉花

simple-mind-map 是「按当前 scale 重新排布矢量 SVG」的渲染器。套 CSS `transform: scale()`
只会把**已经栅格化好的那一层位图**拉伸 —— 放大越多元，越糊。同理 `will-change: transform`
会把该层提升为合成层并按 1:1 位图栅格化，也一并去掉。

改为直接驱动 `mm.view.scale / x / y` 再 `view.transform()`，让 simple-mind-map 自己
按新比例重绘矢量 —— **放大到多少都清晰，且是无级的**。算法与官方 `TouchEvent` 插件
逐行一致（以两指中心为锚、按初始距离线性缩放、位移 <10px 视为抖动）。

配套：`styles.ts` 的 `H5_ZOOMABLE_TYPES` **移除 mindmap**（不再套 `H5ZoomStage`），
并新增浮层「`NNN% · 重置`」按钮；`vendor.d.ts` 补上 `view.x/y/transform` 与 `toPos`
的类型声明。1:1 时 `touch-action: pan-y` 不拦单指 → 划屏照常。

## 4｜返回文库后目录划不动：按防御性加固处理

**未能在无头 Chrome 复现**（40 篇文档、sh=2094/ch=736 的滚动容器，SPA 内 `history.back()`
往返后仍 `ovf=auto / ta=pan-y / scrollTop→200`），判断为 iOS WebKit 特有行为。

因此做的是「状态复位 + 滚动链隔离」这两件必然正确的事：
- `MobileLayout` 监听 `location.pathname`，进入任何页面都复位 `tabHidden / header`、
  清掉 antd Drawer 可能泄漏到 `body` 的内联 `overflow/paddingRight`、并把 `<main>.scrollTop` 归零；
- `<main>` 加 `overscroll-behavior: contain`，滚动不向外链。

（切页时上一页残留的「隐藏底部 Tab / 自定义顶栏」会让内容区高度算错，正是这套复位的目标。）

## 5｜H5 全类型阅读页分享

三级策略（`lib/share.ts`），按「能否真唤起 App」从强到弱：

1. **系统分享** `navigator.share`（iOS Safari / Android Chrome）→ 系统面板里有微信、
   朋友圈、QQ、微博、钉钉、短信… 这是唯一能真正「唤起 App 并带上链接」的通用能力，优先走它；
2. **URL Scheme 直呼**：QQ / QQ空间 / 微博 / 钉钉 / 短信 / 邮件各有 scheme，
   点击时**先把链接写进剪贴板**再跳 —— App 没装也不会「点了没反应、什么都没得到」；
3. **复制链接**兜底。

微信 / 朋友圈没有公众号 JS-SDK 时无法直传，走「复制链接 + 提示去粘贴」，这是微信生态的标准做法。

接入位置：顶栏新增分享图标（`data-h5-share-entry`）
- `pages/MDoc.tsx`：站内文档，点分享才**懒**取 `.doc-share.slug` → `PUT /docs/:id/share`
  （⚠️ 只在 GET 拿不到或已停用时才 PUT —— 后端 upsert **每次都会刷新 slug**，重复 PUT 会让
  之前发出去的旧链接悄悄失效）；
- `pages/MShareDoc.tsx` / `pages/MShare.tsx`：本身就是公开链接，直接分享当前地址。

## 6｜甘特折叠交互重做

桌面那套「四角小三角」在手机上是 16×16 且贴面板角，拇指点不准，还要「先展开再折叠」两步。

改为底部常驻分段控件「任务表 / 双栏 / 甘特图」，当前档位高亮、一键直达，带
`env(safe-area-inset-bottom)` 兜底。桌面端保留原四角箭头（鼠标可精确定位，且不占版面）。

⚠️ 踩坑：绝对定位容器的宽度是「收缩后」再按可用空间分配的，窄屏下 flex-shrink 会把按钮压窄，
把「任务表 / 甘特图」末尾一个字裁掉（实测渲染成「任务」「甘特」）→ 必须 `flex:0 0 auto` + `white-space:nowrap`。

---

## 回归与门禁

| 套件 | 结果 |
| --- | --- |
| `h5-reader-check.sh` | **68 / 68**（新增：导图不套 CSS 缩放层 + 原生缩放已挂载、折叠条 3 档切换、分享入口/面板/链接形态/8 渠道） |
| `preview-zoom-check.sh` | **13 / 13**（新增：宿主 `position:relative` + 连续点击命中同行） |
| `gantt-fold-check.sh` | 30 / 30 |
| `gantt-fold-edge-check.sh` | 22 / 22 |
| `gantt-ui-check.sh` | 30 / 30 |

### 门禁里顺手修掉的一个「假红」隐患

`AutoMigrate` 是**异步**的：服务起来后 `/api/books` 先返回 401，但 `users` 表可能还没补上
`deleted_at` 列 —— 此刻登录得到的是「账号或密码错误」（`TOKEN=null`），套件整体假红。
已在 `h5-reader-check.sh` / `preview-zoom-check.sh` 改成**登录重试轮询**（最多 40 次 × 0.5s）。

---

## 待确认（沿用上一轮）

- `H5_DEGRADED_TYPES` 仍含 `mindmap` / `api`，H5 阅读页会显示「体验有所下降，建议在桌面版编辑」
  的蓝条。导图现在已支持原生清晰缩放，是否撤下这条提示待定。
- 甘特 `canWrite → progressEditable` 的接线（阅读态仅可改进度）仍未在产品侧放开。
