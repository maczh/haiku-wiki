# 接口文档导入：支持 Apifox「项目」导出格式

## 问题
Postman 导入正常，Apifox 导入失败（无法识别）。用户提供了真实范例
`寄海海鲜火锅小程序点餐模块.apifox.json`。

## 根因
`importApiSpec` 只识别 Swagger2 / OpenAPI3 / Postman，对 Apifox「项目」导出格式
（顶层 `apifoxProject` 标记，或 `$schema.app === 'apifox'`）直接返回 `null`。

## Apifox「项目」格式要点（与修复相关）
- `apiCollection[]` 是文件夹树：folder 含 `items`，api 叶子含 `api` 字段。
  `api` 内含 `method / path / parameters{path,query,cookie,header} /
  requestBody{type, jsonSchema.$ref} / responses[].jsonSchema.$ref / description / tags`。
- **schema 定义不在顶层 `definitions`**：藏在 `schemaCollection[0].items[]`，
  每个 item 的 `id` 是完整的 `#/definitions/<id>` 字符串（本文件 51 个，正好对应 51 个引用），
  真实 schema 在 `item.schema.jsonSchema`，且多带 `type:"object"` 并含嵌套 `$ref`。

## 改动（`web/src/lib/apiDoc.ts`）
1. `importApiSpec` 增加 Apifox 识别分支。
2. 新增 `parseApifox`：构造合成 `root`（把 `#/definitions/<id>` 映射挂到 `root.definitions`，
   复用现有 `resolveRef` 解析 `$ref`），递归遍历 `apiCollection` 收集接口；
   分组沿用 `bucketByTag`（优先 `api.tags[0]`，否则文件夹名）。
3. 新增 `buildApifoxDefinitions`：递归扫描 `schemaCollection / responseCollection /
   requestCollection / oasComponentCollection` 的 items，建立 id → schema 映射。
4. 新增 `parseApifoxApi`：参数（`header`→headers，`query`+`path`→params）、
   请求体（`application/json` 解析 `$ref` 出示例；form 拼 `k=v`）、
   返回结果（取 200/201 或首条，解析 `$ref` 出示例 + 字段表）。
5. 顺手修复：`sampleFromSchema` 有 `properties` 即按对象采样（避免缺 `type:object` 返回 null）；
   `schemaToFields` 类型推断补 `properties/items → object/array`。

## 实测结果（转译后用真实文件跑）
- 19 个接口 → 5 个分组：购物车管理 3 / 菜品管理 8 / 订单管理 5 / 餐桌管理 2 / WebSocket 1。
- 9 个请求体示例、19 个返回示例全部成功展开 `$ref`（含嵌套对象）。
- `tsc --noEmit` 对改动文件零错误（全量 7 条均为既有缺失依赖 docx/html2canvas/jspdf/pptxgenjs/jquery）。

## 提交
- `ed4c106`。当前 master 领先 origin/master 共 14 个 commit，待 `git push` 授权。
