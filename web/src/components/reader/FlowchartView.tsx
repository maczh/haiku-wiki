import { useEffect, useState } from 'react'
import { Alert, Spin } from 'antd'
import { renderFlowchart } from '../../lib/flowchart'

interface Props {
  /** mermaid 源码字符串（docs.content 原文，非 JSON） */
  content: string
}

/** mermaid 只读渲染；parse/渲染失败显示行内 Alert，不崩溃 */
export default function FlowchartView({ content }: Props) {
  const [loading, setLoading] = useState(false)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    renderFlowchart(content || '')
      .then((res) => {
        if (cancelled) return
        if (res.svg) {
          setSvg(res.svg)
          setError('')
        } else {
          setError(res.error || '流程图语法有误')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [content])

  return (
    <div style={{ padding: 12 }}>
      {loading && <Spin style={{ display: 'block', margin: '40px auto' }} />}
      {!loading && error && (
        <Alert
          type="warning"
          showIcon
          message="流程图语法有误"
          description={<pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{error}</pre>}
        />
      )}
      {!loading && !error && svg && (
        <div style={{ display: 'flex', justifyContent: 'center', overflow: 'auto' }}>
          {/* mermaid securityLevel=strict 输出已 sanitize */}
          <div style={{ maxWidth: '100%' }} dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      )}
    </div>
  )
}
