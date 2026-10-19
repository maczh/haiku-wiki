/**
 * 预览弹窗：文库可渲染类型（pdf/docx/xlsx/pptx/vsd/vsdx/drawio/md/html/txt）。
 *
 * 二进制走 `DocContent docType="file"` + FileAttachment JSON（FileView 自己 fetch URL）；
 * 文本型取回正文后交给 DocContent 对应渲染器。
 *
 * ⚠️ 本组件会被 `React.lazy` 包裹后才进弹窗，因此这里 import DocContent（连带
 * pdf.js / mammoth / FortuneSheet / pptx-preview）不会拖大入口 chunk。
 */

import { useEffect, useState } from 'react'
import { Alert, Spin } from 'antd'
import DocContent from '../reader/DocContent'
import { fetchNetdiskText, readerPreviewUrl } from '../../api/netdisk'
import { netdiskPreviewDocType } from '../../lib/netdisk/preview'
import type { NetdiskEntry } from '../../types'

interface Props {
  connId: number
  entry: NetdiskEntry
}

export default function NetdiskReaderView({ connId, entry }: Props) {
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const docType = netdiskPreviewDocType(entry.name)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    setContent('')
    ;(async () => {
      try {
        if (docType === 'file') {
          const ref = await readerPreviewUrl(connId, entry)
          if (alive) setContent(JSON.stringify(ref))
        } else if (docType) {
          const text = await fetchNetdiskText(connId, entry.path)
          if (alive) setContent(text)
        } else {
          setError('无法识别该文件的预览方式')
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '预览加载失败')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, entry.path])

  if (error) {
    return <Alert type="error" showIcon message={error} />
  }
  if (!docType) {
    return <Alert type="warning" showIcon message="该类型暂不支持预览" />
  }

  return (
    <Spin spinning={loading}>
      <div style={{ minHeight: 240 }}>
        {content ? (
          <DocContent docType={docType} content={content} widthEditable={false} />
        ) : (
          !loading && <Alert type="info" showIcon message="文件内容为空" />
        )}
      </div>
    </Spin>
  )
}
