# 新增模板：45 个 draw.io 绘图 + 160 个 mermaid 流程图

## 需求与交付

| 需求 | 要求 | 交付 |
| --- | --- | --- |
| draw.io（绘图文档）模板 | ≥ 40 个不同场景，制作精美 | **45 个**（业务流程 14 / 系统架构 14 / 分析决策 9 / 关系与结构 8） |
| 流程图文档类 mermaid 模板 | 八种图型各 ≥ 20 个（共 160），制作精美 | **160 个**，八种图型**各 20 个** |

八种图型：流程图 / 时序图 / 类图 / 甘特图 / ER 图 / 时间线图 / 饼图 / 思维导图。
内置模板总数 161 → **366**。

## 关键决策

- **绘图模板必须同时产出 XML 与矢量 SVG**。绘图文档正文契约是 `{version,xml,svg}`：阅读页/分享页/模板预览只渲染 SVG（不加载 37MB drawio 资源），编辑页才用 XML。只给 XML 会显示「尚未生成矢量预览」。
- **用程序化体检替代肉眼审图**。45 张图人工审阅不现实，且大画布截图容易失败，因此把版式规则写进引擎：越界 / 重叠 / 组标题留白 / 重复 id / 连线端点缺失 / 文本溢出 / **连线穿框**（用 Liang–Barsky 真实线段裁剪，而不是包围盒——斜线会大量误报）。
- **自动化只做 mermaid 语法校验，观感交给真实浏览器**。jsdom 没有排版引擎（缺 `getBBox`/`getComputedTextLength`），`mermaid.render` 在 jsdom 下整片失败——实测八种图型只有 `pie` 能渲染。因此自动化跑 `mermaid.parse`，观感由 `preview-flowchart.py` 生成联系表 + 无头 Chrome 截图复核。

## 顺带修掉的既有缺陷

1. **356 处填空占位符出现在用户可见的模板正文里**。`work-plan` / `engineering-construction` / `software-project` / `project-management` 4 个 JSON 与源文件不一致：源已改成真实示例内容，JSON 却从未重新生成，正文仍留着 `【____】`、`关键人员 __ 可能被动离职`、`压到 ____ TPS 目标`、`超 ____% 触发预警` 等 222 处 `【__】` + 134 处裸下划线。项目约定明令禁止填空占位符——因为这条管线以前没有 CI 校验，一直没人发现。已跑生成器收口。
2. **SVG 出现 `<defs><defs>` 嵌套**。网格 pattern 用 `out.insert(2, "<defs>…")` 单独插入，实际插进了箭头 marker 的 `<defs>` 内部。已改为箭头与 pattern 合并进同一个 `<defs>`，并在生成器和回归套件两处加守卫。
3. **20 个 mermaid 甘特模板整图落在过去**。排期锚在 2026-01~05，mermaid 不会画 today 竖线，观感像一张作废的排期表。按项目既有的基准日约定（`2026-09-22` − 12 天）平移 18 个；「双十一大促」（锚 11-11）、「展会筹办」（跨到 10-14）这类语义绑定固定日历事件的自动识别并保留。
4. **4 组模板同名**（在线教育课程 / 能源抄表计费 / 保险保单理赔 / SaaS多租户权限 在类图与 ER 图两侧同名，画廊里无法分辨）。加「领域模型 / 数据模型」后缀消歧，并加测试固化。
5. **`gen.py` 会误收非 markdown 源目录**（`_src/flowchart`、`_src/drawing`），已加守卫。

## 验证结果

- `bash tools/verify/template-check.sh` → **PASS=6 FAIL=0**（新增套件，已登记 `run-all.sh`）
- `go test ./internal/repository/ -run 'Template|HasNestedDefs'` → 5 个用例全绿；366 个模板名称唯一
- `go build ./...`、`go vet ./internal/repository/` 通过；`gofmt` 无差异
- **端到端**（真实二进制 + 独立 sqlite 库，端口 8156）：注册 → 建库 → 拉模板（drawing 45 / flowchart 160，分类与数量全对）→ 用模板建文档（drawing 1 篇 + mermaid 八图型各 1 篇）→ 回读正文与模板**逐字一致** → 全部通过
- **升级路径**：删掉库里 drawing/flowchart 记录后重启，自动补齐 45 + 160；三次启动幂等（366 行 = 366 个唯一名）
- **视觉复核**：45 张绘图联系表（3 批）+ 八图型 mermaid 联系表（4 批）+ 甘特单图实拍，确认箭头/marker/分组/里程碑/`crit` 红条/today 竖线渲染均正常

## 新增工具

| 文件 | 作用 |
| --- | --- |
| `tools/templates/drawio_kit.py` | 声明式绘图 DSL → mxGraphModel XML + 矢量 SVG 同源渲染；内置 7 类版式校验 + SVG 结构校验 |
| `tools/templates/gen-drawing.py` / `gen-flowchart.py` | 源 → JSON 生成器（含 `--check`） |
| `tools/templates/build-drawing-src.py` | 批量产出绘图源（业务流 / 架构 / 分析 / 结构四套版式助手） |
| `tools/templates/preview-drawing.py` / `preview-flowchart.py` | 渲染联系表 + 无头 Chrome 截图，供人工复核观感 |
| `tools/templates/retime-gantt.py` | mermaid 甘特排期平移 / 校验（幂等，`--check` 供 CI） |
| `web/scripts/check-mermaid.mjs` | jsdom + mermaid v11 逐条 `parse`（空集判失败，防空转） |
| `tools/verify/template-check.sh` | 6 步静态校验，秒级、不起服务 |
| `server/internal/repository/templates_seed_test.go` | 模板契约测试（数量、图型覆盖、分类、正文契约、SVG 结构、名称唯一性、`hasNestedDefs` 反向用例） |

### 视觉证据（`deliverables/templates-2026-09-23/`）

- `drawing-architecture.png`：15 张系统架构类绘图模板（分组分层、扇出连线）
- `flowchart-mindmap-pie.png`：思维导图与饼图各 2 张（八图型另见 4 批联系表截图）
- `gantt-today-marker.png`：平移后的甘特单图，today 竖线落在图内，左侧「已开始」右侧「未开始」

## 备注

- 前端**未改动**（无 `web/src` 变更），因此无需重新构建 dist。
- `go test ./...` 全量跑时 `internal/service` 包会在 `TestReferenceMetaL2RederivesWhenDerivedFileMissing` 处触发 11 分钟超时（413 passed / 0 failed）；该用例单独跑 0.14s 通过，属本环境既有偶发卡顿，与本次改动无关（改动仅在 `internal/repository`）。
- 改动已提交：**`50f34c4`**（231 个文件，+24371 / −554）。提交前 `git status --short` 已逐行核对：无大文件、无构建产物、无 `node_modules`；`.git` 仅从 36M 增至 40M。
