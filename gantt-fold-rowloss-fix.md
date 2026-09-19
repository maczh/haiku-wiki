# 甘特图折叠隐藏后左侧表格「丢行」缺陷修复

## 现象（用户反馈）

> 右边时间轴面板折叠隐藏后，左边表格面板中表格任务内容减少了。

截图证据：折叠右侧时间轴后，左表格只剩 `IoT系统 / 云端` **2 行**（同一条文档在未折叠时可见 8 行）。

## 根因（DOM 探针复现）

探针脚本 `gantt-rowloss-probe.sh`（30 任务 / 18 任务的对照夹具均可复现）：

| 状态 | 左表格渲染行数 |
| --- | --- |
| 右面板可见（`all`） | **12** |
| 右面板 `display:none`（v7 旧实现） | **2** |
| 右面板 `flex:0 0 0 + width:0 + overflow:hidden`（保持占位） | **12** |

机制（读 `@svar-ui/react-gantt@2.7.3` 源码确认）：

* 左表格**不自己虚拟化**，它的行是「按右侧时间轴的可见区切片」渲染的 ——
  组件内 `V = tasks.slice(area.start, area.end)`，`area` 由**时间轴**测量得出。
* v7 用 `.hk-gantt-right-collapsed .wx-layout > .wx-content { display: none }` 藏起时间轴 →
  它的高度测量归零 → `area` 收缩到 2 行 → 左表格跟着只剩 2 行。

即：**折叠隐藏必须让被折叠面板仍然参与布局与测量**，不能把它从渲染树里摘掉。

## 修法

### 1. 折叠改用 SVAR 原生 `displayMode`（核心）

`web/src/components/gantt/GanttChart.tsx`

* 状态从 `leftCollapsed/rightCollapsed` 两个布尔改为单一 `fold: 'all' | 'grid' | 'chart'`；
* 点击按钮 → `api.exec('set-display-mode', { mode })`；
* `init` 内 `api.on('set-display-mode', …)` 回读为 React 状态（SVAR 自带的 resizer 展开箭头也派发同一 action，双向同步）；
* 库内实现（`react-gantt/dist/index.es.js`）：

  | mode | 左表格容器 | 右时间轴 |
  | --- | --- | --- |
  | `all` | `flex: 0 0 <gridWidth>` | 占满剩余 |
  | `grid`（隐藏右侧） | `flex: 0 0 calc(100% - 4px)` | 被压到 **0 宽**（仍参与测量） |
  | `chart`（隐藏左侧） | `flex: 0 0 0`；编辑态退回 `add-task` 列宽 37px | 占满剩余 |

* 面板折叠不再用 `display:none`，四角浮按钮、`hk-gantt-left/right-collapsed` 类名与交互形态保持不变。

### 2. `gantt.css` 收尾

* 删除 v7 的 `display:none` 折叠规则；
* `.hk-gantt-left-collapsed .wx-layout > .wx-table-container { flex:0 0 0; width:0; border-right:none; overflow:hidden }`
  —— 收掉编辑态残留的 37px「+」列窄条（新增任务入口在顶部工具栏，不受影响）；
* 补 `.wxi-menu-left/right` 字形兜底 —— SVAR resizer 自带展开箭头用的图标字体未随包发布，
  折叠后悬停分隔条会出现「点不动的空框」，现在是 `‹ / ›`。

### 3. 顺带修复：主题层打断高度链，甘特图纵向滚动失效（既有缺陷）

`.hk-gantt .wx-theme { height: 100%; min-height: 0 }`

* Willow 渲染的 `<div class="wx-theme wx-willow-theme">` 在 SVAR 全部 CSS 里**没有任何样式规则**，
  高度链断在这里 → `.wx-gantt{height:100%;overflow-y:auto}` 的 `height:100%` 退化为 `auto`；
* 实测（30 行，阅读态容器 718px）：`.wx-gantt` 被内容撑到 **1092px** 且 `scrollHeight == clientHeight`
  → 既无内部滚动，又被外层 `overflow:hidden` 裁掉，**下侧任务行看不到也滚不到**；
* 补高度链后：`.wx-gantt` = `718 / 1092 / overflow-y:auto`，滚动条回到 `.wx-gantt` 上（与 SVAR 设计一致），
  折叠右侧后依旧能纵向滚动（滚动条挂在 `.wx-gantt`，不依赖时间轴面板）。

## 验证（本地生产形态：前端构建 → embed → go build → 浏览器端到端）

