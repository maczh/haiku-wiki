# 思维导图线型选项与间距修复（2026-10-01）

## 一、需求

| # | 需求 | 状态 |
|---|------|------|
| 1 | 红框区域「左右间距过大」（思维导图 / 逻辑结构图（向右）/（向左）三种结构下） | ✅ 根因定位并修复 |
| 2 | 「节点样式」新增边框线型：实线 / 虚线 / 点线 / 点划线 | ✅ |
| 3 | 「基础样式」新增连线线型：实线 / 虚线 / 从粗到细 | ✅ |
| 4 | 「基础样式」新增连接方式：曲线 / 折线 / 直线 | ✅ |
| 5 | 「基础样式」新增箭头：无箭头 / 向内箭头 / 向外箭头 | ✅ |
| 6 | 「基础样式」新增连线色彩：彩色 / 单色（选色盘） | ✅ |

## 二、间距过大：根因不是「参数太大」，是列宽算法选错了

### 实测取证

复现方式：把用户那份「海鲜火锅·包厢预订系统」导图画进临时夹具的 `docId=3`
（`tools/verify/mm-style-shot.sh` 自动完成，只改 `$DATA` 副本，不动仓库夹具），
起单源生产形态服务，用 `agent-browser` 读 `.mm-node` 的屏幕几何。

改动前（屏幕 px，画布 fit 到 37% 时）：

```
定金与退订@x595_w31      ← 内容宽约 94
  分支主题@x686_w25      ← 内容宽约 76，被甩到父右缘之外
分支主题左缘 - 父右缘 = 686 - 626 = 60 px（内容坐标约 182 px）
```

### 根因

`layout.ts` 的 `layoutSide` 用「**本分支该相对深度的最宽节点**」当列宽推进子节点：

```ts
// 改前（右向）
x = parent.x + br.widths[rd - 1] + H_GAP
```

`br.widths[rd-1]` 在同一层只要有一个宽兄弟就会被撑开 —— 本例里同层的
「预订规则：时段、最低消费、超时释放」内容宽约 218 px，而它的兄弟父节点
「定金与退订」只有 94 px。于是**窄父节点下的子节点照吃 218 px 的列宽**，
被推到自己父节点右缘之外两百多像素，视觉上就是红框里那片空白。

用宽列宽还有个副作用：注释里担心的「子宽越父左缘」在**左向**反而会发生，
属于两头不讨好。

### 修法

改成「子节点贴着父节点边缘 + 一个层间距」推进，父宽即列宽：

```ts
// 改后（右向）
x = parent.x + parent.w + H_GAP
// 改后（左向）：子右缘 = 父左缘 - H_GAP，父宽自动约掉，永远不重叠
x = parent.x - H_GAP - w
```

| 指标 | 改前 | 改后 |
|---|---|---|
| `分支主题` 与父节点的水平空白 | 约 182 内容 px | **约 49 内容 px**（≈ 一个 `H_GAP` 58） |
| 同层列对齐 | 靠最大宽度强行对齐 | 同父同级仍自动对齐（同父同宽源），跨父本就不同列 |

`rd === 0`（一级节点）沿用 `rootEdge ± H_GAP`，根节点两侧照旧对称。

## 三、新增的样式选项

### 1. 类型契约（`types.ts`）

| 数据 | 新增字段 | 取值 |
|------|---------|------|
| `MindNodeStyle` | `borderStyle` | `solid` / `dashed` / `dotted` / `dashdot` |
| `BaseStyle` | `linkPattern` | `solid` / `dashed` / `taper`（从粗到细） |
| `BaseStyle` | `linkArrow` | `none` / `inward`（向内）/ `outward`（向外） |
| `BaseStyle` | `linkColorMode` | `auto`（彩色）/ `single`（单色） |
| `LineStyle` | 扩展 | `curve` / `elbow`（折线）/ `straight`（**直线**） |

配套常量数组从组件 `index.ts` 导出：`BORDER_STYLES` / `BORDER_DASH` /
`LINK_PATTERNS` / `LINK_ARROWS` / `LINK_COLOR_MODES`。

**存储零改动**：`MindmapEditor.handleBaseStylePatch` 把整个 `BaseStyle` 写进
`theme.__baseStyle`（`mindmap.smm.ts` 的 `applyBaseToSnapshot`），新增字段自动跟着走；
节点 `borderStyle` 走 `MindNode.style`，与既有节点样式同路径。旧客户端/旧文档照旧回落。

### 2. 渲染（`MindMap.tsx` + `layout.ts`）

- **节点边框线型**：`<rect>` 上加 `strokeDasharray={BORDER_DASH[borderStyle]}`
  （实线不设 dash，虚线 `7 4`、点线 `2 3`、点划线 `9 3 2 3`）。
- **连线线型**：
  - `dashed` → `strokeDasharray="7 5"`；
  - `taper`（从粗到细）→ **填充多边形**而非描边：`taperFillPath()` 把贝塞尔/直线
    路径采样 22 段，按法向偏移生成左右两条边，宽度从 `linkWidth` 线性收到
    `linkWidth × 0.28`。变宽只能靠填充表达（描边加 dash 会退化成虚线），所以
    taper 与 dashed 在渲染层互斥。
