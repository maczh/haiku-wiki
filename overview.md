# 文档模板观感重做（「富有美感的专业模板」）

> 起于用户反馈：**「你生成的文档模板实在太丑了，太不用心了，给我重新整一批富有美感的专业模板来」**

## 三项已确认决策

| 决策 | 选择 | 落地含义 |
| --- | --- | --- |
| 正文风格 | **示例内容填充** | 写成真实可读的专业文档，顶部一行「填写说明」；**禁止** `【…】`/`____` 填空占位 |
| 改造范围 | **全部 136 个** | 54 文档 + 39 脑图 + 38 表格 + 5 甘特，避免画廊新旧混搭 |
| 排版样式 | **同步升级（全局）** | 阅读态新增一层排版主题，模板与既有文档一起变好看 |

## 改造前后（无头 Chrome 生产形态实拍）

| 类型 | 改造前的问题 | 改造后 |
| --- | --- | --- |
| **文档**（54） | 整篇 `【____】` 填空表单，没有真实内容；衬线大字标题；表格默认灰头 | 真实编号/负责人/周期 + 完整章节 + 提示块 + 流程图；表格有表头底色、斑马纹、圆角外框 |
| **表格**（38） | 只用单元格级底色，无 merge/边框/列宽/冻结/合计样式；画布有 100 行空白网格 | 合并标题带 + 表头浅底加粗 + 全表细边框 + 金额列右对齐两位小数 + 合计行强调线 + 首行冻结；画布收紧 |
| **脑图**（39） | 库默认绿色主题（无 `theme` 字段）；预览弹窗里 fit 算错，根节点与首尾分支被裁到框外 | 4 套色卡完整主题快照（墨蓝/青玉/绛玫/石墨）+ 预览 fit 修复，整张图完整居中可见 |
| **甘特**（5） | 日期写死 2026-01~03，在 09-22 基准日下**全屏「已超期」红点** | 排期平移到基准日附近，状态呈「正常进行中 / 已结束 / 未开始」混合；状态列加宽避免换行 |

完整对比审阅页：`.workbuddy/templates-review/before-after.html`（自包含，含 4 组前后截图 + 阅读态排版实拍）。

## 工程做法

先逐一摸清三种数据格式的样式能力边界（Luckysheet 的 `config`、simple-mind-map 的 `setThemeConfig` 全量替换语义、SVAR 甘特的 `taskStatus` 推导口径），据此选择 **「源文件 + 生成器 + polish 脚本」**，而不是手改 136 个 JSON。

**新增工具**
- `tools/templates/gen.py` — markdown 模板生成器。源文件 `server/internal/repository/templates/_src/<目标json名>/<NN-名字>.md`（front matter 仅 `name`）。安全设计：`--prune` 才允许删除条目；源未补齐时整文件跳过并列出缺失项；正文含 `【…】` 直接报错；`--check` 只校验不写。
- `tools/templates/polish.py` — 结构化三类美化（`sheet` / `mindmap` / `gantt` / `all`）。幂等靠 `config.hkStyle` 版本号；改样式逻辑须先 `git checkout -- templates/*.json` 回滚原始数据（表格插标题行是行下移变换，不可重复施加）。
- `tools/templates/gen-mindmap-themes.mjs` — 以库默认主题为基准 `deepMerge` 产出 4 套完整色卡快照，**同源产出**模板用 `mindmap-themes.json` 与编辑器预设 `web/src/components/editor/mindmap/mmThemePresets.generated.ts`（保证编辑器主题面板能认出模板主题）。

**新增内容**
- `server/internal/repository/templates/_src/` — 54 篇 markdown 源文件，7 个业务目录。
- 统一素材池（跨模板零复用）：星澜科技；林珂 / 周敏 / 徐一鸣 / 陈嘉禾 / 赵晓岚 / 吴桐 / 郑亦航 / 孙倩…；星河数据中台 / 云枢 CRM / 澄川供应链 / 岚图门户 / 远岚 App。

**全局排版主题**
- `web/src/components/reader/reader.css` 顶部新增约 300 行，作用域 `.doc-content`（阅读态 + 模板预览共用，**编辑器不受影响**）：标题强调色竖条/圆点、表头底色 + 斑马纹 + 圆角外框、提示块左侧强调条、分隔线 / 清单 marker / 代码块 / mermaid 容器统一。

## 顺带修复的既有缺陷

