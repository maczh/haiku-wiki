import axios from 'axios'
import { message } from 'antd'

/** token 在 localStorage 的固定 key（与后端约定一致） */
export const TOKEN_KEY = 'hk_token'

/**
 * 业务错误：把后端的 `code` 带到 Error 上，调用方据此做分级处理。
 *
 * 为什么需要它：秒传链路的降级判据是**业务码**而不是 HTTP 状态码
 * （`40401` 未知 md5 / `40901` size 不符 → 退化为普通上传；其它码也同样降级）。
 * 只抛 `new Error(message)` 会丢掉这个信息，调用方只能靠文案匹配 —— 不可靠。
 * 继承 Error，故既有 `err instanceof Error` / `err.message` 的用法完全不受影响。
 */
export class ApiError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

declare module 'axios' {
  export interface AxiosRequestConfig {
    /**
     * silent=true 时不弹全局错误提示，由调用方自行处理。
     *
     * 用于**可降级的探测类请求**（秒传预检 / 秒传落 meta）：老后端没有这些接口、
     * 或网络抖动时，全局 toast 会先弹一条红色错误再继续走普通上传 —— 用户看到
     * "失败"却又成功了，纯属噪音。这类请求必须静默，失败即降级。
     */
    silent?: boolean
  }
}

/** 读取请求配置上的 silent 标记（响应/错误两条路径共用）。 */
function isSilent(config: unknown): boolean {
  return Boolean(config && (config as { silent?: boolean }).silent)
}

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
      if (!isSilent(resp.config)) message.error(body.message || '请求失败')
      if (body.code === 40101) {
        // 登录失效：清 token 并跳转登录页
        clearToken()
        if (window.location.pathname !== '/login') {
          window.location.assign('/login')
        }
      }
      return Promise.reject(new ApiError(body.code, body.message || '请求失败'))
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
    if (!isSilent(error?.config)) {
      message.error(error?.response?.data?.message || '网络异常，请稍后重试')
    }
    return Promise.reject(error)
  },
)

export default request
