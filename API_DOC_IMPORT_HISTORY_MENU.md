# 接口文档功能修改（导入分组 / 调试历史 / 右键菜单）

> 改动文件：`web/src/lib/apiDoc.ts`、`web/src/lib/apiHistory.ts`（新增）、`web/src/components/editor/ApiEditor.tsx`

## 1. 导入按 tags 分组

- **Swagger2 / OpenAPI3 / Apifox**（三者同构）：接口按其 `operation.tags` 字段归入对应分组——取第一个 tag 作为分组名；若接口无 tags，则回退到文档 `info.title`，再无则归入「未分组」。
- **Postman**：沿用其文件夹（folder）结构作为分组——每个直接包含请求的文件夹成为一个分组（自动适配 Postman 的「分组字段」即 folder）。
- 实现细节：`apiDoc.ts` 新增 `bucketByTag()` 桶函数，`parseSwagger2` / `parseOpenAPI3` 不再把所有接口塞进单一「Swagger/OpenAPI 导入」分组，而是按 tag 拆成多个分组；`mergeImported` 仍按「空默认分组则替换、否则追加」的逻辑合并。

## 2. 调试历史记录

- 新增 `web/src/lib/apiHistory.ts`：以 `localStorage` 持久化，key 为 `apidoc_history_${docId ?? 'local'}_${endpointId}`，**同一接口仅保留最近的 10 条**（新的在前，超限裁剪）。
- 每次点击「调试」发送请求后，自动记录：调用时间、接口（method + uri）、请求头、请求参数、请求体（含 base_host）。
- 界面新增「**历史**」按钮（接口元信息行，调试按钮旁）→ 打开抽屉，列出该接口的历史记录（方法标签 + uri + 时间 + 统计：请求头/参数/请求体数量），每条可：
  - **填入**：一键回填到当前接口的请求头 / 请求参数 / 请求体（含 body_type）；
  - **删除**：按索引移除该条记录。
- 阅读模式（只读）下「历史」按钮仍可见、可查看与回填（回填仅在可编辑态持久化，符合只读约束）。

## 3. 接口列表右键菜单

- 左侧接口列表项支持**右键菜单**（`Dropdown` `contextMenu` 触发，仅编辑模式）：
  - **重命名**：弹窗输入新名称，确认后更新（无论当前是否选中该接口都生效）；
  - **移动分组**：弹窗选择目标分组（自动排除当前分组），确认后把接口从原分组移到目标分组；
  - **删除**：二次确认后删除该接口。
- 原有的「X」快捷删除按钮保留，与右键菜单并存。

## 验证

- `tsc --noEmit` 对 `ApiEditor.tsx` / `apiDoc.ts` / `apiHistory.ts` **零错误**；其余报错均为沙箱缺失依赖（`docx/jquery/html2canvas/jspdf/pptxgenjs`），与本次改动无关。
- 整站 `npm run build` 仍受沙箱环境限制无法跑，需在联网正常环境做浏览器冒烟（建议覆盖：导入带多 tags 的 Swagger、点击调试后历史出现并可回填、右键改名/移动/删除）。
