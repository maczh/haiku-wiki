# 增量 PRD：接口文档「字段说明可编辑 + 多格式导出」

> 文档类型：增量 PRD（仅描述本次变更，不重写整篇接口文档编辑器 PRD）
> 模块：`doc_type=api`（仿 Apifox 的接口文档编辑器）
> 作者：产品经理 许清楚
> 约束：不新增数据库表；字段说明随 `docs.content` 内的 endpoint 对象一起持久化，复用现有 2.5s 防抖自动保存链路。

---

## 1. 变更目标与范围

**一句话目标**：让接口请求体 / 返回结果的「字段说明」可人工补写并持久化，重导入/刷新时按字段路径自动回填；同时把接口文档导出为 Swagger / Postman / Apifox / Markdown / Word 五种格式。

**本次明确不做（边界）**：
- 不做字段说明的多语言、版本对比、团队共享词库 / 术语表。
- 不做「手动新增任意字段行」（字段表始终由请求体 JSON / 上游 schema 推导，用户只能编辑「说明」）。
- 不做「必填」列的人工覆盖持久化（必填仍由 schema/body 推导，见待确认 Q5）。
- 不新增导出格式的后端渲染进程；docx 复用既有 `BuildDocx`（Markdown → docx）流水线。
- 不做导出模板的自定义样式（P1 候选）。

---

## 2. 用户故事

| ID | 角色 | 场景 | 验收标准（可测） |
|----|------|------|------------------|
| US-1 | 接口文档维护者 | 在请求体「字段参数说明」表中，对 `data.list[].dishId` 补写中文说明「菜品ID」 | 失焦/自动保存后刷新页面，该说明仍在；`docs.content` 中该 endpoint 的 `body_fields` 含 `{"name":"data.list[].dishId","description":"菜品ID"}` |
| US-2 | 接口文档维护者 | 在返回结果字段表中，对 `code` 补写「状态码」 | 同上，校验 `response_fields` 对应行 `description="状态码"` 持久化 |
| US-3 | 接口文档维护者 | 重新导入同一份 Swagger/Apifox 文件 | 之前人工补写的说明按字段路径自动回填，无需重填；未被人工改过的字段展示上游 schema 的 description |
| US-4 | 接口文档维护者 | 通过 URL 在线刷新（后端 `mergeApiDoc`） | 同一 `method+uri` 接口的旧说明被保留并按字段回填，调试历史不受影响 |
| US-5 | 后端/前端联调同学 | 把接口文档导出为 Swagger 2.0 JSON | 文件可被 Swagger UI 直接 Import；含各接口参数与人工补写的字段说明 |
| US-6 | 测试同学 | 把接口文档导出为 Postman Collection v2.1 | 可被 Postman 直接导入，接口、参数、人工说明可识别 |
| US-7 | 交付同学 | 把接口文档导出为 Apifox 项目 JSON | 可被 Apifox 直接导入（且能回灌进本系统的导入解析器） |
| US-8 | 文档阅读者 | 导出 Markdown / Word | md 与 docx 均包含「请求体字段表」「返回结果字段表」及人工说明 |

---

## 3. 需求池（P0 / P1 / P2）

### P0（必须交付）

