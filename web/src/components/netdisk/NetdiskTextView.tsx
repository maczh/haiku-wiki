/**
 * 预览弹窗：纯文本 / 代码（json/xml/yaml/log/sql/go/ts…）。
 * 只做只读展示，不引入任何语法高亮依赖。
 */

import { useEffect, useState } from 'react'
import { Alert, Button, Spin } from 'antd'
import { fetchNetdiskText } from '../../api/netdisk'
import type { NetdiskEntry } from '../../types'

interface Props {
  connId: number
  entry: NetdiskEntry
}

export default function NetdiskTextView({ connId, entry }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const t = await fetchNetdiskText(connId, entry.path)
        if (alive) setText(t)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '读取失败')
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
      <div style={{ position: 'relative' }}>
        <Button
          size="small"
          style={{ position: 'absolute', top: 6, right: 8, zIndex: 1 }}
          onClick={() => void navigator.clipboard?.writeText(text)}
        >
          复制
        </Button>
        <pre className="hk-nd-preview-text">{text}</pre>
      </div>
    </Spin>
  )
}
