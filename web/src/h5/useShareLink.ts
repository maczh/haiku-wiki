import { useCallback, useState } from 'react'
import { getDocShare, updateDocShare } from '../api/docs'
import type { DocShareView } from '../types'
import { docShareUrl } from '../lib/share'

/**
 * H5 分享目标。
 *   · `doc`：站内文档，需要先向后端取（或首次创建）分享 slug，再拼 `/doc-share/:slug`；
 *   · `url`：已有现成链接（公开分享页直接分享当前地址即可，无需再请求后端）。
 */
export type ShareTarget = { kind: 'doc'; docId: number } | { kind: 'url'; url: string }

/**
 * H5 分享面板的驱动逻辑：懒生成链接 + 面板开关。
 *
 * ⚠️ 只在用户点「分享」时才去请求后端（懒加载），避免每打开一篇文档就多两次接口调用；
 * 且**先 GET 复用已有 slug**，只有「从未创建过 / 被停用」时才 PUT —— 因为后端的
 * `PUT /docs/:id/share` 语义是 upsert 且**每次都会刷新 slug**，重复 PUT 会让用户
 * 之前发出去的旧链接悄悄失效。
 */
export function useShareLink() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const openShare = useCallback(async (t: string, target: ShareTarget) => {
    setTitle(t)
    setOpen(true)
    setUrl('')
    setError('')

    if (target.kind === 'url') {
      setUrl(target.url)
      return
    }

    setLoading(true)
    try {
      let view: DocShareView | null = null
      // 未创建过时后端返回 null（也有实现抛 40401），两种都按「没有」处理
      try {
        view = await getDocShare(target.docId)
      } catch {
        view = null
      }
      if (!view || !view.enabled || !view.slug) {
        view = await updateDocShare(target.docId, { enabled: true })
      }
      if (!view?.slug) throw new Error('empty slug')
      setUrl(docShareUrl(view.slug))
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(msg || '生成分享链接失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  const closeShare = useCallback(() => setOpen(false), [])

  return { open, title, url, loading, error, openShare, closeShare }
}
