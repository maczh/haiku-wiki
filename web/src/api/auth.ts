import request from './request'
import type { AuthResult, User } from '../types'

/** 注册请求体：username / email / password 必填，其余可选（与后端 registerReq 一致） */
export interface RegisterPayload {
  username: string
  email: string
  password: string
  /** 姓名（省略时后端默认取用户名） */
  name?: string
  /** 部门 */
  department?: string
  /** 手机号（可空，唯一；后端校验 ^1[3-9]\d{9}$） */
  phone?: string
}

/**
 * 注册。
 *
 * 后端在 username / email / phone 冲突时返回 40901，文案形如「该用户名已注册」，
 * 由 axios 响应拦截器统一 toast，此处不再重复处理。
 */
export async function register(payload: RegisterPayload): Promise<AuthResult> {
  return request.post('/auth/register', payload) as Promise<AuthResult>
}

/**
 * 登录：account 可为用户名 / 手机号 / 邮箱任一（后端按 username → phone → email 顺序查）。
 */
export async function login(account: string, password: string): Promise<AuthResult> {
  return request.post('/auth/login', { account, password }) as Promise<AuthResult>
}

export async function me(): Promise<User> {
  return request.get('/auth/me') as Promise<User>
}

export async function updateMe(payload: {
  nickname?: string
  old_password?: string
  new_password?: string
}): Promise<User | { updated: boolean }> {
  return request.put('/users/me', payload)
}