| 编号 | 标题 | 说明 | 验收 |
|------|------|------|------|
| P0-1 | 请求体字段说明可编辑 + 持久化 | `FieldTable` 的「说明」列改为可编辑（就地 Input），编辑写入 `endpoint.body_fields`（`ApiField[]`），经 `patchEndpoint` → 现有 2.5s 防抖 `patchDoc` 落库 | 改后刷新页面不丢；空说明展示「—」 |
| P0-2 | 返回结果字段说明可编辑 + 持久化 | 同上，写入 `endpoint.response_fields[].description` | 同上 |
| P0-3 | 请求体字段说明重导入/刷新按字段回填 | 见 §3.4 匹配规则；前端 `mergeImported` 与后端 `mergeApiDoc` 均实现回填 | 重导入后人工说明按路径还原 |
| P0-4 | 返回结果字段说明重导入/刷新回填 | 同上，作用于 `response_fields` | 同上 |
| P0-5 | 导出 Swagger 2.0（`swagger`） | 后端新增 `BuildApiDocSwagger`，`formatsByDocType["api"]` 增加 `swagger`；`Convert()` 分支支持 | Swagger UI 可导入；含人工说明 |
| P0-6 | 导出 Postman Collection v2.1（`postman`） | 后端新增 `BuildApiDocPostman` | Postman 可导入；含人工说明 |
| P0-7 | 导出 Apifox 项目 JSON（`apifox`） | 后端新增 `BuildApiDocApifox`（结构见 §3.5 / 待确认 Q1） | Apifox 可导入且能回灌本系统导入器 |
| P0-8 | 导出 Markdown（`md`，增强） | 现有 `BuildApiDocMD` 增加渲染「请求体字段表」「返回结果字段表」（含说明） | md 含两张字段表 |
| P0-9 | 导出 Word（`docx`） | `formatsByDocType["api"]` 增加 `docx`，`Convert()` 调 `BuildDocx(BuildApiDocMD(...))` | 产出可读 docx，含字段表 |
| P0-10 | 修正前端 `clientFormatsFor('api')` | `web/src/lib/export/index.ts` 对 `api` 类型返回 `[]`，不再错误注入浏览器端 docx/pptx/ppts/pdf（避免拿接口 JSON 套 markdown 模板） | 接口文档导出对话框只显示服务端格式清单 |

### P1（应该做）
- P1-1 **OpenAPI 3.0 选项**：在 `swagger` 之外，提供 `openapi3` 导出（待确认 Q2）。
- P1-2 **批量操作**：对单个接口/全部分组提供「清空全部人工说明」「用上游说明覆盖」按钮。
- P1-3 **导出细节选项**：docx 增加目录/封面；md 可选是否包含 body 示例 JSON。
- P1-4 **字段说明搜索**：在字段表上方提供按字段名/说明的本地过滤输入框。

### P2（可选）
- P2-1 字段说明的「复制自其他接口同名路径」智能建议。
- P2-2 导出为 HTML / PDF（当前 api 类型不提供，若需则另立需求）。

---

### 3.4 匹配 / 回填规则（关键，唯一确定，不得歧义）

> **回填匹配规则（原文）**
>
> 重导入 / 刷新时，先按「接口自然键 `method+uri`」（与后端 `mergeApiDoc` 的 `epKey` 一致）定位同一接口，再按「字段路径（`ApiField.name`，如 `data.list[].dishId`）」逐字段匹配。规则如下：
>
> 1. **字段行（字段名 / 类型 / 必填）一律以「本次新导入 / 上游解析结果」为准**，保证字段表始终与当前真实 schema 同步。
> 2. **字段「说明」的取值优先级**：
>    - ① 旧文档中该字段路径上「人工保存的说明」若**非空** → 采用（人工优先，保留补写成果）；
>    - ② 否则采用本次上游 schema 自带的 `description`；
>    - ③ 都为空 → 空（展示「—」）。
> 3. **上游已删除的字段**（新解析结果里不存在该路径）→ **直接丢弃**，不保留陈旧行。
> 4. **本增量不提供「手动新增任意字段行」能力**，故不存在「人工新增的非 body 字段」；若确有游离字段（如历史脏数据），按第 3 条一并丢弃。
>
> **理由**：说明是用户投入成本的资产，重导入绝不该清空；同时字段结构必须始终跟随真实 schema，避免展示已不存在的字段或让用户维护两套事实。

**两条重导入路径如何实现该规则：**
- **前端文件导入（`mergeImported`）**：在 `mutate` 回调内，先从旧 `doc`（即 `d`）构建「`method+uri` → {`body_fields` 路径说明映射, `response_fields` 路径说明映射}」的快照，再对 `parsed` 生成的新 endpoint 逐字段按上述规则覆盖 `description`，最后返回合并后的 doc。被删除的旧分组其说明只要在快照里就仍可被复用。
- **后端 URL 刷新（`mergeApiDoc`）**：对 `existByKey[k]` 命中的 endpoint，`ep`（新解析）的 `response_fields` / `body_fields` 与 `ex`（旧）按上述规则调和一个 `reconcileFields(new, old)`；`apidoc.Parse` 需先为 JSON 请求体补算 `BodyFields`（移植前端 `jsonToFields`）。调和后再做 `endpointChanged` 计数。

