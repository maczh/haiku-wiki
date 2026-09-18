# 多文库目录树（阅读页左侧栏）+ 导入目标目录

## 需求
1. 继续完成上轮未竟的构建验证。
2. 把**阅读页左侧「文件列表框」**改为**树型目录树**：第一级 私人知识库 / 团队知识库 / 公司知识库（均可多个），第二层起是文档与子目录；「新建文档」「导入」都要先选知识库 + 目录，再创建 / 导入。

## 已实现

### 1. 统一目录树 `KnowledgeTree.tsx`（新增，接在阅读页左侧栏）
- antd `Tree`，三层结构：
  - **第一级**：分类节点 `私人知识库` / `团队知识库` / `公司知识库`（分别来自 `listBooks` 的 `mine` / `teams` / `visible`）。
  - **第二级**：知识库（book），点击打开 `/books/:id`；hover 的 `···` 菜单：新建文档 / 导入 / 设置 / 删除 /（公司库 + 管理员）管理写权限。
  - **第三层起**：文档与子目录，按 `getTree(bookId)` **懒加载**（`Tree` 的 `loadData`，展开书籍时才拉取），点击文档打开 `/books/:id?docId=:d`；右键菜单：打开 / 编辑 / 新建子文档 / 重命名（就地输入）/ 复制 / 移动到其他知识库 / 导出 / 分享 / 邀请协作 / 置顶 / 删除。
- 文档图标按 `doc_type` 分发（`lib/fileIcon`），目录（含子节点）用文件夹图标；分类计数实时显示。
- 支持按名称过滤（`BookshelfPage` 书架网格保留原有按名称过滤，不重复）。

### 2. `BookPage.tsx`（重构左侧栏）
- 左侧栏原 `DocTree`（单知识库文档树）→ `KnowledgeTree`（多文库目录树）。
- 顶栏书头保留当前知识库名称 / 可见性 / 文档数，并新增「新建知识库」入口。
- 从树中点击任意知识库 → 路由切到该库；点击任意文档 → 打开该文档。
- 「新建文档」「导入」均为**两步模态**：第一步选**知识库 + 目录**（目录 = 该库 `getTree` 拍平的文档树，含「根目录」项，强制先确定位置），第二步再填类型 / 名称（新建）或选方式（文件 / 网页链接，导入）。
- 导入落库后通过 `reloadBookId + reloadNonce` 触发该库文档树重载并自动展开。
- 公司库写权限管理复用既有 `CompanyKBWritersModal`（支持对任意公司库授权，不仅当前库）。

### 3. `BookshelfPage.tsx`（回退为书架网格）
- 恢复为原来的卡片网格（我的 / 团队 / 公司三类），作为顶层书架入口。
- 保留新建 / 编辑 / 删除知识库能力；点击卡片进入对应知识库阅读页，阅读页左侧栏即为多文库目录树。

### 4. 「导入到指定目录」贯通全链路
- 后端 `handler/import_url_handler.go`：`importUrl` 入参新增可选 `parent_id`（默认 0），传入 `CreateDocWithContent`。
- 前端 `api/docs.ts` `importUrl(url, bookId, parentId=0)`；`ImportDialog` 新增 `parentId?`（默认 0）使 `createDoc` 落到目标目录；`UrlImportDialog` 新增 `parentId?`。
- 文件导入（Word/Excel/Markdown/附件等）与网页链接导入均可指定目录。

## 验证状态
- ✅ **后端** `go build ./...` 绿灯（环境变量：`GOPATH/GOMODCACHE=/home/macro/go/pkg/mod`、`GOPROXY=off`、`GOFLAGS=-mod=mod`、`GOCACHE/HOME=/home/macro`、`TMPDIR/GOTMPDIR=/home/macro/.workbuddy/tmp/gotmp`）。
- ✅ **前端** `tsc --noEmit`：本次新增 / 修改文件**全部零类型错误**。
- ⚠️ **完整 `npm run build` 在本沙箱已确认无法跑通**（不是代码问题）：`node_modules` 缺 5 个重型依赖（`docx/jquery/html2canvas/jspdf/pptxgenjs`，仅被导出功能引用），补装连撞三道墙——
  ① `npm ci` 被宿主批量删除守卫拦死（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，exit 2）；
  ② `npm install` 撞 overlayfs 非空目录改名 `ENOTEMPTY`；
  ③ npm 缓存 `/root/.npm` 属 root 导致 `EACCES`（用 `npm_config_cache` 可修这条，但修完立刻撞 ②）。
  故全量 `tsc` 仍报这 5 个 `Cannot find module`（与改动无关，可 `grep -vE 'node_modules/(docx|jquery|html2canvas|jspdf|pptxgenjs)'` 滤掉）。
  整站构建 / 浏览器冒烟**必须在能联网 + 正常文件系统（非 overlayfs）的环境**做，那边 `npm install && npm run build` 即可。

## 建议下一步
1. 联网环境 `npm install && npm run build` 确认整站绿。
2. 浏览器冒烟：进入任意知识库 → 左侧栏展开 私人/团队/公司 → 知识库 → 文档；在左侧栏新建文档 / 导入并确认落入所选目录；右键文档测试复制 / 移动 / 置顶 / 分享 / 导出 / 协作；公司库管理员通过树菜单「管理写权限」。
3. 改动均已 `git commit`，尚未 `git push`。
