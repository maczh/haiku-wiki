# 接口文档调试与历史持久化修改概览

## 需求

1. 调试不再走服务端 `/api/proxy` 转发，改由浏览器直接发起 fetch；返回结果后把请求历史保存到后端。
2. 返回结果 tab 中，调试返回的「响应头 / 响应体」放到「返回结果示例」之前；「返回结果示例」与「返回结果字段表」可折叠隐藏，调试结果返回时自动折叠。
3. 去掉截图上方红框的「接口名称」输入框；接口标题加大（H2）并与接口描述一起放在调试表单上方；下方 Host 输入框允许编辑，留空时使用全局 Host。

## 后端改动

### 新增模型
- `server/internal/model/api_debug_history.go`
  - 表 `api_debug_history`：按 `doc_id + endpoint_id + user_id` 隔离。
  - 字段 `records` 存 JSON 数组（最近 10 条）。

### 新增数据访问
- `server/internal/repository/api_debug_history_repo.go`
  - `FindApiDebugHistory`、`SaveApiDebugHistory`、`UpsertApiDebugHistory`。

### 新增业务层
- `server/internal/service/api_debug_history_service.go`
  - `LoadHistory / SaveHistory / DeleteHistoryByIndex`。
  - 复用 `DocService.loadDocForAccess` 做文档读权限校验。

### 新增 Handler 与路由
- `server/internal/handler/api_debug_history_handler.go`
  - `GET /api/docs/:id/api-debug-history?endpoint_id=xxx`
  - `POST /api/docs/:id/api-debug-history`
  - `DELETE /api/docs/:id/api-debug-history?endpoint_id=xxx&index=n`
- `server/internal/router/router.go` 在 `docs` 组注册上述路由。
- `server/internal/repository/database.go` `AutoMigrate` 中加入新表。

## 前端改动

### `web/src/lib/apiHistory.ts`
- `loadHistory / saveHistory / deleteHistoryByIndex` 改为 `async`。
- 优先调用后端接口；后端失败或离线时回退到 `localStorage`。
- 记录结构新增可选的 `response` 字段（状态码、耗时、响应头/体摘要）。

### `web/src/components/editor/ApiEditor.tsx`
- 移除调试对 `proxyRequest` 的依赖，新增 `browserFetchDebug` 直接用 `fetch` 发起请求（20s 超时）。
- `runDebug` 成功后调用 `saveHistory` 持久化到后端，失败不阻断结果展示。
- 历史抽屉加载/删除改为异步。
- 返回结果 tab 顺序调整为：响应头 → 响应体 → 可折叠的「返回结果示例 + 字段表」；有 `debug` 结果时自动折叠。
- 接口元信息行：
  - 第一行：方法 Select + URI 输入/显示 + 调试/历史/复制按钮。
  - 第二行：Host 输入框（始终可编辑，留空使用全局 Host）+ Content-Type。
  - 第三行：H2 接口标题 + 接口描述（编辑模式为输入框，只读模式纯展示）。
- 更新组件注释，反映「浏览器直接发起」与「Host 可编辑」的新行为。

## 验证

- 前端 `tsc --noEmit -p web/tsconfig.json`：仅余 5 个既有缺失依赖错误（docx/html2canvas/jspdf/pptxgenjs/jquery），与本次无关。
- 后端因沙箱无法联网下载依赖，未能执行 `go build`；新文件已用 `gofmt` 格式化。

## 待办

- 在可联网环境中执行 `cd server && go build ./...` 验证后端编译。
- 确认 `GET/POST/DELETE /api/docs/:id/api-debug-history` 路由在鉴权后可达。
