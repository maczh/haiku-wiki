# 管理员导入模板：支持 Word/Excel/PPT 模板文件

## 需求
修改管理员的「导入模板」功能，新增支持直接导入 Word/Excel/PPT 模板文件：
`.doc` `.docx` `.dotx` `.xls` `.xlsx` `.xltx` `.ppt` `.pptx` `.potx`。
导入后生成一个对应类型的办公文档模板，用户在「新建文档」套用即可一键创建一篇同类型办公文档。

## 改动文件
- `server/internal/handler/template_handler.go`
  - `ImportTemplates` 按扩展名分流：`.json` 走原有模板数据解析；9 种办公扩展名走新分支。
  - 新增 `officeTemplateExt`（扩展名→文档类型：word/sheet/ppt）映射与 `buildOfficeTemplate` 纯函数（已抽离便于单测）。
  - 办公文件经 CAS 落盘（`uploadService.SaveBytes`，命中即秒传复用），模板正文存为办公文件引用
    `{url, filename, size, ext}`，与现有 word/ppt/sheet 正文契约一致。
  - 分类：表单 `category` 优先；缺省按类型归入「Word 模板 / Excel 模板 / PPT 模板」。
  - 办公模板单文件上限用上传上限（默认 64MB），不再受 JSON 的 16MB 限制。
- `server/internal/service/upload_service.go`
  - 上传白名单 `allowedExt` 增加 `.dotx` `.xltx` `.potx`（`.doc/.docx/.xls/.xlsx/.ppt/.pptx` 原已有）。
- `server/internal/repository/templates_seed.go`
  - `validTemplateDocTypes` 增加 `word`、`ppt`（JSON 导入也可声明办公类型）。
- `server/internal/service/template_service.go`
  - `savableTemplateDocTypes` 增加 `word`、`ppt`（管理员可编辑办公模板类型，与正文契约一致）。
- `web/src/lib/officeDoc.ts`
  - `OFFICE_EXTS` 增加 `dotx` `xltx` `potx`，使模板格式引用被识别为办公内容、路由到 OnlyOffice。
- `web/src/api/templates.ts`
  - `importTemplates` 增加可选 `category` 参数并写入表单。
- `web/src/pages/AdminTemplatesPage.tsx`
  - 文件/目录选择 `accept` 与目录过滤增加办公扩展名；新增「办公模板分类（选填）」输入框；
    说明文案与格式卡片补充办公模板说明。

## 端到端闭环
导入 → `doc_templates`（custom，`builtin=false`）→ 模板画廊按分类展示（预览复用 `DocContent`，办公模板直接预览真实文档）
→ 套用 → `CreateDoc`（doc_type=word/ppt/sheet，正文=办公引用）→ OnlyOffice 打开编辑。
删除模板不删除底层 CAS 文件，已创建的文档引用不受影响。

## 校验
- 后端：`go build ./...` 通过；新增 `template_handler_office_test.go`（`officeTemplateExt` 映射 + `buildOfficeTemplate` 字段/引用结构）全部 PASS。
- 前端：`tsc --noEmit` 0 错误。
- 仅 Office Web Comp 原生支持 `.dotx/.xltx/.potx`（已确认 `internal/editor/server.ts` 接受这些扩展名），存原扩展名即可被直接打开。

## 备注 / 后续
- 端到端导入（起服务 + multipart 上传）建议补一条 e2e 套件；逻辑核心已由单测覆盖。
- `.doc/.xls/.ppt` 等旧格式 OnlyOffice 同样支持，按现有扩展名白名单原样落盘。
