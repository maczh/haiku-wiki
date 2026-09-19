# 甘特图左右面板可折叠隐藏（v7）

## 需求
甘特图左侧表格与右侧进度条（时间轴）均改为可折叠/隐藏。

## 实现
### 布局结构（真实 DOM 探针确认）
SVAR 甘特图的分隔容器是 `.wx-layout`（`display:flex; flex-direction:row`），三个直接子项：
- 左表格面板：`.wx-layout > .wx-table-container`（`flex: 0 0 <gridWidth>`，含 `.wx-table`）
- 中间分隔条：`.wx-layout > .wx-resizer`（4px）
- 右时间轴面板：`.wx-layout > .wx-content`（`flex: 0 1 auto`，内含 `.wx-area`）

### 折叠逻辑（GanttChart.tsx + gantt.css）
- 组件新增 `leftCollapsed` / `rightCollapsed` 两个 state（默认 false）。
- 根节点按状态追加 `hk-gantt-left-collapsed` / `hk-gantt-right-collapsed` class。
- CSS 折叠规则：
  - 左折叠：`.wx-table-container{display:none}` + `.wx-resizer{display:none}` + `.wx-content{flex:1 1 auto;min-width:0}`（时间轴填满剩余宽度）。
  - 右折叠：对称隐藏 `.wx-content` + `.wx-resizer`，`.wx-table-container{flex:1 1 auto}`（表格填满）。
- 四角浮按钮（z-index:60，高于气泡）：
  - 两侧都可见时：左上「隐藏左侧表格」、右上「隐藏右侧时间轴」。
  - 左折叠后：左上出现「展开左侧表格」；右折叠后：右上出现「展开右侧时间轴」。
- **同一时刻至少保留一个面板可见**：当一侧已折叠，另一侧折叠按钮隐藏（避免整图空白）。

## 验证结果（全绿）
| 环节 | 结果 |
|------|------|
| 类型检查 `tsc --noEmit` | 0 |
| 前端构建 `npm run build` | 0 |
| 内嵌刷新 + Go 编译 `cd server && go build` | 0 |
| 折叠功能 `gantt-fold-check.sh` | **18/18**（GANTT_FOLD_OK） |
| 端到端 `gantt-v3-check.sh` | **37/37** |
| 后端回归 `gantt-api-check.sh` | **21/21** |

折叠关键证据：
- 左折叠：左表格 `display:none`、分隔条 `none`、时间轴宽 **871→1316**（填满）。
- 右折叠：右时间轴 `display:none`、分隔条 `none`、左表格宽 **440→1315**（填满）。
- 展开后两侧均恢复 `flex`/可见。
- 折叠态悬停气泡仍正常（v6 修复无回归）。

## 设计取舍
- 不修改 SVAR 内部代码，纯用外层 class + CSS 覆盖，零侵入、易维护。
- 折叠状态为组件内 state，随文档切换（外层 key 重挂载）自然重置，未做持久化（非需求项）。
- 复用 `.wx-layout` 直接子项选择器，精确到面板级，不影响 SVAR 其它内部元素。
