# H5 手机版阅读态：六项反馈修复与实测

> 2026-09-23 ｜ 生产形态二进制 + 无头 Chrome（移动视口 390×844）
> 回归：`bash tools/verify/h5-reader-check.sh` → **52 项全绿（H5_READER_CHECK_PASS）**
> 连带回归：桌面甘特三套（fold / fold-edge / ui）→ **82 项全绿（ALL_SUITES_PASS）**
>
> 覆盖 7 段：①底部空白 ②③画布缩放/划屏 ④只读表格白屏 ⑤接口&甘特 H5 布局
> ⑥PPTX 全屏 ⑦**分享阅读模式（`/share/:slug`、`/doc-share/:slug`）**

## 结果一览

| # | 反馈 | 结论 | 关键改动 |
| --- | --- | --- | --- |
| 1 | 正文与底部工具条之间有多余空白 | ✅ 已修（实测间隙 = 0px） | `h5/MobileLayout.tsx` 去掉 `<main>` 多余的 `paddingBottom` |
| 2 | 思维导图 / PDF / DOCX 不支持双指缩放 + 单指拖动 | ✅ 已修 | 新增 `h5/H5ZoomStage.tsx`，`h5/H5DocContainer.tsx` 加 `zoomable` |
| 3 | 双指缩放后划屏滚动失效 | ✅ 已修 | `H5ZoomStage` 手势状态在 touchend 清空 + `touch-action` 复位 |
| 4 | 阅读态表格卡「渲染中」/ 空白 | ✅ 已修（根因级） | `reader/SheetView.tsx` 全局 `localforage` 兜底 + refresh 早刷防护 |
| 5 | 接口文档 / 甘特图 H5 **阅读**布局 | ✅ 已修 | `editor/ApiEditor.tsx` 左栏离屏抽屉；`reader/GanttView.tsx` 满屏 + `fill` |
| 5b | 接口文档 / 甘特图 H5 **分享**布局 | ✅ 已验证（第七段 26 项） | `h5/pages/{MShare,MShareDoc}.tsx` 单栏沉浸 + 抽屉目录（免登录） |
| 5c | 补充：手机端甘特**看不到甘特条** | ✅ 已修（回归中发现） | `components/gantt/GanttChart.tsx` H5 挂载后切「只显示时间轴」 |
| 6 | PPTX H5「全屏模式」失效 | ✅ 已修 | `reader/PptxView.tsx` 用 portal 伪全屏兜底 iOS |

## 关键决策

1. **手势层零侵入**：`H5ZoomStage` 只在 `scale > 1` 时接管单指；默认 `touch-action: pan-y` 让浏览器原生纵向划屏照常工作 —— 既解决了「要缩放」，也没有引入「预览区吞掉划屏」。必须用原生 `addEventListener({passive:false})`，React 的 `onTouch*` 在根容器上是 passive，`preventDefault()` 无效。

2. **表格白屏是根因修复，不是绕过**：反编译 `luckysheet.umd.js.map` 定位到 `ini()` 被 `localforage.getItem(cahce_key).then(...)` 包裹且**没有 `.catch`** —— 移动端存储不可用（隐私模式 / 微信 WebView）时 promise reject，`ini()` 永不执行，网格不渲染、白色遮罩 `#luckysheetloadingdata` 不移除。修法是给全局 `window.localforage` 装一个**永不 reject、且 promise/callback 两种调用形式都回**的兜底（`clearcachelocaldata` 用的正是 `removeItem(key, cb)` callback 形式）。

3. **PPTX 全屏走 portal**：H5 下 `PptxView` 被 `H5ZoomStage` 的 `transform` 包裹，非 portal 的 `position: fixed` 会相对该 transform 定位；`createPortal(document.body)` 让 `fixed` 正确相对视口。顺带修了 portal 重挂载后 `ResizeObserver` 仍盯旧节点、读到 0 宽把比例压到 10% 下限的问题。

4. **测试钩子**：给新结构加了 `data-h5-doc`（含 `data-h5-zoomable` / `data-h5-fill`）、`data-h5-zoom`、`data-h5-main`、`data-h5-tabbar`，让回归断言不依赖脆弱的样式选择器。

5. **手机端甘特必须默认「只显示时间轴」，且只能在挂载后切换**（回归过程中发现的真问题，值得单列）：
   - 现象：H5 打开甘特，只读列宽合计 **726px**（176+100+108+74+96+68+104），390px 视口下左表格把右侧时间轴挤成 **0 宽** —— 手机上「看不到甘特条」。
   - 修法：H5 下挂载后执行 `set-display-mode='chart'`（只显示时间轴，四角「›」可切回任务表）；桌面维持左右并排。
   - ⚠️ **踩过两次坑（都实测无效）**：`useState('chart')` 初值 + 在 `init` 里同步 exec；以及把 exec 延到双 rAF / 400ms。
     两者都会让时间轴刻度渲染出 **0 个单元格**（`.wx-scale` 只有两条空行，有甘特条却没日期）。
     根因是「DOM 已折叠、SVAR 仍以为在 `all`」下完成首次测量，可视区（xArea）退化且不再自愈；
     必须等挂载后走一次**真正的 all→chart 切换**（与用户点按钮同一条路径）才正常：
     `cells=1「2026 年 9 月」+ cells=8「9/22…」`。回归里加了「时间轴有日期文案」断言锁住。

