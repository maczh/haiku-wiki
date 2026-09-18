import request from './request'
import type { Book, Team, TeamDetail, TeamMemberView, TeamWithCount } from '../types'

/**
 * 团队接口。
 *
 * 权限模型（后端 TeamService 为单一事实来源）：
 *   - 创建者自动成为团队 admin，且不可被移除 / 降权；
 *   - 团队成员任意角色可读团队文库，admin/read_write 可写，read_only 只读；
 *   - 增删成员、改成员角色、编辑/删除团队、新建团队文库均需团队 admin。
 */

/** 创建团队（创建者自动 admin，后端同时自动创建一个团队文库） */
export async function createTeam(payload: { name: string; description?: string }): Promise<Team> {
  return request.post('/teams', payload) as Promise<Team>
}

/** 我参与的团队（创建或已加入），含文库数 */
export async function listTeams(): Promise<TeamWithCount[]> {
  return request.get('/teams') as Promise<TeamWithCount[]>
}

/** 团队详情（含当前用户在该团队的角色） */
export async function getTeam(id: number): Promise<TeamDetail> {
  return request.get(`/teams/${id}`) as Promise<TeamDetail>
}

/** 修改团队名 / 简介（仅团队 admin） */
export async function updateTeam(
  id: number,
  payload: { name?: string; description?: string },
): Promise<Team> {
  return request.put(`/teams/${id}`, payload) as Promise<Team>
}

/** 删除团队（仅团队 admin） */
export async function deleteTeam(id: number): Promise<{ deleted: boolean }> {
  return request.delete(`/teams/${id}`) as Promise<{ deleted: boolean }>
}

/** 团队成员列表（需为团队成员） */
export async function listTeamMembers(id: number): Promise<TeamMemberView[]> {
  return request.get(`/teams/${id}/members`) as Promise<TeamMemberView[]>
}

/** 按用户名 / 手机号 / 姓名 / 邮箱 添加成员（仅团队 admin） */
export async function addTeamMember(
  id: number,
  payload: { identifier: string; role?: 'admin' | 'read_write' | 'read_only' },
): Promise<TeamMemberView> {
  return request.post(`/teams/${id}/members`, payload) as Promise<TeamMemberView>
}

/** 移除成员（仅团队 admin；创建者不可移除） */
export async function removeTeamMember(id: number, uid: number): Promise<{ removed: boolean }> {
  return request.delete(`/teams/${id}/members/${uid}`) as Promise<{ removed: boolean }>
}

/** 修改团队成员权限（仅团队 admin） */
export async function setTeamMemberRole(
  id: number,
  uid: number,
  role: 'admin' | 'read_write' | 'read_only',
): Promise<TeamMemberView> {
  return request.patch(`/teams/${id}/members/${uid}`, { role }) as Promise<TeamMemberView>
}

/** 团队文库列表（团队成员任意角色可见） */
export async function listTeamLibraries(id: number): Promise<Book[]> {
  return request.get(`/teams/${id}/books`) as Promise<Book[]>
}

/** 新建团队文库（仅团队 admin；name 缺省时后端取「团队名+文库」） */
export async function createTeamLibrary(id: number, name?: string): Promise<Book> {
  return request.post(`/teams/${id}/books`, { name: name ?? '' }) as Promise<Book>
}
