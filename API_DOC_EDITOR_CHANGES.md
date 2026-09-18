# 接口文档编辑器功能修改

对应 `web/src/components/editor/ApiEditor.tsx` 与 `web/src/lib/apiDoc.ts` 的改动。

## 改动清单

1. **阅读模式 URI 展示（含复制）**
   - 阅读模式下，URI 由禁用的输入框改为可选中、可复制的地址条（不含 Host）。
   - GET 接口会拼接已启用 query 参数，呈现「除 Host 外的完整 URI」。
   - 旁边提供「复制 URI（不含 Host）」按钮；保留原有的「复制完整 URL（含 Host）」。

2. **请求头可动态添加**
   - 沿用 KVEditor：勾选框（传 / 不传）、字段名框收窄（130px）、Value 框自适应拉长、可手动「添加」/删除。

3. **GET 请求参数**
   - 勾选框与 Value 框均可编辑/勾选。
   - 移除「中文名称」单独列；字段名框收窄。
   - 悬停字段名时 Tooltip 显示「中文名称 + 类型」（数据来自导入的 `description` / `type`）。

4. **POST / 请求体**
   - 表单（form）类型：参数仍在「请求参数」区填写，请求体区给出提示并展示编码预览（作为 `x-www-form-urlencoded` 发送）。调试时 form 参数作为请求体发送，而非拼到 URL。
   - 请求体类型与请求体框均可编辑。
   - JSON 类型：请求体框可编辑，其下方自动生成「字段参数说明」表（由 body 推导：字段名/类型/说明/必填）。

5. **GET / POST 颜色对调**
   - `METHOD_COLOR`：POST 绿色 `#52c41a`、GET 蓝色 `#1677ff`（其余方法不变）。

6. **返回结果提前展示**
   - 若导入文档含返回结果描述，在「返回结果」页签顶部提前展示 JSON 示例（美化）与字段说明表。
   - Swagger2 / OpenAPI3 的 response schema、Postman 的 2xx 文本响应体均会被解析为 `response_example` 与 `response_fields`。

## 数据契约（`lib/apiDoc.ts`）
- `ApiKeyValue` 增加 `type?: string`。
- 新增 `ApiField { name, type, description?, required? }`。
- `ApiEndpoint` 增加 `response_example?: string`、`response_fields?: ApiField[]`。
- 新增 `jsonToFields(body)`（从 JSON 正文推导字段表）与 `schemaToFields(schema)`（从 JSON Schema 推导字段表）。

## 验证
- `tsc --noEmit` 对 `ApiEditor.tsx` / `apiDoc.ts` 零错误（其余 7 条为沙箱缺失依赖 `docx/jquery/html2canvas/jspdf/pptxgenjs`，与本次无关）。
- 整站 `npm run build` 受沙箱环境限制无法跑，需在联网正常环境验证。
