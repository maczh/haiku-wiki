# 寄海文库：功能指南（MD/PDF）+ 首页 Dashboard 改版 + 操作演示视频

本次交付三块内容：① 全量功能指南（Markdown + PDF）；② 登录后首页 Dashboard 改版
（新手向导、视频介绍、布局优化、最近更新、快捷操作，向导与视频均可关闭）；
③ 带中文语音讲解与字幕的操作演示视频。全部改动均已在本机的**单源生产形态**下端到端验证。

> 上一版 `overview.md`（甘特图折叠丢行修复）已随提交进入 git 历史，需要时用
> `git log -p -- overview.md` 回看。

---

## 一、功能指南（Markdown + PDF）

| 文件 | 说明 |
| --- | --- |
| `docs/寄海文库功能指南.md` | 20 章：产品概览 / 快速开始 / 界面总览 / 首页 / 知识库 / 文档树 / 九种文档类型 / 编辑与版本 / 阅读 / 导入 / 导出 / 搜索 / 分享 / 协作团队 / 权限模型 / 回收站 / 账号与管理员 / 效率技巧 / FAQ / 技术约定 |
| `docs/寄海文库功能指南.pdf` | 2.26 MB，A4 排版：独立封面、双栏目录、表格样式、按章分页 |
| `docs/.guide-style.css` | PDF 用打印样式（pandoc → HTML → Chrome `--print-to-pdf`） |

**不是照着界面猜的**：写作过程中逐条回查了 `router.go` / `auth_service.go` /
`book_service.go` / `exportx/export.go` / `lib/export/index.ts`，纠正了 6 处与实现不符的表述：

- 「首个注册用户自动 admin」**已退役**（`auth_service.go` 有明确注释），实际是种子账号 `admin` / `Jihai2026`，新注册一律 `member`；
- `members` 可见性的库，**写权限对所有登录用户开放**（不是「仅所有者与协作者」）；
- 导出是**双通道**：服务端 14 种格式 + 浏览器端 docx/pptx/ppts/pdf，格式清单以 `/api/export/docs/:id/formats` 为单一事实来源；
- 导入**没有历史记录功能**，真实行为是扩展名白名单预检、64 MB 上限、重名新建节点；
- 接口文档导入按 `import_source` **整体替换**同源分组，支持按标签分组与批量删除；
- 回收站**只列「你创建的知识库」中**的已删文档（`ListTrash` 按 `books.owner_id` 过滤）。

重建 PDF：`bash /home/macro/.workbuddy/tmp/build-guide-pdf.sh`（pandoc → html → chrome `--print-to-pdf`）。

---

## 二、首页 Dashboard 改版

首页从「书架列表」升级为「工作台」。自上而下：

1. **欢迎条**：问候语（按时段变化）+ 三项统计（可见知识库 / 团队文库 / 最近更新数量）+ 两个开关（展开新手向导、展开视频介绍）；
2. **快捷操作**：8 个高频入口（新建知识库 / 新建文档 / 导入文件 / 导入网页 / 全文搜索 / 团队 / 回收站 / 账号设置）；
3. **新手使用向导**（3 步：建库 → 建文档 → 分享协作，每步带「立刻去做」）| **视频介绍**（内嵌播放器 + 6 个可跳转章节）；
4. **最近更新**（跨知识库聚合，含协作文档）| **团队速览**；
5. **书架**（我的 / 团队 / 公司三组，带数量角标）。

**可关闭与记忆**：向导与视频各自有「×」与「不再提示」，前者本次会话隐藏、后者写 localStorage
（`hk_onboard_dismissed` / `hk_intro_video_dismissed`）；关闭后欢迎条的开关可以重新打开并清掉记忆键。
首次渲染即读标志位，不会出现「先闪一下再消失」。

### 新增后端接口（最近更新的数据来源）

- `GET /api/recent-docs?limit=12` → `{items:[{id,title,doc_type,book_id,book_name,updated_at,can_write}]}`
- 粗筛（可读知识库 id 集合）→ 合并「库内文档」与「受邀协作的文档」→ 去重 → 按 `updated_at` 倒序
  → **逐条复核** `canReadBook || isDocCollaborator`（防止 SQL 条件与业务规则漂移导致越权）→ 附带 `can_write`
- `limit` 夹紧到 50、缺省 12；三个单测覆盖权限过滤、协作者可见、排序与夹紧

### 关键文件

```
server/internal/repository/recent_doc_repo.go          新增
server/internal/service/recent_docs_service.go         新增（含 recent_docs_service_test.go）
server/internal/handler/recent_docs_handler.go         新增
server/internal/router/router.go                       注册 jwt.GET("/recent-docs")
web/src/pages/DashboardPage.tsx                        新增（首页）
web/src/components/dashboard/{OnboardingGuide,IntroVideo,RecentDocsCard,QuickActions,QuickStartModal}.tsx + dashboard.css
web/src/components/book/BookshelfSection.tsx           新增（从 BookshelfPage 抽出，加 onLoaded/createSignal）
web/src/pages/BookshelfPage.tsx                        删除（能力并入 DashboardPage）
web/src/lib/dashboard.ts                               纯逻辑（时间/问候/统计/标志位），被回归脚本覆盖
web/src/api/recent.ts, web/src/types.ts                接口与类型
web/src/pages/BookPage.tsx                             支持 ?import=file|url 直达导入对话框
```

**按需加载没有被破坏**：入口 JS 755 KB（gzip 251 KB），入口 CSS 4.0 KB；
`wx-gantt / svar / GanttChart / vxe / simple-mind-map / luckysheet / vditor / mermaid / pdfjs` 在入口 chunk 中计数全为 0；
Dashboard 自身的样式与组件落在独立 chunk（`DashboardPage-*.js` 24 KB + `DashboardPage-*.css` 3.9 KB）。