1. **`MindmapView.tsx` 预览裁切** — 单次 `mm.view.fit()` 在 Modal 入场动画期间算错容器尺寸。改为「`node_tree_render_end` fit + 320/760ms 两次延时 fit + `ResizeObserver`（变化 >2px 才 rAF refit）」。
2. **`GanttChart.tsx` 状态列换行** — `width: 92` 容不下 5 字文案「正常进行中」，被折成两行撑高行距。加宽到 108 并加 `whiteSpace: nowrap`（阅读态 / 编辑态两处列定义）。
3. **`polish.py` 未回写 `content`**（自研脚本真 bug）— `content` 是 JSON 字符串时解析出的是副本，只改副本不回写等于没改，「通知签收表」因此漏美化。已在末尾补 `tpl["content"] = data`。

## 验证总账

| 项目 | 结果 |
| --- | --- |
| 模板总量 / 类型分布 | 136 个：54 文档 / 39 脑图 / 38 表格 / 5 甘特，(category, doc_type, name) 三元组**唯一无丢失** |
| `gen.py --prune` 幂等复跑 | 无变化 |
| 源文件自检 | 54/54 名称与 JSON 零偏差、无 `【…】`/`____` 占位、围栏成对 |
| `polish.py` 覆盖 | 38 表格 `config.hkStyle==1` 全通过；39 脑图均有完整 39 键 theme；5 甘特状态混合（正常 8 / 已结束 12 / 未开始 56，无满屏超期） |
| `tsc --noEmit` | 零报错 |
| `vite build` + embed + `go build` | 通过；入口 CSS `grep -c vditor` = **0**（按需加载未破），embed 目录 3033 个文件 |
| 回归 `run-all.sh`（12 套） | **293/293 全绿**：embed-prod-check / e2e-folder-dir / e2e-dashboard / ui-doc-types / gantt-fold-check / gantt-fold-edge-check / gantt-api-check / gantt-ui-check(30) / check-lazy-routes / check-route-fallback / ui-shot / mermaid-render-check |
| 无头 Chrome 实拍 | 四类模板 before/after 对比全部改善；阅读态表格 / 提示块 / 清单 / 代码块样式生效 |

### 顺带修活的过期套件

`gantt-ui-check.sh` 第 1 段原有 2 条断言盯着**旧 UI**（顶层「新建文档」菜单项、第二步可选的「文档类型」下拉），自上一轮新建入口改造后一直红着、无人察觉（该套件不在当时跑的 6 套名单里）。本次按新链路重写为 8 条断言：菜单含「新建」「导入」+ 旧顶层项已移除 + 「新建」子菜单含「甘特图」+ 点类型先开模板画廊（含空白文档卡）+ 进入「选择位置」+ 第二步只读 Tag 且无 Select。套件由 25 项（2 红）→ **30/30 全绿**。

## 提交

commit `7b8d005`（85 files changed, 40543 insertions(+), 10230 deletions(-)）。提交前发现根目录混入 `haiku.tar`（`docker save` 导出物，179MB）与 `tools/templates/__pycache__/`，已从提交剔除并在 `.gitignore` 补 `*.tar` / `__pycache__/` / `*.pyc`；`git reflog expire + gc --prune=now` 回收，`.git` 由 217MB 回到 36MB。

## 使用方式（给后续维护者）

```bash
# 改 markdown 模板：编辑 _src 下的 .md，然后
python3 tools/templates/gen.py --prune      # 不加 --prune 不会删除条目

# 改表格/脑图/甘特样式：改 polish.py 里的样式常量并递增 SHEET_STYLE_VERSION
git checkout -- server/internal/repository/templates/*.json
python3 tools/templates/polish.py all

# 改脑图色卡：改 gen-mindmap-themes.mjs 后
cd web && node ../tools/templates/gen-mindmap-themes.mjs

# 构建生产形态
bash tools/build/build-embed.sh
```

## 相关约定（已写入 `.workbuddy/memory/MEMORY.md`）

- markdown 模板**不要手改 JSON**，一律走 `_src` + `gen.py`。
- `polish.py` 改样式前必须 `git checkout --` 回滚原始数据并递增 `SHEET_STYLE_VERSION`。
- 脑图 `theme` 必须存**完整快照**（`setThemeConfig` 是整份替换语义）；模板色卡与编辑器预设必须由同一 mjs 同源生成。
- 阅读态排版主题在 `reader.css` 顶部，H2/H3 的 `::before` 必须排在 22px 折叠箭头之后；表格必须覆盖 Vditor 默认的 `display: block`。
