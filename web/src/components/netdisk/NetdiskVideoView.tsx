/**
 * 预览弹窗：视频 / 音频。
 *
 * `<video>` / `<audio>` 的 src 发不出 Authorization 头，所以必须先换一个
 * 短期 token（HMAC 绑定 uid + connID + path，2 小时）拼进 URL。
 */

import { useEffect, useState } from 'react'
import { Alert, Spin } from 'antd'
import { makePreviewToken, previewUrl } from '../../api/netdisk'
import type { NetdiskEntry } from '../../types'

interface Props {
  connId: number
  entry: NetdiskEntry
  mode: 'video' | 'audio'
}

export default function NetdiskVideoView({ connId, entry, mode }: Props) {
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)

  function handleMediaError() {
    setLoading(false)
    setError('视频无法播放：文件编码或网盘响应格式可能不受浏览器支持，请下载原文件播放')
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const { token } = await makePreviewToken(connId, entry.path)
        if (alive) setSrc(previewUrl(connId, entry.path, token))
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    const timeout = window.setTimeout(() => {
      if (alive && !src) {
        setLoading(false)
        setError('视频地址获取超时，请重试或下载原文件播放')
      }
    }, 60000)
    return () => {
      alive = false
      window.clearTimeout(timeout)
    }
  }, [connId, entry.path, retry])

  if (error) return <Alert type="error" showIcon message={error} action={<button type="button" onClick={() => { setError(''); setLoading(true); setSrc(''); setRetry((value) => value + 1) }}>重试</button>} />

  return (
    <Spin spinning={loading}>
      {mode === 'video' && src ? (
        <video
          key={src}
          className="hk-nd-preview-video"
          controls
          playsInline
          src={src}
          // 交给浏览器按 Range 分段预取，避免等完整视频下载后才开始播放。
          preload="auto"
          onLoadedMetadata={() => setLoading(false)}
          onCanPlay={() => setLoading(false)}
          onError={handleMediaError}
        >
          当前浏览器不支持视频播放
        </video>
      ) : mode === 'audio' && src ? (
        <audio controls src={src} preload="metadata" style={{ width: '100%' }}>
          当前浏览器不支持音频播放
        </audio>
      ) : <div style={{ minHeight: 360 }} />}
    </Spin>
  )
}