### 3.5 导出格式取值约定（硬约束）

| 取值 | 含义 | 备注 |
|------|------|------|
| `swagger` | Swagger 2.0 JSON，可被 Swagger UI 直接 Import | P0 |
| `postman` | Postman Collection v2.1 JSON | P0 |
| `apifox` | Apifox 项目导出 JSON | P0（结构见 Q1） |
| `md` | Markdown（已有，本次增强含字段表） | P0 |
| `docx` | Word 文档 | P0 |
| `json` | 接口数据原文（保持现有） | 维持 |

---

## 4. 交互与 UI 设计稿

### 4.1 字段参数说明表「就地编辑」

**结论：列内就地编辑「说明」列，失焦即写入（复用现有防抖自动保存）。** 不弹窗——字段表行数可能很多，弹窗成本高；列内编辑与现有「请求参数」说明列交互一致。

```
请求体（JSON）Tab
┌──────────────────────────────────────────────────────────┐
│ [折叠预览]                                                 │
│ { "data": { "list": [ { "dishId": 1 } ] } }   (可编辑文本) │
│ ── 字段参数说明 ──                                          │
│ ┌────────────────┬───────┬──────────────────────┬───────┐ │
│ │ 字段名          │ 类型   │ 说明(可编辑)          │ 必填   │ │
│ ├────────────────┼───────┼──────────────────────┼───────┤ │
│ │ data.list[].   │ array │ [Input: 菜品列表]     │ 否    │ │
│ │   dishId       │ int64 │ [Input: 菜品ID]  ←编辑│ 是    │ │
│ │ code           │ int64 │ [Input: ] 空→显示—   │ 否    │ │
│ └────────────────┴───────┴──────────────────────┴───────┘ │
│ 说明列：antd Input，onChange→patchEndpoint({body_fields})  │
│         → 触发已有 2.5s 防抖 patchDoc 自动保存              │
└──────────────────────────────────────────────────────────┘

返回结果 Tab（Collapsible「返回结果示例（文档说明）」内）
┌────────────────┬───────┬──────────────────────┬───────┐
│ 字段名          │ 类型   │ 说明(可编辑)          │ 必填   │
│ code            │ int   │ [Input: 状态码]  ←编辑│ 是    │
│ data.list[].    │ array │ [Input: ]            │ 否    │
│   dishId        │ int64 │ [Input: 菜品ID]      │ 否    │
└────────────────┴───────┴──────────────────────┴───────┘
```

**渲染数据来源（编辑态）**：
- 请求体表：`mergeBodyFields(jsonToFields(ep.body), ep.body_fields)` —— 行结构（name/type）实时取自 body JSON，仅 `description` 按路径叠加 `body_fields`。body 变化时新字段自动出现（说明为空），旧字段说明按路径保留。
- 返回结果表：`ep.response_fields ?? jsonToFields(ep.response_example)`，并就地编辑 `response_fields[].description`。

### 4.2 导出入口与格式选择

**结论 / 推荐：不在接口编辑器顶栏新增「导出」按钮，复用文档级通用导出对话框。**
- 现有通用 `ExportDialog` 的选项完全由服务端 `GET /api/export/docs/:id/formats` 返回清单驱动。只要 `formatsByDocType["api"]` 增加 `swagger/postman/apifox/docx`，这五个格式会自动出现在对话框中，无需前端改 UI。
- 新增入口会造成「文档级导出」与「编辑器内导出」两套入口，易混淆且重复。
- **例外回退**：若实际联调发现接口文档的打开场景没有文档级工具条，再在 `ApiEditor` 顶栏追加一个调用同一 `ExportDialog` 的「导出」入口（实现成本极低，复用现有组件）。

