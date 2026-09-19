# tools/verify —— 回归套件

这些是**浏览器/接口端到端套件**，跑在「单源生产形态」上：
`vite build` → 拷进 Go embed 目录 → `go build` → 起单端口服务 → agent-browser 操作真实界面
→ 用 API 回查断言落库结果。之所以不用 Vite dev server：dev server 由自己的静态中间件服务，
**静态资源兜底、embed 完整性一类的问题在它上面根本不复现**。

> 这些脚本原先散在 `/home/macro/.workbuddy/tmp/` 下，而该目录会被清理 —— 套件会随之消失，
> 所以收进仓库。改动套件后请同步更新下面的清单。

## 前置条件

```bash
# 1) 生产形态二进制（套件默认读 $TMPDIR/haiku-wiki，即 /home/macro/.workbuddy/tmp/haiku-wiki）
bash tools/build/build-embed.sh          # 前端构建 → 刷新 embed → go build

# 2) agent-browser + Chrome（脚本内已设好这些环境变量）
#    AGENT_BROWSER_EXECUTABLE_PATH=/opt/google/chrome/chrome
#    AGENT_BROWSER_ARGS=...--no-proxy-server...
# 3) 本机 http_proxy 会劫持 localhost → 脚本内 curl 一律带 --noproxy '*'
```

**改了前端代码必须先重跑 `build-embed.sh`**，否则套件测的还是旧产物 —— 这是最容易自欺的地方。

## 跑法

```bash
bash tools/verify/e2e-folder-dir.sh                       # 单跑一套
bash tools/verify/run-all.sh                              # 全套，逐套汇总 ✅/❌
SUITES="e2e-folder-dir ui-doc-types" bash tools/verify/run-all.sh   # 只跑指定几套
```

`run-all.sh` 会先探测每套的端口：**被占用就跳过并标注原因**（见「已知坑」第 5 条），
再逐套打印实际 ✅/❌ 并给总账；任一套失败则退出码非 0 并打印 `ALL_SUITES_FAIL`。
全套跑一次约 20 分钟，其中 `sim-docker-web` 单独要 ~11 分钟（它跑一次完整 `npm build`）。

可覆盖的环境变量：

| 变量 | 作用 |
| --- | --- |
| `E2E_DATA` | 指定数据目录（默认：从 `fixtures/e2e-data` 复制一份临时副本，服务端只写副本） |
| `HAIKU_BIN` | 指定后端二进制（`e2e-import` / `e2e_export` 支持；其余读 `$TMPDIR/haiku-wiki`） |
| `PORT` | 换端口（`e2e-import` 默认 18081、`e2e_export` 默认 18080）——**端口被幽灵实例占用时用它重跑** |
| `TMPDIR` | 输出（日志、截图）与二进制的落点，默认 `/home/macro/.workbuddy/tmp` |
| `OUT` | `run-all.sh` 的汇总日志与各套 stdout |
| `SUITES` | `run-all.sh` 的子集 |

**必须顺序执行**：多套共用 `XDG_RUNTIME_DIR` 与同一个 Chrome profile，并行会互相干扰
（表现为随机 `no-btn` / 页面串台）；其中 4 套还共用端口 8080。

## 套件清单（2026-09-19 基线）

| 脚本 | 项数 | 端口 | 覆盖 |
| --- | --- | --- | --- |
| `embed-prod-check.sh` | 17 | 8099 | embed 完整性、drawio 目录未被 SPA 兜底吞掉、大资源非 HTML 兜底、CAD 转换器可用 |
| `e2e-folder-dir.sh` | 49 | 8181 | 新建目录三入口、目录占位页、**目录下拉显示名称而非数字**、**落库 parent_id 精确值**、导入落在所选子目录、目录不进最近更新、删除级联 |
| `e2e-dashboard.sh` | 40 | 8150 | 视频/封面真的随包分发（Content-Type + 字节数 + MP4 `ftyp`）、播放器解出真实时长、向导与视频可关闭且持久、快捷操作链路 |
| `e2e-import.sh` | 10 | 18081 | xlsx 多工作表拆父子、空表跳过、docx/pdf 存为附件并可预览、表格 v3 契约 |
| `e2e_export.sh` | — | 18080 | 导出双通道：服务端逐格式响应头/字节校验 |
| `ui-doc-types.sh` | 18 | 8080 | markdown / sheet / mindmap / flowchart / file 的读写渲染 |
| `gantt-fold-check.sh` | 30 | 8112 | 甘特折叠右时间轴后左表格**不得丢行**、只读态拦截 |
| `check-lazy-routes.sh` | 14 | 8080 | 按需加载的**实证**：`/login` 不下载知识库页 chunk |
| `check-route-fallback.sh` | 14 | 8080 | 有/无布局壳的路由在 `LazyBoundary fill` 下都正常落位、不卡占位 |
| `ui-shot.sh` | 截图 | 8080 | 各页面截图留证 |
| `sim-docker-web.sh` | — | — | 无 docker 时逐字复现 `Dockerfile` 的 web-builder 阶段（证明 prebuild 能在干净上下文生成 Vditor 资源）。**要跑一次完整 `npm build`，约 11 分钟** |

