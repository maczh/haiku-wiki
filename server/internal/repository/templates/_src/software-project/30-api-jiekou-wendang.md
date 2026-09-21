---
name: API 接口文档
---
# API 接口文档

> **文档信息**：编号 API-2026-CRM-023 · 服务 云枢 CRM OpenAPI · 编制人 徐一鸣 · 审核 周敏 · 版本 V1.4 · 日期 2026-09-22 · 密级 内部

> **填写说明**：以下为虚构示例内容，套用后请替换为你的实际信息。

## 一、通用约定

所有接口基于 HTTPS，域名 `api.starwave.example`，路径前缀 `/api/v1`，请求与响应均为 `application/json; charset=utf-8`，时间字段统一 RFC 3339（东八区）。

- 鉴权：`Authorization: Bearer <access_token>`，Token 有效期 7 200 s；
- 请求 ID：请求头 `X-Request-Id`，未传由网关生成，响应原样回传；
- 分页：游标分页 `cursor` + `limit`，`limit` 默认 20，上限 200；
- 幂等：写接口支持 `Idempotency-Key`，24 h 内相同键返回首次结果；
- 超时：网关读写超时 3 s，业务侧最长 2.5 s。

```bash
curl -X GET 'https://api.starwave.example/api/v1/opportunities?limit=20&stage=QUOTING' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMDI0In0' \
  -H 'X-Request-Id: 7f3c9a12-4e88-4b0d-9c11-2a6f5d8e0031'
```

## 二、统一响应体

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | int | 0 表示成功，非 0 为业务错误码 |
| `message` | string | 人类可读提示，成功固定为 `ok` |
| `data` | object | 业务数据，错误时为 `null` |
| `requestId` / `costMs` | string / int | 与请求头一致 / 服务端耗时（毫秒） |

```json
{ "code": 0, "message": "ok", "requestId": "7f3c9a12-4e88-4b0d-9c11-2a6f5d8e0031", "costMs": 87,
  "data": { "items": [], "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTIyIn0", "hasMore": true } }
```

## 三、错误码

| 错误码 | HTTP | 含义 | 处理建议 |
| --- | --- | --- | --- |
| `40001` | 400 | 参数校验失败 | 按 `message` 修正参数 |
| `40101` | 401 | Token 缺失或过期 | 重新获取 Token |
| `40301` | 403 | 无数据行级权限 | 联系管理员授权 |
| `40401` | 404 | 资源不存在 | 核对资源 ID |
| `40902` / `40903` | 409 | 客户已冻结 / 同客户同名重复 | 刷新或更换名称后重试 |
| `40904` / `40905` | 409 | 阶段流转校验失败 / 版本不匹配 | 补齐前置条件或重新拉取 |
| `42901` | 429 | 触发限流 | 按 `Retry-After` 退避 |
| `50001` | 500 | 服务内部错误 | 携带 `requestId` 报障 |

> **注意**：`42901` 响应头包含 `Retry-After`（秒）与 `X-RateLimit-Remaining`，客户端必须遵守退避时间。

## 四、接口清单

| 编号 | 方法 | 路径 | 说明 | 限流 |
| --- | --- | --- | --- | --- |
| A1 | POST | `/api/v1/opportunities` | 创建商机 | 20 QPS/用户 |
| A2 | GET | `/api/v1/opportunities` | 分页查询商机 | 100 QPS/用户 |
| A3 | PATCH | `/api/v1/opportunities/{id}/stage` | 阶段流转 | 20 QPS/用户 |
| A4 | GET | `/api/v1/reports/funnel` | 商机漏斗报表 | 5 QPS/用户 |

## 五、接口详述

```mermaid
sequenceDiagram
  participant C as 调用方
  participant G as API 网关
  participant S as 云枢 CRM
  C->>G: 携带 Bearer Token 发起请求
  G->>G: 鉴权、限流、幂等校验
  G->>S: 转发业务请求
  S-->>C: 统一响应体 + requestId
```

### 5.1 A1 创建商机

