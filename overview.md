# 寄海文库：文库工作台（书页空态）+ CAD 字号修复 + 移动/复制收尾

本轮交付用户反馈的四件事：

1. **文库首页不显示 `0000`、标题不显示 `00`**（React 数字 0 短路渲染 bug）；
2. **文库工作台**：用户红框圈的是 **知识库页（`/books/:id`）未选中文档时的右侧空态** ——
   此前只有一句「从左侧选择一篇文档」，现在是一整面文库工作台；
3. **目录树拖拽 + 右键移动/复制**（多级子目录、跨知识库）；
4. **DWG→SVG 预览文字过大、导出糊成一片**。

> 上一版 `overview.md`（目录功能 + 回归套件收尾）已随提交进入 git 历史，
> 用 `git log -p -- overview.md` 回看。

---

## 一、`0000` / `00`：React 把数字 0 当合法子节点

根因唯一：`BookPage.tsx` 的 `Number(searchParams.get('docId') || 0)` 在未选中文档时返回**数字 0**，
下游 `{docIdParam && <X/>}` 短路成 `0`——React 视数字为合法子节点，渲染成文本。
工具条 2 处 + 正文区 4 处 = 截图里的 `00` 与 `0000`。

修法：未选中时返回 `undefined`（`docIdParam`），全仓 grep 确认仅此一处危险写法。
回归断言收在 `tools/verify/e2e-book-dashboard.sh`（书页空态裸 0 探针；工作台统计里
的「0」是合法内容、树节点计数徽标同理，探针已排除这两个区域）。

## 二、文库工作台（本轮主需求）

**信息架构**（沿用首页 Dashboard 的优先级，范围严格限定单个知识库）：

```
┌ 概览条: 书名 · N 篇文档 · N 个目录 · N 篇办公文档 · 最近更新 ┐   ┌ 快捷操作: 新建文档/新建目录/导入 ┐
├ 工作台卡: 待办 │ 甘特图 │ 工作日历   ← 本书有才显示,无则整卡隐藏 ┤
├ 文库内搜索(标题+markdown正文) │ 最近更新(最近 8 篇,排除目录) ┘
```

- 后端：`GET /api/workbench?book_id=`、`GET /api/search?book_id=`（同一条可见性口径，仅范围收窄）。
  单库模式**跳过协作者补漏路径**——否则其他库的协作文档会漏进本书卡片。
- 前端：新组件 `web/src/components/dashboard/BookDashboard.tsx`；卡片复用首页的
  `WorkbenchCards`（待办/甘特/日历），聚合口径与首页完全一致（甘特按期长加权、排除 summary，
  日历排除 cancelled）。`dashboard.css` 随组件 import（跨路由 chunk，不能只挂在首页）。
- 搜索结果带 `doc_type` 标签与正文 snippet，点击直接打开文档。

**顺带修一个真缺陷**：`lib/todo.ts isOverdue` 把 `YYYY-MM-DD` 截止解析成当天 00:00，
「今天到期」在当天被判成逾期（首页/工作台的「已逾期」计数双双失真）。改为当天 23:59:59 起算。

## 三、目录树拖拽 / 移动 / 复制

- 目录树节点可拖拽：落节点中部=成为其子文档，落上下缝隙=同级排序（按 rc-tree 的
  `dropToGap`/`dropPosition` 契约换算）；拖拽可跨知识库（落到顶部文库节点）。
- 右键「移动」弹窗：`DocTargetPicker` 二级选择（选库 → TreeSelect 选位置，多级子目录、可选文档作为父级），
  选项构造层就摘除自身子树（防环），`buildDirTree(docs, excludeRootId)`。
- 右键「复制」：同款选择器；后端 `POST /docs/:id/copy` 事务内递归复制整棵子树，
  根节点标题加「 副本」，子节点原样。
- 后端统一校验 `checkMoveTarget`：目标父节点存在且属于目标库、防环（64 层）、附件型文档不可作父。
- Go 单测：`TestMoveToBook`（跨库/指定父/防环/归属）、`TestCopyDocSubtree`（三层递归/正文保真/防环/权限）。
- 修掉一个**事务自死锁**：`copySubtree` 曾在事务内用全局 DB 读子文档，`SetMaxOpenConns(1)` 的测试
  环境下抢不到连接挂死 10 分钟；改为 `ListChildDocsTx(tx, ...)` 事务内读。

## 四、CAD（DWG→SVG）文字字号

- 病灶：① INSERT 组码 43（scaleZ）错写进 scaleY；② DIMENSION 匿名块读不到 → 尺寸标注整类消失；
  ③ 字高 = 实体 height × scaleY × 视口 scale，无 STYLE 固定字高/宽度因子、MTEXT 不折行，
  SVG 渲染还有 `size<6 → 6` 的硬抬升（0.97px 的标注被抬到 6px，密集标注叠成一团糊）。
- 修复：解析层补组码 41/43/7/71、STYLE 表（固定字高 40 / 宽度因子 41）、`$MEASUREMENT` 等；
  渲染层按文本框测宽自动折行、字号双向钳制，SVG 与 PNG 两条路径同步。
- 测试：`cad_text_qa_test.go` 新增比例不变量断言（并实证旧代码下确实失败）；
  非浏览器探针 `tools/verify/cad-render-probe.sh` 用真实尺度夹具落 SVG/PNG 目检
  （米制图 19.20px 恒定、场地总平面 0.97~9.31px 且多行说明 5 行互不重叠）。

## 五、验证与状态

| 套件 | 结果 |
| --- | --- |
| `tools/verify/e2e-book-dashboard.sh` | **25/25 全绿**（含裸 0 回归、逾期口径、book_id 限定） |
| `tools/verify/cad-render-probe.sh` | 全绿（单测 + 目检图） |
| `npm run verify:workbench`（`web/scripts/verify-workbench.mjs`，本轮补齐） | 全绿 |
| Go 单测（service：搜索/工作台/复制/移动/置顶） | ok |
| `tsc --noEmit` / `go vet ./internal/...` | 通过 |

**遗留**：
- `e2e-workbench-dnd.sh` 中目录树**拖拽落点的界面探针**尚未全部命中（API 与 Go 层已验证），
  后续可把树内操作探针补齐；
- 用户侧长期遗留：`git push origin master`（本地提交积压中）。
