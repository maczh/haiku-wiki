/**
 * 百度网盘 / 阿里云盘的 OAuth 授权（浏览器侧）。
 *
 * 流程：前端拿 authorize_url → window.open 跳到官方授权页 → 官方 302 回后端
 * /callback → 后端换 token 并建连接 → 回调页 postMessage 通知 opener 后自关。
 *
 * 消息体 `{type:'hk-netdisk-oauth', ok, id, name, message}` 与后端
 * `netdiskOAuthMsg` 逐字一致（设计文档 §8 共享知识）。
 */

import request, { ApiError } from '../../api/request'

export interface OAuthResult {
  ok: boolean
  id: number
  name: string
  message?: string
}

const MSG_TYPE = 'hk-netdisk-oauth'

/**
 * 发起 OAuth 授权并等待结果。
 *
 * 说明：后端回调消息里**没有**带 state，所以这里只认「授权窗口开着期间收到的
 * 第一条本类型消息」；若用户连开多个授权窗口，后到的结果会覆盖前一个 ——
 * 这是可接受的（同一时刻正常只有一个授权在进行）。
 */
export function openNetdiskOAuth(provider: string, name?: string): Promise<OAuthResult> {
  return new Promise<OAuthResult>((resolve, reject) => {
    let win: Window | null = null
    let settled = false

    const onMessage = (ev: MessageEvent) => {
      // 只信同源消息（后端回调页与本应用同源）
      if (ev.origin !== window.location.origin) return
      const d = ev.data as { type?: string; ok?: boolean; id?: number; name?: string; message?: string } | null
      if (!d || d.type !== MSG_TYPE) return
      cleanup()
      resolve({ ok: d.ok === true, id: Number(d.id || 0), name: d.name || '', message: d.message })
    }

    // window.close 没有事件，只能轮询
    const timer = window.setInterval(() => {
      if (win && win.closed) {
        cleanup()
        reject(new Error('授权窗口已关闭，未完成授权'))
      }
    }, 500)

    function cleanup() {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearInterval(timer)
      if (win && !win.closed) {
        try {
          win.close()
        } catch {
          /* 忽略 */
        }
      }
    }

    window.addEventListener('message', onMessage)
    // 两个泛型参数与 api/request.ts 的拦截器返回类型对齐（拦截器已剥掉 {code,message,data} 外壳）
    request
      .get<unknown, { authorize_url: string; state: string }>(`/netdisks/oauth/${provider}/authorize`, {
        params: name ? { name } : undefined,
      })
      .then((res: { authorize_url: string }) => {
        win = window.open(res.authorize_url, '_blank', 'width=860,height=640')
        if (!win) {
          cleanup()
          reject(new Error('浏览器拦截了授权窗口，请允许弹出窗口后重试'))
        }
      })
      .catch((e: unknown) => {
        cleanup()
        reject(e instanceof ApiError ? e : new Error('获取授权地址失败'))
      })
  })
}