`run-all.sh` 会打印每套的实际 ✅/❌，上表项数是 2026-09-19 那次全绿的基线。

## 夹具（`fixtures/`）

- `fixtures/e2e-data/`：**种子数据快照**（`haiku.db` + `uploads/`）。
  `ui-doc-types` / `ui-shot` / `check-lazy-routes` / `check-route-fallback` 依赖它：
  book 1 固定是 `1=markdown 2=sheet 3=mindmap 4=flowchart 5=file`。
  套件每次运行都会把夹具**复制成临时副本**再交给服务端写，所以夹具本身始终保持原样。
  更新夹具：从一次跑出来的数据目录里取 `haiku.db`（先 `PRAGMA wal_checkpoint(TRUNCATE)` 把 WAL 落盘）
  与 `uploads/`，替换本目录内容。
- `fixtures/import-fixtures/`：导入用的真实 `.xlsx`（含空工作表）/ `.docx` / `.pdf`，
  以及重生成它们的 `gen.cjs`。
- `fixtures/exports/doc.pdf`：导出套件用的上传样例。
- `gen-upload-js.py`：把上述夹具内嵌成一段页面内注入的 JS（见下面「已知坑」第 1 条）。

## 已知坑（写新断言前先看这几条）

1. **`agent-browser upload` 在本机静默失效**：命令打印 `✓ Done`，但 `input.files.length` 仍是 0。
   替代方案是 `gen-upload-js.py` 生成的注入脚本：页面内用真实 `File` + `DataTransfer` 设置
   `input.files` 再派发 `change`，走的是应用真实的 `onChange → parseFile` 链路。
2. **AntD 的 5 类「脚本假失败」**（产品其实是对的）：
   `Button` 的 `autoInsertSpace` 会在**恰好两个汉字**间插空格（`创建`→`创 建`）→ 比对前归一化空白；
   `Modal` + `destroyOnClose` 步骤切换期间**两个 Modal 同时在 DOM** → 按 `.ant-modal-title` 定位；
   裸 `input` 会先命中 `Select` 内部的 search input → 用 `.ant-input`；
   React 受控输入要走原生 value setter + `input` 事件；
   AntD Tree 只渲染**已展开**层级 → 断言深层节点前逐级 `expandNode`（批量点会因重渲染失联）。
3. 关闭下拉/菜单用 `agent-browser press Escape`（命令是 `press`，不是 `key`）。
4. **agent-browser 的 ref 与页面状态不跨 Bash 调用保留**（下一次调用页会变 `about:blank`）
   → 所有浏览器步骤必须封进同一个脚本。
5. 端口被「幽灵实例」占用时，`ps` 看不到那些进程（在别的 PID 命名空间）。
   **症状极具误导性**：套件自己的服务起不来（`server.log` 里 `bind: address already in use`），
   于是它连上**别人的**服务、在别人的库里注册用户 → 报「注册失败」，很容易被误读成产品缺陷
   （2026-09-19 全套回归里 `e2e-import` 就是这么「假失败」的）。
   现在 `e2e-import` / `e2e_export` 有**端口预检**：占用时直接报错并提示用 `PORT=<空闲端口>` 重跑；
   其余套件若表现异常，先 `curl --noproxy '*' -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<端口>/`
   确认是 `000`（空闲）。本会话自己起的服务可以用任务管理回收，别的会话留下的只能换端口。

## 新增套件

1. 放进本目录，沿用「自起服务 + `trap cleanup EXIT` + ✅/❌ 计数」的结构；
2. 挑一个**独占端口**（避免和 8080 那几套撞），并在上面清单里登记；
3. 把脚本名加进 `run-all.sh` 的 `DEFAULT_SUITES`；
4. 依赖的数据走 `fixtures/` + 临时副本，**不要**直接引用 `/home/macro/.workbuddy/tmp/` 下的既有目录
   （那个目录会被清理）。
