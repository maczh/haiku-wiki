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
    return () => {
      alive = false
    }
  }, [connId, entry.path])

  if (error) return <Alert type="error" showIcon message={error} />

  return (
    <Spin spinning={loading}>
      {mode === 'video' ? (
        <video className="hk-nd-preview-video" controls src={src} preload="metadata">
          当前浏览器不支持视频播放
        </video>
      ) : (
        <audio controls src={src} preload="metadata" style={{ width: '100%' }}>
          当前浏览器不支持音频播放
        </audio>
      )}
    </Spin>
  )
}
