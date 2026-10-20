import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { toHtml } from '../../vendor/typo-md-editor/typo-md-editor.js'
import '../reader/markdown-body.css'

interface Props { content: string }

/** 网盘专用 Markdown 阅读器：只做一次轻量转换，不加载文库编辑器和增强插件。 */
export default function NetdiskMarkdownView({ content }: Props) {
  const [html, setHtml] = useState('')
  useEffect(() => {
    let alive = true
    void toHtml(content || '', 'Document').then((full) => {
      if (!alive) return
      const body = new DOMParser().parseFromString(full, 'text/html').body.innerHTML
      setHtml(DOMPurify.sanitize(body))
    }).catch(() => {
      if (alive) setHtml(`<pre>${(content || '').replace(/</g, '&lt;')}</pre>`)
    })
    return () => { alive = false }
  }, [content])
  return <div className="vditor-reset hk-md-body" dangerouslySetInnerHTML={{ __html: html }} />
}