```
文档级工具条（已有）                接口编辑器顶栏（本次不动）
┌─────────────────────────────┐   ┌──────────────────────────┐
│ 标题 … [导入▼] [保存] [刷新] │   │ （不加导出按钮，复用上方） │
│        [导出] ← 点此打开     │   └──────────────────────────┘
└─────────────────────────────┘
            │
            ▼  ExportDialog（通用，服务端驱动）
   ┌──────────────────────────────────────┐
   │ 选择导出格式（单选）：                 │
   │ ○ 接口文档（.md）        服务端       │
   │ ○ 接口数据（.json）      服务端       │
   │ ○ Swagger 2.0（.json）  服务端  [新]  │
   │ ○ Postman v2.1（.json） 服务端  [新]  │
   │ ○ Apifox 项目（.json）  服务端  [新]  │
   │ ○ Word（.docx）         服务端  [新]  │
   │ 文件名：[__________] .md              │
   │                [取消] [导出]          │
   └──────────────────────────────────────┘
```

---

## 5. 待确认问题（每条附推荐默认值）

| # | 问题 | 推荐默认值 |
|---|------|-----------|
| Q1 | `apifox` 导出格式的实现形态？ | 生成 Apifox 可识别的「项目导出 JSON」（结构复用前端 `importApiSpec` 能识别的 `apifoxProject` 标记 / `$schema.app="apifox"`，apiCollection 承载接口，description 填充人工说明）。不偷懒直接复用 swagger 文件，保证 Apifox 原生导入与回灌本系统都通。 |
| Q2 | Swagger 版本是否只要 2.0，还是同时给 OpenAPI 3.0？ | 仅 Swagger 2.0（任务硬约束）；OpenAPI 3.0 列为 P1-1，默认暂不做。 |
| Q3 | 上游已删除的字段是否真的丢弃（而非保留为「已失效字段」）？ | 丢弃（见 §3.4 第 3 条），与请求体实时推导保持一致。 |
| Q4 | docx 导出内容深度？ | 复用 `BuildApiDocMD` 生成的 Markdown（含两张字段表与说明）喂给现有 `BuildDocx`，不另做精细排版；精细排版列 P1-3。 |
| Q5 | 「必填」列是否也允许人工覆盖并持久化？ | P0 仅允许编辑「说明」；必填保持由 schema/body 推导，不持久化人工改必填。若需，另立 P1。 |
| Q6 | Swagger / Postman / Apifox 导出里，返回结果字段说明是否统一用「回填后」的说明？ | 是，统一填入调和后的 `response_fields` 说明，与界面展示一致。 |

---

## 6. 变更点清单（技术映射，供架构师）

| 变更 | 文件 | 说明 |
|------|------|------|
| 数据契约：新增 `ApiEndpoint.body_fields?: ApiField[]` | `web/src/lib/apiDoc.ts` | 请求体字段说明持久化载体 |
| `FieldTable` 说明列可编辑 | `web/src/components/editor/ApiEditor.tsx` | 就地 Input；请求体走 `mergeBodyFields(jsonToFields(ep.body), ep.body_fields)` |
| 前端重导入回填 | `web/src/components/editor/ApiEditor.tsx` `mergeImported` | 旧 doc 快照 → 按规则覆盖新 endpoint 的 body/response 说明 |
| 修正浏览器端格式清单 | `web/src/lib/export/index.ts` `clientFormatsFor` | `api` 分支返回 `[]` |
| 后端契约：新增 `ApiEndpoint.BodyFields`；`Parse` 为 JSON 体补算 `BodyFields` | `server/internal/service/apidoc/parser.go` | 供刷新路径回填 |
| 后端刷新回填 | `server/internal/service/api_refresh_service.go` `mergeApiDoc` | 新增 `reconcileFields(new, old)` 调和说明 |
| 导出契约补齐 | `server/internal/service/exportx/api_doc.go` `ApiEndpoint` | 增加 `ResponseFields` 与 `BodyFields`，`parseApiDoc` 映射 |
| 导出格式注册 | `server/internal/service/exportx/export.go` | `formatsByDocType["api"]` 增加 `swagger/postman/apifox/docx`；`Convert()` 增加分支 |
| 新增导出构建器 | `server/internal/service/exportx/api_doc.go` | `BuildApiDocSwagger` / `BuildApiDocPostman` / `BuildApiDocApifox`；`BuildApiDocMD` 增加字段表渲染；docx 复用 `BuildDocx` |

**范围确认**：全部变更仅触及上述文件与 `docs.content` JSON 结构（新增 `body_fields` 数组），不涉及新建表、不改动自动保存与权限链路。
