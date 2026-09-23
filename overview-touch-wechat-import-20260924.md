# 概览：H5 触摸划屏回归 + 微信扫码登录 + H5 导入（2026-09-24 第二批）

## 1. H5 返回文库目录后「除 md/docx/导图外」失划屏（BUG 修复）

**现象**：H5 进入任意**非 md/docx/思维导图**文档（sheet/flowchart/file/gantt/api/whiteboard/drawing/
todo/calendar/prototype）→ 返回文库目录页 → 文库树整页无法上下划屏。

**根因（上游 UMD bug，已定位）**：`node_modules/luckysheet/dist/luckysheet.umd.js` 在**模块首次加载时**
往 `document` 挂了一条不可移除的裸监听 `addEventListener("touchmove", e => e.preventDefault(), {passive:false})`。
只要本会话加载过一次 luckysheet，之后任何页面的 `touchmove` 都被吞掉 —— md/docx/导图不加载 luckysheet 故正常。

**修复**：`web/src/lib/luckysheetTouchShim.ts` —— 在 `import 'luckysheet'` **之前**包裹 `document.addEventListener`，
命中「裸 `preventDefault` 的 touchmove」时把语义收窄：仅当 `e.target.closest('.luckysheet-cell-main,.luckysheet-input-box')`
（真的在拖 luckysheet 触摸手柄）才放行原 handler，其余一律放行。
`reader/SheetView.tsx` 与 `editor/SheetEditor.tsx` 在引入 luckysheet 前先引入此 shim。

**验证**：新增 `tools/verify/h5-scroll-back-check.sh`（端口 8178，探针 `tools/verify/h5-touch-scroll.mjs`
用 Playwright CDP `Input.dispatchTouchEvent` 派发**真实触摸序列**）。逐类型「文库页→文档页→返回→文库页真实滑动」：
返回后 `touchmove:prevented` 必须 = 0、`scrollTop` > 10。**12 类型 ×（进入前+返回后）= 24/24 通过**（基线）。

## 2. 微信扫码登录（桌面 + H5）

**后端**
- 配置 `config.go` 扁平字段 `WeChatAppID / WeChatAppSecret / WeChatRedirectURI`（yml `wechat:` 段），三者齐全 →
  `WeChatEnabled=true`；否则走 **dev 模式**（无凭据也能联调）。
- `model/wechat.go`（`wechat_bindings` 表，唯一索引 `(app_id,open_id)` + `union_id` 索引）→
  `repository/wechat_repo.go` → `service/wechat_service.go`（内存态 ticket 状态机 `pending→authorized/needs_profile/expired`）
  → `handler/wechat_handler.go`。
- 路由挂在 `/api/auth/wechat/`：`qrcode`（生成会话）、`callback`（真实扫码 302 换码）、`status`（轮询）、
  `bind`（无绑定账号时「绑定已有 / 注册新用户」）、`dev-complete`（dev 模式模拟扫码）。
- `User` 表新增 `avatar` 字段（微信昵称/头像注册时带入）；`AutoMigrate` 已含 `WeChatBinding`。

**前端**
- `api/wechat.ts` + `components/WeChatLoginModal.tsx`（`qrcode` 库 `toDataURL` 渲染二维码、轮询 `/status` 每 1.5s、
  needs_profile 弹「绑定/注册」表单；dev 模式多一个「模拟扫码」按钮）。
- `pages/LoginPage.tsx` 接入（桌面/H5 共用「微信扫码登录」按钮，成功用 `/auth/me` 补 user）。

**验证**：新增 `tools/verify/wechat-login-check.sh`（端口 8185）dev 模式端到端 **13/13**：
生成会话(dev_mode=true) → 无绑定→注册新用户(token 有效、role=member) → 已有账号→绑定(e2e@example.com)
→ 已绑定→直接 authorized → 非法 ticket 被拒(400)。

> 生产启用真实扫码：在 `conf/application.yml` 的 `wechat:` 填 appid/secret/redirect_uri，并把 redirect_uri
> 配成 `/api/auth/wechat/callback` 的可公网访问地址即可（dev 模式自动让位）。

## 3. H5 导入手机文件（含微信文件）

- `lib/import/runImport.ts`：把桌面 `ImportDialog` 的「解析→上传/秒传→建文档」抽成**共享核心**（UI 无关，避免两处漂移）。
- `h5/components/MobileImportSheet.tsx`：底部抽屉 + 隐藏 `<input type=file accept="*/*" multiple>`；
  **微信内置浏览器**里该选择器可直接选「微信文件」，从而满足「包括微信中的文件」需求。
- `h5/pages/MBookshelf.tsx`：文库页右下角 FAB 唤起导入面板（文档视图导入当前文库，文库列表视图导入首个「我的/团队」文库）。

## 4. 回归套件登记（run-all.sh）

| 套件 | 端口 | 项 | 内容 |
|---|---|---|---|
| `h5-scroll-back-check` | 8178 | 24 | H5 返回后触摸划屏不失效（12 类型 × 进入前/返回后） |
| `wechat-login-check` | 8185 | 13 | 微信登录 dev 模式端到端 |

两套接件均已加入 `run-all.sh` 的 `DEFAULT_SUITES`（在 `sim-docker-web` 之前）。

## 改动文件清单
- 新增：`server/internal/model/wechat.go`、`repository/wechat_repo.go`、`service/wechat_service.go`、
  `handler/wechat_handler.go`、`web/src/lib/luckysheetTouchShim.ts`、`web/src/api/wechat.ts`、
  `web/src/components/WeChatLoginModal.tsx`、`web/src/lib/import/runImport.ts`、
  `web/src/h5/components/MobileImportSheet.tsx`、`tools/verify/wechat-login-check.sh`、
  `tools/verify/h5-scroll-back-check.sh`（含 `h5-touch-scroll.mjs`）。
- 修改：`config.go`（微信配置）、`repository/database.go`（AutoMigrate 加 WeChatBinding）、
  `model/user.go`（avatar 字段）、`router/router.go`（微信路由）、`components/reader/SheetView.tsx`、
  `components/editor/SheetEditor.tsx`（引入 shim）、`pages/LoginPage.tsx`（微信按钮+弹窗）、
  `h5/pages/MBookshelf.tsx`（导入 FAB）、`tools/verify/run-all.sh`（登记新套件）。

## 5. 全量回归收口（run-all.sh，2026-09-24 收尾）

按本项目约定「改完跑一次全量（23 套→现已 25 套）确认 `ALL_SUITES_PASS`」，本次改动触及共享入口
（`LoginPage` 桌面/H5 共用、`MBookshelf`、router、`AutoMigrate`），故跑全量门禁做收口确认。

- **结果：`ALL_SUITES_PASS`** —— 25 套，553 项断言全部通过，0 失败。
- 与本批直接相关的关键套件：
  - `embed-prod-check` 17/0（生产形态二进制 `web/dist→embed→go build` 编译起服正常）
  - `h5-scroll-back-check` 24/0（`H5_SCROLL_BACK_PASS`，修复后真实触摸探针 24/24）
  - `wechat-login-check` 13/0（微信登录 dev 模式端到端）
  - `h5-reader-check` 68/0（H5 阅读链，含 `MBookshelf` 改动，`H5_READER_CHECK_PASS`）
  - `e2e-import` / `ui-doc-types` / `whiteboard-check` / `preview-zoom-check` 等共享组件套件均 0 失败
  - `sim-docker-web` 1/0（完整 npm build 阶段正常，`DOCKER_WEB_STAGE_OK`）
- 全量 `FAIL=` / `_FAILED` / `有问题的套件` 扫描 = 0，确认无跨套件回归。
