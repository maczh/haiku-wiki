import MarkdownView from './MarkdownView'
import SheetView from './SheetView'
import MindmapView from './MindmapView'
import FlowchartView from './FlowchartView'
import { type DocType } from '../../types'

interface Props {
  docType: DocType
  content: string
  /** markdown 渲染完成回调（用于提取标题生成大纲；仅 markdown 类型触发） */
  onRendered?: (container: HTMLElement) => void
}

/**
 * 阅读分发组件（I02）：doc_type → MarkdownView / SheetView / MindmapView / FlowchartView。
 * XSS 边界：任何非 markdown 内容绝不进入 Vditor/MarkdownView 渲染管线；
 * 未知类型兜底按纯文本 <pre> 展示。
 */
export default function DocContent({ docType, content, onRendered }: Props) {
  if (docType === 'markdown') {
    return <MarkdownView content={content} onRendered={onRendered} />
  }
  if (docType === 'sheet') {
    return <SheetView content={content} />
  }
  if (docType === 'mindmap') {
    return <MindmapView content={content} />
  }
  if (docType === 'flowchart') {
    return <FlowchartView content={content} />
  }
  // 未知类型兜底：纯文本，不进任何渲染管线
  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px 40px' }}>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.8 }}>{content}</pre>
    </div>
  )
}
