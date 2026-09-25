# OnlyOffice 编辑/阅读切换竞态修复（幽灵 Word 编辑器 + 扩展名错乱）

## 现象（用户报告）
新建表格 / 导入的 .xlsx / .pptx，在编辑态与阅读态之间来回切换几次就报错，被误判成 Word 格式，阅读态有时能识别有时不能；保存进正文的是错误的扩展名。

## 根因
`EditorManager` 是**按 containerId 取到的单例**，而 React 在同一渲染提交内会**两个实例并发 mount**（两个 effect 都调 `create()`）。交错后：

1. create#1 `open(xlsx)` 让出（await）；
2. create#2 `open(xlsx)` 挂出**正确的 xlsx 编辑器**；
3. 此刻 create#1 的宿主组件卸载（cancelled）→ `destroy()` 把单例 `server.reset()`（`id=""`、`fileType="docx"`）；
4. create#1 的 `open` await 恢复 → `mountDocEditor()` 调 `server.getDocument()` 发现 `id=""` → **惰性 `openNew()` 无参兜底 → "New Document.docx" 空 Word 编辑器顶掉正确编辑器**；
5. 自动保存把 `filename="New Document.docx"` 的引用写进正文（字节仍是 xlsx）→ 下次打开 OnlyOffice 按扩展名选错编辑器 → 报错「内容与扩展名不一致：docx」。

复现手法：无头 Chrome 打开编辑态，给 `EditorManager.server.open/openNew/reset`、`mountDocEditor` 打补丁记录调用序列，切换一轮即看到 xlsx 挂载后 ~10ms 内被 docx iframe 顶掉，且 create#1 的 `destroy→reset` 把 server 状态清空。

## 修复
**库层 epoch 守卫（`editor-manager.ts`）**
- `destroy()` 在 `server.reset()` **之前** `this.destroyEpoch++`；
- `create()` 在其自身初始 `destroy()` 之后取样 `epoch`，在 `await server.open` 之后与 `mountDocEditor` 之前两处 `if (this.destroyEpoch !== epoch) return` —— 残留在途的 create 即便恢复也**绝不挂载**，从根上杜绝幽灵编辑器。

**就绪标志（`onlyoffice-manager.ts`）**
- `openDocument` 末尾 `this.ready = this.editor.exists()`：被中止的 create 报告 `isReady()===false`，而非一个"看似就绪"的空实例。

**业务层双保险（`OnlyOfficeEditor.tsx`）**
- 打开时用 `healName` 强制文件名扩展名与 `docType` 一致（历史脏数据也不怕）；
- 保存时 `fileName` 与 `officeRefFromUpload` 一律用 `extForDocType(docType)`；
- `mount()` 至多重试 3 次，`!manager.isReady()` 时明确抛「编辑器被频繁切换打断，请重新进入编辑模式」。

## 验证
- 手工复现（新二进制）：新建表格来回切 5 轮，落库 content = `修复验证表格.xlsx` / ext=xlsx ✓（旧二进制会被写成 .docx）。
- 新增回归套件 `tools/verify/office-toggle-check.sh`（端口 18095，已注册进 `run-all.sh`）：对 sheet/word/ppt 各「新建→保存→反复切换 4 次→再保存」，断言编辑态 iframe app = spreadsheet/word/presentation 且不退化成 Word、落库 ext = xlsx/docx/pptx。
  **结果 PASS=6 FAIL=0 ✅**
- `tsc --noEmit` rc=0；已重建嵌入二进制 `/home/macro/.workbuddy/tmp/haiku-wiki`。

## 改动文件
- `web/src/components/onlyoffice-web-comp/core/editor-manager.ts`
- `web/src/components/onlyoffice-web-comp/core/onlyoffice-manager.ts`
- `web/src/components/editor/OnlyOfficeEditor.tsx`
- `tools/verify/office-toggle-check.sh`（新增）
- `tools/verify/run-all.sh`（注册新套件 + 端口）

## 备注
- 按用户决策：**H5 维持现状**（不接 OnlyOffice）；**git 由用户自己提交**（以上改动均未暂存）。