## 改动文件

- 新增：`web/src/h5/H5ZoomStage.tsx`、`tools/verify/h5-reader-check.sh`
- 修改：`h5/MobileLayout.tsx`、`h5/H5DocContainer.tsx`、`h5/BottomTabs.tsx`、`h5/styles.ts`、
  `h5/pages/{MDoc,MShare,MShareDoc}.tsx`、`components/reader/{SheetView,ApiView,GanttView,PptxView}.tsx`、
  `components/editor/ApiEditor.tsx`、`components/gantt/GanttChart.tsx`、`tools/verify/run-all.sh`

## 验证

- `tsc --noEmit`：**0 错误**（`web/node_modules` 已完整，无需过滤缺失模块）。
- `bash tools/build/build-embed.sh`：**ALL_OK**（生产二进制 137,804,747 B，embed 3425 文件 / 109M）。
- `bash tools/verify/h5-reader-check.sh`：**52/52 通过**，含现场用 `pptxgenjs` 生成 .pptx 上传后点全屏的端到端用例。
- 桌面回归：`gantt-fold-check` 30 + `gantt-fold-edge-check` 22 + `gantt-ui-check` 30 = **82/82 通过**
  （`GanttChart.tsx` 改动的桌面侧无回归）。
- 截图见 `deliverables/h5-reader-2026-09-23/`（11 张 H5 + 1 张桌面甘特对照）。

## 分享阅读模式（#5「分享」）验证明细

分享页是**免登录**的，因此该段先 `localStorage.removeItem('hk_token')` 再打开，确保验的是真实匿名访问。

**书级分享 `/share/:slug`**（新建「H5回归-分享库」→ 只放一篇思维导图 → `PUT /api/books/:id/visibility` 设 public 取 slug）：

| 断言 | 实测 |
| --- | --- |
| H5 分享页容器 `[data-h5-doc]` | true |
| 匿名可读（顶栏显示文库名） | true |
| 无底部工具条（分享页不该有 Tab） | false（正确） |
| 导图 `data-h5-zoomable` | 1 |
| 导图已渲染 `.smm-container` | true |
| 正文主区铺满到视口底部（无空白） | true |
| 点目录 → 抽屉展开 + 抽屉内 `.tree-row` | true / true |
| 切桌面模式 → 仍是桌面 SharePage 且可读 | true / true |

**文档级分享 `/doc-share/:slug`**（`PUT /api/docs/:id/share` 生成 slug）：

| 断言 | 实测 |
| --- | --- |
| 接口文档：H5 容器 / 匿名可读标题 / 无 Tab | true / true / false（正确） |
| 接口文档：目录按钮存在 + 左栏初始离屏收起（left=-320） | true / true |
| 接口文档：点按钮 → 抽屉遮罩出现 | true |
| 甘特图：`data-h5-fill` = 1、`.wx-gantt` 面板存在 | 1 / true |
| 甘特图：默认折叠左表 + 刻度有日期文案 + 甘特条在视口内 | true / true / true |
| 只读表格：网格存在 + 遮罩已清除 + 画布非零尺寸 + 无 Tab | true（「#4 兜底」与「#5 分享单栏」的组合用例） |
| 表格/接口/甘特三类分享页均无底部 Tab | 均正确 |

结论：**同一分享 URL 在手机模式与桌面模式各走各的路由**（`App.tsx` 里 `mode==='h5'` 一律交给 `H5Router`，
由 `H5Router` 在「非 `/m` 收口」之前拦截 `/share/`、`/doc-share/` 前缀），因此无需为手机单独换分享路径；
桌面分享页未被 H5 化影响（已断言）。

## 后续（未做）

- `h5-reader-check.sh` 已登记进 `tools/verify/run-all.sh`（固定端口 **8177**，插在 `sim-docker-web` 之前）。
- **甘特有写权限时 H5 仍显示「只读」**：`MDoc` 只透传 `canWrite`，而 `GanttView` 读取的是 `progressEditable` →
  H5 下恒为 readonly（既有行为，非本轮引入）。若希望手机端也能拖动进度条，需在 H5 阅读入口把
  `canWrite` 接到 `progressEditable`（属需求确认项，未擅自改）。
- **提示文案一致性（建议你拍板）**：`h5/styles.ts` 的 `H5_DEGRADED_TYPES` 里仍含 `mindmap` 与 `api`，
  于是刚做完 H5 优化的这两类文档在手机端顶部仍会显示「该类型在手机端阅读体验有所下降，建议在桌面版查看」
  （截图中可见）。缩放/抽屉布局已就位，这条横幅有点自相矛盾；若认可，把 `mindmap`、`api` 从降级名单里
  摘掉即可（一行改动，未擅自动产品文案）。
- 真实 iOS / 微信内核上的双指手势与 PPTX 全屏建议做一次真机复验（无头 Chrome 无法完全等价）。
