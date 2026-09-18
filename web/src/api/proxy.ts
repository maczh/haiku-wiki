import request from './request'

/**
 * 接口文档「在线调试」服务端代理（POST /api/proxy）。
 *
 * 浏览器受 CORS 限制无法直接调用第三方接口，且直连内网地址有 SSRF 风险，
 * 故统一走服务端转发；服务端复用 fetch-title 的 SSRF 防护（禁止私网/环回/链路本地）。
 */
export interface ProxyResponse {
  /** HTTP 状态码（200/404/500…） */
  status: number
  /** 状态码对应的原因短语（OK / Not Found…） */
  status_text: string
  /** 请求耗时（毫秒） */
  duration_ms: number
  /** 响应头（键已统一小写） */
  headers: Record<string, string>
  /** 响应体原文（限 10MB） */
  body: string
}

export interface ProxyRequestInput {
  /** 请求方法（缺省 GET；大小写不敏感） */
  method?: string
  /** 完整请求 URL（必填） */
  url: string
  /** 透传请求头（跳过 Host；自动补 Content-Type 由调用方决定） */
  headers?: Record<string, string>
  /** 请求体（GET/HEAD 自动忽略） */
  body?: string
}

/** 通过服务端代理发送一次 HTTP 请求（在线调试用） */
export async function proxyRequest(input: ProxyRequestInput): Promise<ProxyResponse> {
  return request.post('/proxy', input) as Promise<ProxyResponse>
}
