# 模板功能补全（第二批需求）

## 五项需求落地情况

| # | 需求 | 实现 | 验证 |
|---|------|------|------|
| 1 | 选模板先预览，点「使用」才建文档 | 新增 `TemplatePreview` 弹窗，画廊卡片点击改为先开预览；仅点「使用此模板」才回填类型/标题/正文走新建流程 | ✅ UI 23/23 |
| 2 | 模板中心同样预览后使用 | 模板中心页 `TemplateGalleryPage` 共用同一 `TemplateGallery` 组件，自动生效 | ✅ UI 23/23 |
| 3 | 目录树「另存为模板」 | 文档「⋯」菜单新增「另存为模板」→ 弹窗（分类 AutoComplete + 模板名 + 默认标题 + 正文预览）→ `POST /api/templates`（仅本人） | ✅ UI 23/23 |
| 4 | 管理员改/删模板 | 管理员页列表加「编辑」列 + 编辑 Modal（分类/名称/默认标题/类型/正文）；内置模板禁用编辑与删除并给说明 | ✅ UI 23/23 |
| 5 | 修复批量目录导入模板报错 | 见下方「关键修复」 | ✅ API 16/16 |

## 改动文件

**前端**
- `web/src/components/template/TemplatePreview.tsx`（新增）— 预览弹窗，复用 `DocContent` 按需分发所有文档类型渲染正文。
- `web/src/components/template/TemplateGallery.tsx` — 卡片点击改为 `setPreview(t)`；预览里点「使用」才 `onSelect`。
- `web/src/pages/BookPage.tsx` — 新增「另存为模板」弹窗与 `openSaveAsTemplate`；画廊 `onSelect` 继续原两步流程。
- `web/src/lib/treeMenu.tsx` — 文档菜单新增「另存为模板」（canWrite 时）。
- `web/src/components/tree/KnowledgeTree.tsx` — 新增 prop `onSaveAsTemplate(bookId, doc)`。
- `web/src/pages/AdminTemplatesPage.tsx` — 编辑 Modal + 内置模板禁用说明 + `errors` null 防御。
- `web/src/api/templates.ts` — 新增 `createTemplate` / `updateTemplate`；`DocTemplate` 加 `created_by`。

**后端**（`server/internal/`）
- `model/template.go` — 加 `CreatedBy`；`Builtin` 去掉 `default:true`。
- `service/template_service.go` — `CreateTemplate` / `UpdateTemplate` / `DeleteTemplate`；`SeedTemplates` 显式写 `Builtin=true`；批量导入 `failed` 初始化为 `[]`。
- `handler/template_handler.go` — `POST /api/templates`（仅本人）、`DELETE /api/templates/:id`（仅本人）、`PUT /api/admin/templates/:id`（仅管理员）。
- `router/router.go` — 注册上述路由。

## 关键修复

1. **批量导入白屏根因**：导入结果 `var failed []fileErr` 零值为 nil slice → JSON 序列化为 `null` → 前端 `result.errors.length` 抛 `TypeError` 白屏。改为初始化 `[]`。
2. **builtin 字段全错标（隐性强 bug）**：原 `Builtin bool \`gorm:"default:true"\``，GORM 对带 `default` 的字段跳过零值，导致自建 / 批量导入的所有模板都被写成 `builtin=1` —— 管理员删不掉、不进「自定义模板」列表。改为去 default、SeedTemplates 显式 `Builtin=true`、CreateTemplate/导入显式 `Builtin=false`，并加**启动幂等 repair**（把 `builtin=1 AND created_by>0` 的脏数据纠正为 `builtin=0`）。

## 验证总账

| 套件 | 结果 |
|------|------|
| 自研 API 验证 `verify-tpl-api.sh` | 16/16（errors:[]、builtin 修复、自建/改/删、批量导入 1088 条归位 136 内置 + 1088 自定义） |
| 自研 UI 验证 `verify-tpl-ui.sh` | 23/23（预览后使用、模板中心预览、另存为模板 builtin=false、管理员改名/删除、导入不白屏） |
| 回归 run-all（6 套） | 166/166 — e2e-folder-dir / e2e-dashboard / ui-doc-types(18) / embed-prod-check(17) / check-lazy-routes(14) / check-route-fallback(14) |

tsc 零报错；vite 构建通过；embed 已刷新；Go 二进制编译通过。

## 受影响约定（已写入 MEMORY.md）
- `DocTemplate.Builtin` 禁止用 `gorm:"default:true"`，必须显式写入（否则全部错标为内置）。
- 批量导入 `errors` 字段必须初始化为 `[]`（nil slice → `null` 会白屏）。
- 选模板统一走「预览 → 使用」两步，不再「点卡即建」。
