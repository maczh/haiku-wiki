import request from './request'
import type { AdminUser, AdminUserList } from '../types'

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
