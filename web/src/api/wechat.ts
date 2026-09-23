import request from './request'
import type { AuthResult, User } from '../types'

/** 创建扫码登录会话的返回 */
export interface WeChatQRCodeResult {
  ticket: string
  /** 二维码内容（真实环境是微信 qrconnect 链接，dev 模式是模拟地址） */
  qrcode_url: string
  /** 微信未配置时为 true：前端显示「模拟扫码」按钮以便联调 */
  dev_mode: boolean
}

/** 轮询返回 */
export interface WeChatStatusResult {
  state: 'pending' | 'authorized' | 'needs_profile' | 'expired'
  token?: string
  user?: User
  link_token?: string
  nickname?: string
  avatar?: string
}

/** 绑定 / 注册请求体 */
export interface WeChatBindPayload {
  link_token: string
  mode: 'bind' | 'register'
  // bind 模式
  account?: string
  // bind / register 模式共用
  password?: string
  // register 模式
  username?: string
  email?: string
  name?: string
  phone?: string
}

/** 生成扫码登录会话（拿 ticket + 二维码内容） */
export async function wechatQRCode(): Promise<WeChatQRCodeResult> {
  return request.post('/auth/wechat/qrcode') as Promise<WeChatQRCodeResult>
}

/** 轮询扫码状态 */
export async function wechatStatus(ticket: string): Promise<WeChatStatusResult> {
  return request.get('/auth/wechat/status', { params: { ticket } }) as Promise<WeChatStatusResult>
}

/** 无对应账号时：绑定已有账号或注册新用户 */
export async function wechatBind(payload: WeChatBindPayload): Promise<AuthResult> {
  return request.post('/auth/wechat/bind', payload) as Promise<AuthResult>
}

/** dev 模式专用：模拟扫码完成（无微信凭据时联调用） */
export async function wechatDevComplete(ticket: string, profile?: Partial<WeChatStatusResult>): Promise<{ ok: boolean }> {
  return request.post('/auth/wechat/dev-complete', {
    ticket,
    union_id: profile?.nickname ? `dev-union-${profile.nickname}` : 'dev-union-1',
    open_id: profile?.nickname ? `dev-open-${profile.nickname}` : 'dev-open-1',
    nickname: profile?.nickname || '微信用户',
    avatar: profile?.avatar || '',
  }) as Promise<{ ok: boolean }>
}
