# 接口文档：导入去重 + 批量删除 + $ref 解析

> 改动文件：`web/src/lib/apiDoc.ts`、`web/src/components/editor/ApiEditor.tsx`
> 提交见 `git log`（本仓库 `master` 超前 `origin/master` 多个 commit，待 push 授权）

## 1. 接口单个 / 批量删除
- **单删**：保留原有的「行尾 X 按钮」与「右键菜单 → 删除」（编辑模式）。
- **批量删除**（编辑模式新增）：
  - 左栏顶部「批量删除」按钮进入勾选模式。
  - 每个接口前出现复选框，点击整行即切换选中（蓝色高亮 + 左侧蓝条）；分组标题前的复选框可**整组全选/取消**（含半选态）。
  - 选中后顶部显示「删除选中 (N)」与「已选 N」，点击带二次确认后一次性删除。
  - 「取消」退出批量模式并清空选择。

## 2. 重复导入同文档：先删后增
- 给 `ApiGroup` 增加 `import_source` 字段：Swagger/OpenAPI 取 `base_host`，缺省时回退到 `info.title`；Postman 取集合名（`info.name`）。
- `normalizeApiDoc` 落库/读取时保留该字段。
- `mergeImported` 在导入前：收集新文档所有非空 `import_source`，**删除当前文档中 `import_source` 相同的旧分组**，再追加新分组。
  - 因此重复导入同一份 Swagger/OpenAPI/Postman 会整体替换旧接口，不再产生重复。
  - 手动新建的分组（无 `import_source`）不受影响。
- 实测参考文档 `dev-api.jihaihotpot.com/.../doc.json`：其 `host/basePath/schemes` 均为空，故 `import_source` 落到 `info.title`（「寄海海鲜火锅RIS订单模块」），去重仍生效。

## 3. 导入时解析 `$ref`（请求体 / 响应 / 参数类型）
- 新增 `resolveRef` / `derefSchema`：`#/definitions/X`（Swagger2）与 `#/components/schemas/X`（OpenAPI3）均支持；**凡 key 为 `$ref` 的节点递归解析**，含嵌套 `$ref`（数组元素、对象属性）与循环引用保护。
- `schemaToSample` / `schemaToFields` / `extractResponse` / `paramType` 全部透传根文档以解析 `$ref`。
- 效果：Swagger 中 `parameters[n].schema.$ref = "#/definitions/ro.CreateOrderReq"` 的请求体，会展开成该 definition 的 `properties` 作为可读 JSON 示例与字段说明表；响应 schema 的 `$ref` 同理。
- 实测：参考文档 46 个接口、22 个 JSON 请求体，**0 个残留 `$ref`**（如 `POST /admin/cancel` 的请求体从 `$ref` 解析为 `cancelReason / operatorId / operatorName / orderId`）。

## 验证
- `tsc --noEmit` 对 `ApiEditor.tsx` / `apiDoc.ts` 零错误（其余为沙箱缺失依赖 `docx/jquery/html2canvas/jspdf/pptxgenjs`，无关）。
- 解析逻辑已用真实 swagger 文档离线跑通（单独转译 `apiDoc.ts` 后 `importApiSpec` 实测）。
- 整站 `npm run build` 受沙箱环境限制无法跑，需联网正常环境做浏览器冒烟。