---

## 三、操作演示视频（带语音与字幕）

- 产物：`web/public/onboarding/haiku-wiki-guide.mp4`（1600×900，**2 分 47 秒**，18.9 MB）+ 设计封面 `-poster.jpg`；
- 内容：6 个章节（登录与首页 / 新建知识库 / 新建与编辑文档 / 九种文档类型 / 搜索与分享 / 导出与总结），
  21 个镜头全部来自**真实界面截图**；中文旁白由 edge-tts（`zh-CN-YunxiNeural`）合成，
  字幕按旁白时长逐句烧录，画面带轻微缓推镜；
- 首页卡片内嵌播放器 + 章节快捷跳转，时间点与视频实际段落边界一致
  （`DashboardPage.tsx` 的 `INTRO_CHAPTERS` / `INTRO_SECONDS`）；
- 视频缺失时（例如裁剪过的部署包）组件捕获 `onError` 并降级为一段指向功能指南的说明，不会留黑框。

生成流水线已固化进仓库，日后改完界面可重建：

```
tools/video/seed-demo.py          灌演示数据（走公开 API，不碰现有数据）
tools/video/capture-shots.sh      采集 21 张界面截图（头部注释记录了三个「看似能跑其实不生效」的坑）
tools/video/build-guide-video.py  语音合成 → 分段渲染（章节标签 + 逐句字幕 + 缓推镜）→ 无损拼接
tools/video/README.md             环境依赖与重建步骤
```

> 视频刻意进 git 与 embed 产物（Go 二进制因此 +20 MB）：离线部署没有外部 CDN，必须随包分发。

---

## 四、验证（本机单源生产形态：vite build → embed → go build → 浏览器端到端）

| 套件 | 结果 |
| --- | --- |
| `go test ./... -count=1 -p 1` | 全绿（handler / router / service / exportx / fracidx） |
| `gofmt -l .` / `go vet ./...` | 0 个未格式化文件 / 无告警 |
| `tsc --noEmit` | 0 错误 |
| `npm run verify:dashboard`（新增） | **40/40** |
| `e2e-dashboard.sh`（新增，38 项） | **38/38**：视频与封面真的随包分发（Content-Type、字节数、MP4 `ftyp` box 三重校验）、播放器解出 **167s** 真实时长、向导与视频可关闭且刷新后仍关闭、欢迎条可重新打开并清空记忆键、最近更新可点进阅读态、快捷操作三条链路可达 |
| `embed-prod-check.sh` | **17/17**（drawio 目录未被 SPA 兜底吞掉、大资源非 HTML 兜底、CAD 转换器可用、SPA 兜底正常） |
| `check-lazy-routes.sh` | **14/14**（`/login` 不下载 Dashboard/BookPage；知识库页才补载编辑器） |
| `check-route-fallback.sh` | **14/14** |
| `ui-doc-types.sh` | **18/18**（markdown / 表格 / 导图 / 流程图 / 附件的读写） |
| `e2e-import.sh` | **10/10**（xlsx 多工作表拆父子、空表跳过、docx/pdf 存为附件、表格 v3 契约） |
| `gantt-fold-check.sh` | **30/30**（未回归） |

生产形态实测体积：embed 3001 文件 / 86 MB，二进制 104.6 MB（较改版前 +20 MB，即视频）。

---

## 五、顺带修掉的测试脚手架腐化（不是产品缺陷）

回归套件里有几处断言停留在旧契约上，跑起来会「假失败」。已逐个修正，避免下次误判：

1. **登录契约**：`POST /api/auth/login` 要的是 `{account, password}`（账号 = 用户名 / 手机号 / 邮箱），
   9 个脚本仍在传 `{email, password}`；注册要 `{username, name, email, password}`，不再有 `nickname`。
2. **表格渲染器换了**：`.x-spreadsheet` → **Luckysheet**（`.luckysheet-cell-main`；
   单元格画在 canvas 上，不能再从 DOM 取文本）。旧数据集里的 v1 表格内容会被自动迁移，渲染正常。
3. **首页页面改名**：`BookshelfPage` → `DashboardPage`（chunk 体积断言同步更名）。
4. **ImportDialog 是 Drawer 且按需挂载**：知识库页上不再有隐藏的 `input[type=file]`，
   注入文件前必须先打开抽屉（脚本改为走 `?import=file` 直达）；`gen-upload-js.py` 里
   「排除 `.ant-drawer` 内的 input」的过滤条件恰好把要用的那个排掉了。
5. **表格存储契约**：断言仍按 v1（`.cells["0-0"].text`），实际已是 v3（`sheets[0].celldata[].v.v`）。

另：`gofmt` 漂移的 3 个文件（`model/book.go`、`router/router.go`、`exportx/api_doc.go`）已格式化，
其中只有 `router.go` 是本次改动涉及的。

---

## 六、遗留事项

- **`git push` 未执行**：本机没有任何 GitHub 凭据，需要你自己推。
- **本机没有 Docker**：`Dockerfile` 未真实构建，只能陈述 `go build` 与 embed 产物的实测数字；
  新增的 `web/public/onboarding/` 会被 `COPY web/dist` 一并带入镜像，无需改 `Dockerfile`。
- `web/public/onboarding/*.mp4` 约 19 MB 进了版本库；若不想让仓库变大，
  可改为在 CI 里跑 `tools/video` 流水线生成（需要联网做 TTS）。
- `/home/macro/.workbuddy/tmp` 下累积的构建备份与截图目录（数 GB）未清理，需要时按目录逐个删。
