import axios from 'axios'
import { message } from 'antd'

/** token 在 localStorage 的固定 key（与后端约定一致） */
export const TOKEN_KEY = 'hk_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** axios 实例：baseURL=/api，自动附带 Bearer token */
const request = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

request.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

request.interceptors.response.use(
  (resp) => {
    const body = resp.data as { code: number; message: string; data: unknown }
    // 统一响应格式 {code, message, data}：code=0 成功
    if (body.code !== 0) {
      message.error(body.message || '请求失败')
      if (body.code === 40101) {
        // 登录失效：清 token 并跳转登录页
        clearToken()
        if (window.location.pathname !== '/login') {
          window.location.assign('/login')
        }
      }
      return Promise.reject(new Error(body.message || '请求失败'))
    }
    return body.data as never
  },
  (error) => {
    // HTTP 层错误（网络断开 / 非 JSON 响应）
    const status = error?.response?.status
    if (status === 401) {
      clearToken()
      if (window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
    }
    message.error(error?.response?.data?.message || '网络异常，请稍后重试')
    return Promise.reject(error)
  },
)

export default request
