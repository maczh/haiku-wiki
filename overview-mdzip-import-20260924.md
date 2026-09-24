# Markdown 包（.md.zip）导入功能 — 2026-09-24

## 需求
Markdown 文档导入支持「带内嵌图片的 .md + 图片」压缩成的 .md.zip 包：图片导入后 URL 会变化，需同步改写 .md 里的图片地址再入库。

## 实现方案（纯前端，复用既有链路）
新模块 `web/src/lib/import/mdzip.ts`（jszip 已是直接依赖）：
- **找 md**：zip 内 `*.md` 层级最浅优先；无 md 给出明确报错（不产生损坏文档）。
- **收集图片引用**，三种形态同口径扫描/改写：
  1. 行内 `![alt](ref "title")`（含 `<ref>` 空格包裹写法）
  2. HTML `<img src="...">`
  3. 引用式 `![alt][label]` + `[label]: path`（仅当 label 真被图片用到，不误伤普通链接定义）
- **路径解析**：相对 md 所在目录处理 `./`、`../`、`decodeURIComponent`（URL 编码/空格）、大小写不一致、按文件名唯一兜底匹配；跳过外链/data:/绝对路径。
- **防护**：与后端对齐（单条目 ≤64MB、总量 ≤256MB）；扩展名白名单与后端 `allowedExt` 一致（png/jpg/jpeg/gif/webp/svg/bmp）；只读「md + 被引用图片」所需条目，zip 炸弹读不进内存。
- **去重**：同一文件多种写法引用只上传一次（别名 key 跟随主 key 的 URL）。

两条导入链路都接入（此前就是两份代码，行为必须同步改）：
- `runImport.ts`（H5 MobileImportSheet 共享核心）
- `ImportDialog.tsx`（桌面）

流程：解析 zip → 逐张图片走既有秒传上传（`uploadWithDedup`，进度提示「正在上传图片 i/n」）→ `apply(urlMap)` 重写正文 → `createDoc(markdown)`。
- 单张图片上传失败：保留原路径不中断导入，结果注明「转存 n/m 张」。
- 解析不到的引用（缺失文件、外链）原样保留。

## 其他改动
- `formats.ts`：新增格式项「Markdown 包（.md.zip，含图片）」（ext=zip，accept 过滤自动带上）。
- 桌面/H5 导入提示文案补充 .md.zip 说明。

## 验证
- `tsc --noEmit` 0 错误；`build-embed.sh` ALL_OK。
- mdzip 单测（esbuild 打包 + node）：16/16 通过（重写、别名、URL 编码、子目录 ../、外链/缺失保留、坏 zip/无 md/空 md 拒绝、非图片不收）。
- `e2e-import.sh` 扩展：运行时生成 md.zip 夹具（三种引用形态+同图多写法+URL 编码+外链+缺失图），断言 17/17 通过——markdown 文档生成、正文 5 处/4 个不同 `/uploads/cas/` 地址、相对路径全部重写、转存图片 HTTP 200。
  - 坑：夹具里两张图字节相同会被 CAS 秒传归并成同一 URL，断言「不同 URL 数」时必须用不同字节的图。
- `check-lazy-routes`（14 项）、`embed-prod-check`（17 项）无回归。

## 遗留/注意
- 回归套件生成的 `fixtures/import-fixtures/图文演示.md.zip` 已加 .gitignore。
- `.zip` 扩展名现在会尝试按 Markdown 包解析；纯其他内容的 zip 会得到「未找到 .md 文件」的明确报错。
