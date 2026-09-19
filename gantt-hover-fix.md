# 甘特图悬停气泡回归修复（v6）

## 现象
阅读/编辑态下，只有最顶部第一个任务的进度条悬停能弹出「描述/负责人/时间」气泡，
其余任务悬停不弹（用户反馈：「除了最顶部的第一个任务进度条可以悬停弹气泡，其他不弹」）。

## 根因（真实浏览器探针复现，铁证）
光标正下方的「顶层元素」常常**不是** `.wx-bar` 的子节点，而是 gantt 的**祖先容器**
（探针实测：任务 3 进度条中心坐标 `elementFromPoint` 命中了 `.hk-gantt` 的父级 flex `DIV`）。
- 原实现用 React `onMouseMove` —— 这是**冒泡阶段**监听在 wrapper `<div>` 上。
- 当真实顶层元素落在 wrapper 的**祖先**之上时，事件只向上冒泡（远离 wrapper），**根本到不了 wrapper 的监听器** → 该任务悬停永远不触发。
- 任务 1/2 的顶层元素恰好落在 bar 内的 `.wx-content` 上（在 wrapper 内），所以冒泡能到达 → 正常弹。
- 表现即「只有最顶部/部分任务能弹」，**取决于光标正下方那一个像素点的真实最顶层元素，而非 bar 的矩形区域**。

> 此前 `gantt-edit-hover.sh` 验证是**假阳性**：它 `bar.dispatchEvent(mousemove)` 直接派发在 bar 上，
> `e.target` 恒为 bar，永远命中 → 漏掉了该回归。本次已把测试改为向真实 `elementFromPoint` 顶层元素派发。

## 修复（GanttChart.tsx）
1. 悬停监听从 `wrapper.onMouseMove`（React 冒泡）改为 **`document` 捕获阶段**：
   `document.addEventListener('mousemove', onMove, true)`。**捕获阶段从 document 向下派发，无论光标正下方是谁都必触发**，彻底脱离「事件是否冒泡到 wrapper」的假设。
2. 命中测试由 `e.target.closest('.wx-bar')` 改为**矩形包容**：遍历所有 `.wx-bar`，指针坐标落在哪个 bar 的 `getBoundingClientRect` 内就命中哪个 —— 与「顶层元素是不是 bar 子节点」彻底解耦。
3. 保留 `tipBarRef` 同条内只跟随光标、跨条才重算，避免抖动；无附加信息不打扰。
4. 监听挂 `rootRef`（`.hk-gantt`）/`wrapRef`（相对定位容器）上，卸载时 `removeEventListener` 清理。

## 验证结果（全绿）
| 环节 | 结果 |
|------|------|
| 类型检查 `./web/node_modules/.bin/tsc --noEmit` | 0 |
| 前端构建 `npm run build` | 0（GanttChart 独立分包正常） |
| 内嵌刷新 `server/internal/static/dist` | 已同步 |
| Go 编译 `cd server && go build` | 0 |
| 真实悬停探针（3 任务） | 任务A30% / 任务B40% / **任务C0%**（任务3 此前卡在 B，已修正） |
| 强化多任务悬停测试 `gantt-edit-hover.sh` | **3/3**（派发到真实顶层元素） |
| 端到端 `gantt-v3-check.sh` | **37/37** |
| 后端回归 `gantt-api-check.sh` | **21/21** |

## 关键教训（写入 gantt 构建验证 skill 备查）
- SVAR 甘特图里 bar 之上常盖着透明行容器/祖先 flex 容器；**不能依赖 `e.target` 是 bar 子节点**判断悬停。
- React `onMouseMove` 是冒泡监听，真实顶层元素落在组件祖先之上时事件到不了 → 改用 `document` 捕获监听 + 矩形命中测试。
- 悬停类验证必须派发到 `elementFromPoint` 真实顶层元素，否则假阳性漏掉「只有部分任务能弹」这类回归。
