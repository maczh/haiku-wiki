import { useEffect, useState } from 'react'
import { Alert, Button, Spin } from 'antd'
import OpenFileReader from '../reader/OpenFileReader'
import { readerPreviewUrl } from '../../api/netdisk'
import type { NetdiskEntry } from '../../types'

interface Props { connId: number; entry: NetdiskEntry }

/** Netdisk uses the same viewer as the knowledge-base reader. */
export default function NetdiskReaderView({ connId, entry }: Props) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    void readerPreviewUrl(connId, entry).then((ref) => {
      if (alive) setUrl(ref.url)
    }).catch((err: unknown) => {
      if (alive) setError(err instanceof Error ? err.message : '预览加载失败')
    }).finally(() => {
      if (alive) setLoading(false)
    })
    return () => { alive = false }
  }, [connId, entry, nonce])

  if (error) return <Alert type="error" showIcon message="预览加载失败" description={error} action={<Button size="small" onClick={() => setNonce((n) => n + 1)}>重试</Button>} />
  return <Spin spinning={loading}><OpenFileReader url={url} filename={entry.name} mode="preview" /></Spin>
}
