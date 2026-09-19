# 甘特图列宽固定验证报告（v5）

## 需求
用户反馈：甘特图左侧表格各列宽度不允许自动调整列宽，特别是任务名称这一列。

## 改动（已落盘 + 编译 + 端到端验证）
1. `web/src/components/gantt/GanttChart.tsx`：`init` 内 `api.intercept('resize-column', () => false)` 拦截拖拽表头分隔线改列宽。
2. 任务名称列 `id:'text'` 去 `flexgrow`，固定 `width:176`（阅读态 L110 / 编辑态 L121 两处）。
3. `web/src/components/gantt/gantt.css`：`.wx-header .wx-cell { cursor: default !important }` 表头禁用 resize 光标。

## 原理
SVAR grid 宽度 = 各列 `width` 之和（源码 `react-gantt/dist/index.es.js` 的 `tt(re)`/`o(tt(re))` 证实）；去 `flexgrow` 不会新增右侧空白；`resize-column` 即拖拽改列宽的 action，拦截即禁用交互。

## 构建链路
- 类型检查：`./web/node_modules/.bin/tsc --noEmit` → 0
- 前端：`mv web/dist` 让位 → `npm run build` → 0（GanttChart 独立 chunk ≈265KB；入口 `index-*.js` 甘特关键词计数 0，分包未破坏）
- 刷新内嵌：`server/internal/static/dist`（保留 .gitkeep）
- 后端：`cd server && go build -o /home/macro/.workbuddy/tmp/haiku-wiki ./cmd/server` → 0
  - ⚠️ go.mod 在 `server/` 子目录，根目录执行会报 `cannot find main module`

## 验证结果
- `gantt-v3-check.sh`：**37/37**
  - 新增列宽断言通过：任务名称列 `first=min=max=176px` + 表头 `cursor=default`
  - 其余 36 条（优先级列 P1/P5/P8/P10、进度条上下外框 alpha 0.16/0.41/0.72、状态灯、悬停气泡含描述/负责人、自由输入负责人、落库、导出 md/xlsx 含负责人/状态/优先级/描述列、阅读态仅进度可改）全绿
- `gantt-api-check.sh`：**21/21**
  - 建库 / 建 gantt 文档（doc_type 未被静默降级）/ PATCH·GET 落库 / 导出 md·xlsx·json 全绿，无回归

## 关键证据
任务名称列三行宽度一致（176 / 176 / 176），证明列宽已固定、无 `flexgrow` 拉伸空白；表头 `cursor=default` 证明 resize 交互已禁用。

## 截图
- 编辑态：`/home/macro/.workbuddy/tmp/gantt-v3-out-*/01-edit.png`
- 阅读态悬停气泡：`/home/macro/.workbuddy/tmp/gantt-v3-out-*/03-read-tip.png`
