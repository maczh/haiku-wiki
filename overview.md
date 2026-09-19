# 甘特图：折叠右侧时间轴后左侧表格丢行 —— 已修复

## 问题
用户反馈：右侧时间轴面板折叠隐藏后，左边表格里的任务变少了（截图只剩 2 行，未折叠时有 8 行）。

## 根因
左表格的行**不是自己虚拟化的**，而是按右侧时间轴的可见区切片渲染的
（`tasks.slice(area.start, area.end)`，`area` 由时间轴测量得出）。
上一版折叠是把时间轴 `display:none` 藏起来 → 它的高度测量归零 → 可见区收缩 → 左表格只剩 2 行。
探针实测：右面板可见时 12 行，`display:none` 后 **2 行**。

## 改动
1. **折叠改走 SVAR 原生 `displayMode`**（`GanttChart.tsx`）
   `all` = 左右并排 / `grid` = 隐藏右侧时间轴 / `chart` = 隐藏左侧表格；
   点击按钮调 `api.exec('set-display-mode')`，并监听同一 action 回读状态（与 SVAR 自带展开箭头双向同步）。
   被折叠面板只是被压成 0 宽，**仍参与布局与测量**，因此行数据完整。
2. **`gantt.css` 收尾**：删掉 `display:none` 折叠规则；把编辑态残留的 37px「+」列一并收干净；
   补上 SVAR resizer 展开箭头的字形兜底（图标字体未随包发布，否则是个点不动的空框）。
3. **顺带修掉一个既有缺陷**：Willow 主题包装层 `.wx-theme` 在 SVAR 全部 CSS 里没有任何样式，
   高度链断在这里 → `.wx-gantt` 的 `overflow-y:auto` 形同虚设，30 行时图表被内容撑到 1092px
   塞进 718px 容器，下侧行看不到也滚不到。补 `.hk-gantt .wx-theme{height:100%}` 后纵向滚动恢复。

## 验证（本地生产形态：构建 → embed → go build → 浏览器端到端）
- 折叠套件 **30/30 绿**：右折叠后表格 23 → 23 行（旧实现在此断言上 12 → 2）、时间轴 845 → 0 宽且非 `display:none`、
  左表格铺满 1286；折叠态滚动到底 `scrollTop=136/136` 且首行随之变化；展开后几何逐像素还原；控制台 0 错误。
- 回归：`gantt-v3-check.sh` **37/37**、`gantt-api-check.sh` **21/21**、`gantt-edit-hover.sh` **3/3**；
  `tsc --noEmit` 零错误。

## 文件
- `web/src/components/gantt/GanttChart.tsx`、`web/src/components/gantt/gantt.css`
- 报告：`gantt-fold-rowloss-fix.md`；验证脚本：`/home/macro/.workbuddy/tmp/gantt-fold-check.sh`（v8）

## 备注
`.vsdx` 等无关能力未改动。改动已本地提交，`git push` 仍需用户侧 GitHub 凭据。
