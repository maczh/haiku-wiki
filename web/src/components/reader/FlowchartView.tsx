import { useEffect, useState } from 'react'
import { Alert, Spin } from 'antd'
import { validateFlowchart } from '../../lib/flowchart'
import MarkdownView from './MarkdownView'

interface Props {
  /** mermaid 源码字符串（docs.content 原文，非 JSON） */
  content: string
}

/**
 * 流程图预览（阅读页 / 编辑器右侧实时预览共用）。
 *
 * 早期实现自己用 mermaid.render 生成 SVG，再套一层 transform 缩放工具条：
 * 默认「适应宽度」会把大图压得很小，且缩放工具条的 scale 变换对矢量图无实际放大效果
 * （图形始终被容器宽度限制）。现改为委托 Markdown 阅读组件（Vditor preview）渲染：
 *   - 复用全站统一的 mermaid 渲染管线（XSS 边界、标题折叠等能力一并获得）；
 *   - 图形按容器实际宽度自然铺开，不再被人为缩小 —— 修复「图形太小」；
 *   - 不再需要自研缩放工具条（旧工具条无实际放大效果，见上）。
 * 语法错误时给出行内 Alert，不崩溃；内容为空给占位提示。
 */
export default function FlowchartView({ content }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    validateFlowchart(content || '')
      .then((msg) => {
        if (!cancelled) setError(msg)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [content])

  if (loading) {
    return <Spin style={{ display: 'block', margin: '40px auto' }} />
  }
  if (error) {
    return (
      <div style={{ padding: 12 }}>
        <Alert
          type="warning"
          showIcon
          message="流程图语法有误"
          description={<pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{error}</pre>}
        />
      </div>
    )
  }

  // 把 mermaid 源码包进围栏代码块，交给 Markdown 阅读组件渲染（全站统一管线）。
  const md = '```mermaid\n' + (content || '') + '\n```'
  return (
    <div style={{ padding: 16 }}>
      <MarkdownView content={md} />
    </div>
  )
}