`bash /home/macro/.workbuddy/tmp/gantt-fold-check.sh` — **30/30 绿**（夹具 23 个任务、含 4 个展开的汇总父）

| 断言（节选） | 实测 |
| --- | --- |
| ★ 右折叠后左表格行数不变 | 23 → 23（旧实现在此断言上 12 → 2） |
| 右折叠后时间轴**未被 `display:none`** | `display=flex`，宽 845 → **0** |
| 右折叠后左表格铺满 | 440 → **1286** |
| 折叠态纵向滚动 | `scrollTop=136/136`（滚到底），首行由「IoT系统」变为「RIS点餐系统」 |
| 左折叠：表格收为 0、时间轴 845 → 1286、条形 23 个不变 | ✓ |
| 展开还原 | 表格 0 → 440、时间轴 0 → 845，与折叠前逐像素一致（441/4/845） |
| 编辑态左折叠「+」列残留 | 宽 **0**（原 37px） |
| 折叠态悬停气泡（v6 回归） | 常态/左折叠态均正常弹出 |
| 控制台错误 | 0 条 |

回归套件（全部绿）：

* `gantt-v3-check.sh` **37/37**（列宽固定 / 状态灯 / 优先级外框 / 拖拽改进度 / 落库）
* `gantt-api-check.sh` **21/21**（导入导出 / 版本快照）
* `gantt-edit-hover.sh` **3/3**（向 `elementFromPoint` 真实顶层元素派发）

`tsc --noEmit` 零错误（本次改动文件）。

## 交付物

* `web/src/components/gantt/GanttChart.tsx`：折叠改走 `displayMode`（`set-display-mode` + 状态同步）
* `web/src/components/gantt/gantt.css`：删除 `display:none` 折叠规则、新增「+」列收尾、resizer 箭头字形兜底、主题层高度链
* `/home/macro/.workbuddy/tmp/gantt-fold-check.sh`：验证脚本升级为 v8（相对不变量 + 滚动 + 折叠态气泡）
* 新增探针：`gantt-rowloss-probe.sh`（丢行根因）、`gantt-scroll-probe.sh`（滚动容器）、`gantt-layout-probe.sh`（三面板几何）

## 通用教训

1. **SVAR 甘特的两块面板共享「可见区」**：折叠/隐藏任一侧都不能用 `display:none` ——
   被折叠面板的尺寸测量会归零，另一侧（尤其左表格）会跟着少渲染内容。用原生 `displayMode`。
2. **`.wx-theme` 高度链必须由使用方补**：库不提供该样式，缺了它 `height:100%` 会静默退化为 `auto`，
   表现为「甘特图看不到底部、也滚不动」，且**在你把它塞进固定高度容器前不会暴露**。
3. 探针先于结论：本次两个缺陷（丢行、无滚动）都是「测几何量」发现的，读代码只能猜到其中一半。

## 补充验证：只读态（公开分享页）与两个边界场景

`bash /home/macro/.workbuddy/tmp/gantt-fold-edge-check.sh` — **22/22 绿**
（走真实公开分享链路：`PUT /api/docs/:id/share` 建分享 → 清掉 localStorage 登录态 → 匿名打开 `/doc-share/:slug`，
该页经 `DocContent` 渲染 `GanttView` 且 `progressEditable=false` → `mode='readonly'`）

| 断言（节选） | 实测 |
| --- | --- |
| ★ 只读态右折叠后表格行数不变 | 23 → **23** |
| 只读态右折叠：时间轴非 `display:none`、压到 0 宽、表格铺满 | `display=flex` / 0 / 440 → **1546** |
| **折叠态窗口缩放**（1600×1000 → 1180×760） | 时间轴仍 0 宽、表格仍铺满 1126；表格渲染 19 行（视口变矮，可见窗口本就变小，未退化） |
| **快速切换**（折叠→展开→折叠，间隔 150ms） | 终态 `right-collapsed=true`、时间轴 0 宽、仅 1 个展开按钮、行数 23 |
| **极限连点 6 轮**（同一 JS 内混合点击） | 类名/宽度/按钮三者自洽（`false` / 1105 / 2），无 React 状态与 store 脱 sync |
| 只读态左折叠：表格 0 宽、时间轴铺满、条形 23 个不变 | ✓ |
| 控制台错误 | 0 条 |

> 断言口径提醒：渲染行数是**可见窗口高度的函数**（视口 1000 时 23 行、视口 760 时 19 行，两者都正确），
> 所以这里全部用「折叠前后相等 / 未退化为 2 行」这类相对不变量，不写死行数。
