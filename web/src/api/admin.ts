import request from './request'
import type {
  AdminUser,
  AdminUserList,
  BookWriterView,
  LibraryView,
  UserLibraries,
  SystemConfig,
  MigrateStatus,
  DocNode,
} from '../types'

/**
 * 管理员接口（全部需 role=admin，后端 RequireAdmin 中间件拦截）。
 */

/** 分页列出全部用户 */
export async function listUsers(page = 1, pageSize = 20): Promise<AdminUserList> {
  return request.get('/admin/users', { params: { page, page_size: pageSize } }) as Promise<AdminUserList>
}

/** 启用（1）/ 禁用（0）用户；管理员账号与自身不可操作（后端校验） */
export async function setUserStatus(id: number, status: number): Promise<AdminUser> {
  return request.patch(`/admin/users/${id}/status`, { status }) as Promise<AdminUser>
}

/** 重置密码：不传 password 时由后端生成随机密码，返回最终生效的明文（仅此一次） */
export async function resetUserPassword(id: number, password?: string): Promise<{ password: string }> {
  return request.patch(`/admin/users/${id}/reset-password`, { password: password ?? '' }) as Promise<{
    password: string
  }>
}

// ---------- 公司知识库写权限授权（仅管理员） ----------

/** 列出公司知识库的写授权用户（含用户展示信息） */
export async function listBookWriters(bookId: number): Promise<BookWriterView[]> {
  const res = (await request.get(`/admin/books/${bookId}/writers`)) as { writers: BookWriterView[] }
  return res.writers
}

/** 授予某用户公司知识库写权限 */
export async function addBookWriter(bookId: number, userId: number): Promise<BookWriterView> {
  return request.post(`/admin/books/${bookId}/writers`, { user_id: userId }) as Promise<BookWriterView>
}

/** 撤销某用户公司知识库写权限 */
export async function removeBookWriter(bookId: number, userId: number): Promise<{ revoked: boolean }> {
  return request.delete(`/admin/books/${bookId}/writers/${userId}`) as Promise<{ revoked: boolean }>
}

// ---------- 用户删除 / 恢复 / 彻底删除 ----------

/** 已软删用户列表 */
export async function listDeletedUsers(page = 1, pageSize = 20): Promise<AdminUserList> {
  return request.get('/admin/users/deleted', { params: { page, page_size: pageSize } }) as Promise<AdminUserList>
}

/** 软删用户（管理员不能删自己 / 管理员账号） */
export async function deleteUser(id: number): Promise<{ deleted: boolean }> {
  return request.delete(`/admin/users/${id}`) as Promise<{ deleted: boolean }>
}

/** 恢复被软删的用户 */
export async function restoreUser(id: number): Promise<{ restored: boolean }> {
  return request.post(`/admin/users/${id}/restore`) as Promise<{ restored: boolean }>
}

/** 彻底删除用户 */
export async function purgeUser(id: number): Promise<{ purged: boolean }> {
  return request.delete(`/admin/users/${id}/purge`) as Promise<{ purged: boolean }>
}

// ---------- 用户文库管理 ----------

/** 某用户的私有文库与团队文库 */
export async function listUserLibraries(id: number): Promise<UserLibraries> {
  return request.get(`/admin/users/${id}/libraries`) as Promise<UserLibraries>
}

/** 文库文档树（平铺列表，前端自行组树） */
export async function listLibraryDocs(bookId: number): Promise<DocNode[]> {
  return request.get(`/admin/books/${bookId}/docs`) as Promise<DocNode[]>
}

/** 删除用户文库（先级联软删文档，再删库） */
export async function deleteLibrary(id: number): Promise<{ deleted: boolean }> {
  return request.delete(`/admin/books/${id}`) as Promise<{ deleted: boolean }>
}

/** 备份用户文库为 zip 并触发浏览器下载 */
export async function backupLibrary(id: number): Promise<void> {
  const res = (await request.get(`/admin/books/${id}/backup`, {
    responseType: 'blob',
  })) as Blob
  const url = URL.createObjectURL(res)
  const a = document.createElement('a')
  a.href = url
  a.download = `library-${id}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---------- 系统配置 ----------

/** 读取可编辑的系统配置 */
export async function getSystemConfig(): Promise<SystemConfig> {
  return request.get('/admin/system-config') as Promise<SystemConfig>
}

/** 保存系统配置（后端写文件并重启生效） */
export async function saveSystemConfig(cfg: SystemConfig): Promise<{ message: string }> {
  return request.put('/admin/system-config', cfg) as Promise<{ message: string }>
}

// ---------- 系统迁移（数据库 / 存储） ----------

/** 迁移前测试数据库连接 */
export async function testDatabaseConnection(input: Record<string, unknown>): Promise<{ message: string }> {
  return request.post('/admin/migrate/database/test', input) as Promise<{ message: string }>
}

/** 迁移前测试存储连接 */
export async function testStorageConnection(input: Record<string, unknown>): Promise<{ message: string }> {
  return request.post('/admin/migrate/storage/test', input) as Promise<{ message: string }>
}

/** 启动数据库迁移（异步） */
export async function migrateDatabase(input: Record<string, unknown>): Promise<{ job: MigrateStatus }> {
  return request.post('/admin/migrate/database', input) as Promise<{ job: MigrateStatus }>
}

/** 启动存储迁移（异步） */
export async function migrateStorage(input: Record<string, unknown>): Promise<{ job: MigrateStatus }> {
  return request.post('/admin/migrate/storage', input) as Promise<{ job: MigrateStatus }>
}

/** 轮询迁移进度 */
export async function migrateStatus(): Promise<{ job: MigrateStatus }> {
  return request.get('/admin/migrate/status') as Promise<{ job: MigrateStatus }>
}
