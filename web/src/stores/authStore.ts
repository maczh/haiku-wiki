import { create } from 'zustand'
import { clearToken, getToken } from '../api/request'
import type { User } from '../types'

interface AuthState {
  token: string | null
  user: User | null
  setAuth: (token: string, user: User) => void
  setUser: (user: User) => void
  logout: () => void
}

/** 全局登录态：token 固定存 localStorage key=hk_token */
export const useAuthStore = create<AuthState>((set) => ({
  token: getToken(),
  user: null,
  setAuth: (token, user) => {
    localStorage.setItem('hk_token', token)
    set({ token, user })
  },
  setUser: (user) => set({ user }),
  logout: () => {
    clearToken()
    set({ token: null, user: null })
    window.location.assign('/login')
  },
}))
