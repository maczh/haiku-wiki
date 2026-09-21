# 撤销仿 Notion/语雀块手柄功能 — 完成概览

## 完成内容

按用户要求，彻底删除编辑器中仿 Notion/语雀的块手柄、下拉菜单、鼠标悬停显示手柄及相关宿主代码。

### 删除的源文件

| 文件 | 说明 |
| --- | --- |
| `web/src/components/editor/notion/NotionEditing.tsx` | 块手柄组件（悬停/冻结/单击菜单/「/」菜单/插入等） |
| `web/src/components/editor/notion/FormatToolbar.tsx` | 选中文本时的格式浮层 |
| `web/src/lib/notionBlocks.ts` | 块转换/行内样式/模板插入逻辑 |
| `web/src/lib/irDom.ts` | Vditor IR DOM 定位辅助（irReset/irBlocks/irBlockIndex/blockIndexAtPoint） |

### 清理的宿主文件

`web/src/components/editor/VditorEditor.tsx` 中移除：
- Notion/FormatToolbar/irDom 导入；
- `ready` 状态、`pickerRef`、`pendingPickRef`、`linkCtx`、`linkForm`；
- `getValue`、`writeValue`、`focusBlock`、`onHostInsert`、`onPickFile`、`onLinkOk`；
- JSX 中的 `<NotionEditing>`、`<FormatToolbar>` 叠加层、隐藏文件 `<input>`、链接 `<Modal>`；
- 精简 antd 导入为 `{ Button, Space, Tooltip }`，并清理所有因删除而失效的导入（`Upload`、`message`、`Form`、`Input`、`Modal`、`uploadWithDedup`、`InboxOutlined`、`useCallback` 等）。

### 删除的回归测试

- `tools/verify/notion-handle-verify.sh`
- `tools/verify/block-hit.test.ts`
- `tools/verify/notion-convert.test.ts`

### 明确保留的文件

- `web/src/components/editor/notion/JsonFoldView.tsx` —— JSON 对象折叠是独立功能，未受影响。

## 验证结果

| 检查项 | 命令/方式 | 结果 |
| --- | --- | --- |
| 前端类型检查 | `node web/node_modules/typescript/bin/tsc --noEmit -p web/tsconfig.json` | **0 errors** |
| 后端构建 | `go build ./...`（server 目录，TMPDIR 指向 workbuddy tmp） | **OK** |
| 前端构建 + embed + 后端二进制 | `bash tools/build/build-embed.sh` | **ALL_OK**，embed 3020 文件 / 90M |
| 生产形态冒烟 | agent-browser + 系统 Chrome，打开 `/books/1?docId=1&tab=edit` | `vditor=1 \| ir=1 \| reset=4 \| handles=0`，**无页面/控制台 JS 错误** |

## 提交

- 提交哈希：`102d460`
- 提交信息：`revert(editor): remove Notion/Yuque-style block handle, dropdown menu and hover behavior`
- 改动：8 个文件，+4 / -2005 行

## 截图证据

`/home/macro/.workbuddy/tmp/smoke-editor.png`：编辑器正常渲染 Vditor，无遗留 Notion 手柄/菜单。