`POST /api/v1/opportunities`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `customerId` | string | 是 | 客户 ID，19 位雪花号 |
| `name` | string | 是 | 商机名称，长度 2~80 |
| `amount` | int64 | 是 | 预计金额（分），须 > 0 |
| `stage` | string | 否 | 默认 `NEW` |
| `expectedCloseDate` | string | 否 | 期望成交日，`YYYY-MM-DD` |

```json
{ "customerId": "9002817364512038842", "name": "宁波澜川机械 2026 年度采购",
  "amount": 128000000, "stage": "NEW", "expectedCloseDate": "2026-11-30" }
```

响应 `data` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 商机 ID |
| `owner` | object | 归属人，含 `userId` 与 `name` |
| `createdAt` / `stage` | string | 创建时间 / 当前阶段 |

```json
{ "code": 0, "message": "ok", "requestId": "7f3c9a12-4e88-4b0d-9c11-2a6f5d8e0031", "costMs": 142,
  "data": { "id": "9002817364512099127", "stage": "NEW",
    "owner": { "userId": "1024", "name": "郑亦航" }, "createdAt": "2026-09-22T10:14:07+08:00" } }
```

错误场景：客户不存在返回 `40401`；客户冻结返回 `40902`；同客户同名称重复返回 `40903`。

### 5.2 A2 分页查询商机

`GET /api/v1/opportunities?stage=QUOTING&teamId=1024&limit=20&cursor=<opaque>`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stage` | string | 否 | 多值逗号分隔，如 `NEW,QUOTING` |
| `teamId` | int64 | 否 | 团队筛选，受行级权限约束 |
| `cursor` | string | 否 | 上页返回的 `nextCursor`，不透明串 |
| `limit` | int | 否 | 默认 20，上限 200 |

响应 `items` 元素含 `id`、`name`、`amount`（分）、`stage`、`updatedAt`，另有 `nextCursor` 与 `hasMore` 控制翻页。

### 5.3 A3 阶段流转

`PATCH /api/v1/opportunities/{id}/stage`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `targetStage` | string | 是 | 目标阶段，取值 `FOLLOWING/QUOTING/WON/LOST` |
| `reason` | string | 条件 | 转 `LOST` 时必填，字典 12 项 |
| `version` | int | 是 | 乐观锁版本号 |

```json
{ "targetStage": "QUOTING", "version": 7 }
```

校验失败返回 `40904`，`message` 形如 `阶段流转校验失败：须存在至少 1 条跟进记录`。

### 5.4 A4 商机漏斗报表

`GET /api/v1/reports/funnel?startDate=2026-08-01&endDate=2026-09-22&teamId=1024`

响应元素字段为 `stage`、`count`、`amount`（分）、`conversionRate`（相对上一阶段转化率，保留 4 位）。

> **提示**：报表数据来自星河数据中台，延迟不超过 5 min，不适用于实时对账场景。

## 六、限流与幂等

- 用户级限流：令牌桶，按接口清单配额，超限返回 `42901`；
- 应用级限流：单 AppKey 2 000 QPS，由网关层统一拦截；
- 写幂等：`Idempotency-Key` 加乐观锁 `version`，版本不匹配返回 `40905`。

## 七、版本与变更记录

| 版本 | 日期 | 变更内容 | 兼容性 |
| --- | --- | --- | --- |
| V1.2 | 2026-08-05 | 商机列表支持游标分页 | 兼容，弃用 `page` 参数 |
| V1.3 | 2026-08-28 | 新增漏斗报表接口 A4 | 兼容 |
| V1.4 | 2026-09-22 | 创建接口接入幂等键 | 兼容 |

---

| 角色 | 姓名 | 评审意见 | 日期 |
| --- | --- | --- | --- |
| 接口负责人 | 徐一鸣 | 文档通过 | 2026-09-23 |
| 研发负责人 | 周敏 | 补充幂等失败码说明 | 2026-09-24 |
| 测试负责人 | 黄铭 | 错误码覆盖完整 | 2026-09-24 |
