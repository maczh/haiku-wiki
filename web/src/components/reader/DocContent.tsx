import { lazy } from 'react'
import LazyBoundary from '../common/LazyBoundary'
import { type DocType } from '../../types'

// 按文档类型按需加载渲染器：Vditor / simple-mind-map / x-data-spreadsheet / pdf.js / mermaid
// / draw.io / pptx-preview 都只在打开对应类型文档时才需要，静态 import 会把它们全部塞进首屏 chunk。
const MarkdownView = lazy(() => import('./MarkdownView'))
const SheetView = lazy(() => import('./SheetView'))
const MindmapView = lazy(() => import('./MindmapView'))
const FlowchartView = lazy(() => import('./FlowchartView'))
const FileView = lazy(() => import('./FileView'))
const DrawioView = lazy(() => import('./DrawioView'))
const TodoView = lazy(() => import('./TodoView'))
const CalendarView = lazy(() => import('./CalendarView'))

interface Props {
  docType: DocType
  content: string
  /** markdown 渲染完成回调（用于提取标题生成大纲；仅 markdown 类型触发） */
  onRendered?: (container: HTMLElement) => void
  /** 附件「另存为绘图文档」需要：所属知识库与新建后的跳转回调 */
  bookId?: number
  onDocCreated?: (docId: number) => void
}

/** 各类型的加载占位文案（按需加载时才可见） */
const TIP: Record<string, string> = {
  markdown: '正在加载 Markdown 渲染器…',
  sheet: '正在加载表格渲染器…',
  mindmap: '正在加载思维导图画布…',
  flowchart: '正在加载流程图渲染器…',
  drawing: '正在加载绘图组件…',
  todo: '正在加载待办清单…',
  calendar: '正在加载工作日历…',
  file: '正在加载附件预览器…',
}

/**
 * 阅读分发组件（I02）：doc_type → MarkdownView / SheetView / MindmapView / FlowchartView
 * / DrawioView（绘图）/ FileView（附件）。
 * XSS 边界：任何非 markdown 内容绝不进入 Vditor/MarkdownView 渲染管线；
 * 未知类型兜底按纯文本 <pre> 展示。
 */
export default function DocContent({ docType, content, onRendered, bookId, onDocCreated }: Props) {
  if (docType === 'markdown') {
    return (
      <LazyBoundary tip={TIP.markdown}>
        <MarkdownView content={content} onRendered={onRendered} />
      </LazyBoundary>
    )
  }
  if (docType === 'sheet') {
    return (
      <LazyBoundary tip={TIP.sheet}>
        <SheetView content={content} />
      </LazyBoundary>
    )
  }
  if (docType === 'mindmap') {
    return (
      <LazyBoundary tip={TIP.mindmap}>
        <MindmapView content={content} />
      </LazyBoundary>
    )
  }
  if (docType === 'flowchart') {
    return (
      <LazyBoundary tip={TIP.flowchart}>
        <FlowchartView content={content} />
      </LazyBoundary>
    )
  }
  if (docType === 'drawing') {
    return (
      <LazyBoundary tip={TIP.drawing}>
        <DrawioView content={content} />
      </LazyBoundary>
    )
  }
  if (docType === 'todo') {
    return (
      <LazyBoundary tip={TIP.todo}>
        <TodoView content={content} />
      </LazyBoundary>
    )
  }
  if (docType === 'calendar') {
    return (
      <LazyBoundary tip={TIP.calendar}>
        <CalendarView content={content} />
      </LazyBoundary>
    )
  }
  if (docType === 'file') {
    return (
      <LazyBoundary tip={TIP.file}>
        <FileView content={content} bookId={bookId} onDocCreated={onDocCreated} />
      </LazyBoundary>
    )
  }
  // 未知类型兜底：纯文本，不进任何渲染管线
  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px 40px' }}>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.8 }}>{content}</pre>
    </div>
  )
}
