# 公司文库「所有人可编辑」（文档级写权限）

> 改动文件：`server/internal/model/doc.go`、`server/internal/service/book_service.go`、`server/internal/repository/doc_repo.go`、
> `server/internal/handler/doc_handler.go`、`server/internal/router/router.go`、
> `web/src/types.ts`、`web/src/api/docs.ts`、`web/src/pages/BookPage.tsx`、`web/src/components/tree/KnowledgeTree.tsx`

## 1. 背景

公司知识库默认是**全员只读**（写权限只给管理员与被显式授权的用户）。但有些文档天生就是要让全员动笔的——
「意见建议」「bug 反馈」这类收集型文档。为此引入**文档级**标记 `public_edit`：开启后任何**登录用户**都能直接改这一篇，
不用被逐个加进写权限名单。

## 2. 数据模型

`docs` 表新增 `public_edit bool`（`gorm:"default:false"`）。标记只在**公司知识库**（`books.is_company_kb`）里生效；
个人/团队库即便该字段被置上（脏数据、迁移残留）也不生效——库级权限体系不能被文档级标记撕开口子。

## 3. 权限判定的唯一口径

新增 `service.CanWriteDoc(doc, book, uid)`，三级短路：

1. 库级写权限（`canWriteDoc`：owner / members 库 / 团队写成员 / 公司库管理员与被授权用户）
2. 文档协作者
3. `doc.PublicEdit && book.IsCompanyKB`

`loadDocForAccess(write=true)` 与 handler 下发的 `can_write` 都走它，避免「前端说可编辑、保存时 403」的割裂。

## 4. 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `PATCH` | `/api/docs/:id/public-edit` | 开关文档级「所有人可编辑」；body `{enabled: bool}` |
| `GET` | `/api/docs/:id` | 响应新增 `can_write`：当前用户对该文档的**合成**写权限 |

`PATCH` 的准入门槛：文档必须属于公司知识库（否则 40001 `仅公司知识库可设置「所有人可编辑」`），
操作人必须是管理员或该库 owner（否则 40301）。重复设置同一值幂等返回，不报错。

## 5. 前端

- 目录树：公司文库里管理员/库 owner 右键文档可见「设为/取消『所有人可编辑』」；已开启的文档标题后带紫色 `TeamOutlined` 图标。
- 文档页顶栏：开启后显示紫色 Tag「所有人可编辑」。
- 写权限以**后端下发的 `can_write`** 为准（`docCanWrite ?? bookCanWrite`）：公司文库里「库只读 + 文档可编辑」是合法组合，
  前端不能再只用库级 `can_write` 判断编辑按钮。

## 6. 测试

`server/internal/service/public_edit_test.go` 覆盖：开启后普通员工可真正保存（走完整 `UpdateDoc` 链路）、
`uid=0` 永不放行、个人库不生效（含绕过业务层硬写标记的兜底）、非管理员/非 owner 被拒、库 owner 可操作、重复设置幂等。

路由层 `TestQAImportURL*` 同步改造：URL 导入不再抓取页面，因此不存在 SSRF 面，
用例改为校验「协议白名单（仅 http/https）+ 网址原样存为 `doc_type=web` 的 WebRef JSON」。
