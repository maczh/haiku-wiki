import request from './request'
import type { AuthResult, User } from '../types'

export async function register(email: string, password: string, nickname?: string): Promise<AuthResult> {
  return request.post('/auth/register', { email, password, nickname }) as Promise<AuthResult>
}

export async function login(email: string, password: string): Promise<AuthResult> {
  return request.post('/auth/login', { email, password }) as Promise<AuthResult>
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
