import { useEffect, useState } from 'react'
import { Alert, Button, Spin } from 'antd'
import { fetchNetdiskBlob } from '../../api/netdisk'
import DocxOfficeEditor from '../office/DocxEditor'
import type { NetdiskEntry } from '../../types'

interface Props {
  connId: number
  entry: NetdiskEntry
}

/** 网盘 DOCX 的独立预览链路：下载二进制 → 临时 blob URL → 编辑器。
 *  不复用文库编辑器的 content 状态，卸载时主动释放 URL，避免旧浮层/旧文档残留。
 */
export default function NetdiskDocxView({ connId, entry }: Props) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    let objectUrl = ''
    setUrl('')
    setError('')
    void fetchNetdiskBlob(connId, entry.path)
      .then((blob) => {
        objectUrl = URL.createObjectURL(new Blob([blob], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }))
        if (alive) setUrl(objectUrl)
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : 'DOCX 文件读取失败')
      })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [connId, entry.path, retry])

  if (error) return <Alert type="error" showIcon message="无法打开 Word 文档" description={error} action={<Button size="small" onClick={() => setRetry((value) => value + 1)}>重试</Button>} />
  if (!url) return <Spin tip="正在读取 DOCX…"><div style={{ height: 420 }} /></Spin>

  return (
    <div className="hk-netdisk-docx-preview" style={{ minHeight: 520, height: '100%' }}>
      <DocxOfficeEditor
        key={url}
        readOnly
        title={entry.name}
        content={JSON.stringify({ url, filename: entry.name, size: entry.size ?? 0, ext: 'docx' })}
      />
    </div>
  )
}