- **箭头**：`parseLinkPath()` 从路径里解析端点与端点切向，`arrowTri()` 画三角形。
  `inward` 尖端贴父端、朝向父节点（朝画布中心收）；`outward` 尖端贴子端、朝外发散。
- **连线色彩**：`linkColorMode === "single"` 时忽略各分支主题色，整图统一 `linkColor`。
- **直线**：`layoutTree` 出口给每条 link 回填 `straight = lineStyle === "straight"`，
  `linkPath()` 对 `straight` 直接 `M … L …`（既不曲线化也不拐肘）。
  这样 6 个布局函数签名都不用动。

### 3. 面板（`MindmapStyleCombos.tsx`）

- 「节点样式」末尾加 **边框线型**（4 项，chip 上用 `border-bottom-style`
  画实线/虚线/点线/双线的预览条）。
- 「基础样式」在连线颜色上方按需求顺序加四组：
  **连线线型**（3）→ **连接方式**（3，调 `onLineStyle` → `api.setLineStyle`）
  → **箭头**（3）→ **连线色彩**（2 + 单色时展开选色盘，附口径提示）。
- 抽了一个 `SegRow` 复用工具条的 `mm-shape-chip` 选中态样式，避免重复造浮层控件。

`MindmapEditor` 新增 `handleLineStyle`（`lineStyle` 写在 `MindMapConfig` 上、
不入基础样式快照，改完 bump 一次 `uiTick` 让面板回显）。

## 四、验证（全部实拍/实测，非推断）

| 套件 | 结果 |
|------|------|
| `tsc --noEmit` | ✅ 0 错误 |
| `build-embed.sh` | ✅ ALL_OK（137MB，静态 3429 文件 / 109M） |
| `mm-style-shot.sh`（新） | ✅ 8/8：边框线型 4 项、连线线型 3、连接方式 3、箭头 3、连线色彩 2；虚线/向外箭头/单色实点生效 |
| `mm-editor-check.sh` | ✅ 19/19 |
| `mm-h5-pan-check.sh` | ✅ 5/5 |
| `preview-zoom-check.sh` | ✅ PASS=13 FAIL=0 |
| `ui-doc-types.sh` | ✅ 18/18，控制台 error 0 |
| `h5-reader-check.sh` | ✅ 68/68 |
| `e2e-editor-menus.sh` | ✅ 48/48，零控制台错误 |

几何实测（`mm-style-shot.sh` 的探针输出）：

```
定金与退订@x630_w35   分支主题@x683_w28   → 空白 683-665 = 18 px（≈ 一个层间距）
```

截图：`/home/macro/.workbuddy/tmp/mm-style-shot/layout-read.png`（阅读态布局）、
`panel-borderstyle.png`、`panel-basestyle.png`、`applied-link.png`。

## 五、改动文件

```
web/src/components/mindmap-vite/src/components/MindMap/
  types.ts     + MindBorderStyle / BORDER_DASH / BORDER_STYLES
                + LinkPattern / LinkArrow / LinkColorMode 及三个常量数组
                + MindNodeStyle.borderStyle
                + BaseStyle 的 linkPattern / linkArrow / linkColorMode
                LineStyle 扩出 straight
  layout.ts    MindLink + straight；layoutSide 水平定位改为「贴父边缘 + 层间距」
  MindMap.tsx  + parseLinkPath / taperFillPath / arrowTri；连线渲染支持
                虚线 / 变宽填充 / 箭头 / 单色；节点 rect 支持 strokeDasharray
  index.ts     导出新类型与常量
web/src/components/editor/
  mindmap/MindmapStyleCombos.tsx   + 边框线型 4 项 + SegRow 四组
  MindmapEditor.tsx                + handleLineStyle / onLineStyle / LineStyle 导入
web/src/index.css                  + .mm-line-grid / .mm-bs-chip / .mm-bs-line / .mm-pop-hint
tools/verify/
  mm-style-shot.sh   [新] 端口 8194，登记进 run-all.sh 与 README
  run-all.sh / README.md
```

## 六、踩坑记录

1. **推断间距不如量几何**：肉眼读截图定位「红框多大」完全靠不住，
   改成读 `.mm-node` 的 `getBoundingClientRect()` 才锁定到列宽算法。
2. **`agent-browser` eval 的输出里中文键会被转义**成 `{\连线线型\:3}`，
   拼 JSON 再用 jq 取中文键必炸；改成逐组单独 `jseval` 返回纯数字。
3. 截图前要先把浮层摘掉，但**只能删 `.mm-pop-panel`** —— `.mm-pop` 是整个锚点容器，
   删了触发按钮也跟着没了，下一步点击直接失效。布局类截图走阅读态（`tab=read`）更干净。
4. `BORDER_PREVIEW` 在 JSX 里要标 `CSSProperties['borderBottomStyle']`，直接写
   `Record<string, string>` 过不了 tsc。

## 七、遗留

- `layout.ts` 的 `Branch.widths` 现在只用于计算、不再参与定位，代码可以进一步简化
  （保留是为了不动 `layoutBalanced` 的左侧整体平移对齐逻辑，等有空再收）。
- 「箭头」的 inward/outward 语义按「尖端朝画布中心 / 朝外发散」实现，
  如果产品口径是反过来（朝父 = 朝外），说一声改 `arrowTri` 的传参即可。
