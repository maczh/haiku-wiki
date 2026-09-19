import { lazy } from 'react'
import { FolderOutlined } from '@ant-design/icons'
import LazyBoundary from '../common/LazyBoundary'
import WidthControl from './WidthControl'
import { useReaderWidth } from '../../lib/readerWidth'
import { type DocType } from '../../types'

// 按文档类型按需加载渲染器：Vditor / simple-mind-map / Luckysheet / pdf.js / mermaid
// / draw.io / pptx-preview 都只在打开对应类型文档时才需要，静态 import 会把它们全部塞进首屏 chunk。
const MarkdownView = lazy(() => import('./MarkdownView'))
const SheetView = lazy(() => import('./SheetView'))
const MindmapView = lazy(() => import('./MindmapView'))
const FlowchartView = lazy(() => import('./FlowchartView'))
const FileView = lazy(() => import('./FileView'))
const DrawioView = lazy(() => import('./DrawioView'))
const TodoView = lazy(() => import('./TodoView'))
const CalendarView = lazy(() => import('./CalendarView'))
const GanttView = lazy(() => import('./GanttView'))
const ApiView = lazy(() => import('./ApiView'))
const WebView = lazy(() => import('./WebView'))

interface Props {
  docType: DocType
  content: string
  /** markdown 渲染完成回调（用于提取标题生成大纲；仅 markdown 类型触发） */
  onRendered?: (container: HTMLElement) => void
  /** 附件「另存为绘图文档」需要：所属知识库与新建后的跳转回调 */
  bookId?: number
  onDocCreated?: (docId: number) => void
  /** 文档 id：甘特图在阅读态改进度时要回写正文 */
  docId?: number
  /** 当前用户对文档是否有写权限：甘特图据此在阅读态开放「仅改进度」 */
  canWrite?: boolean
  /** 是否显示正文宽度调节器（阅读页/分享页默认显示；弹窗内嵌预览可关掉） */
  widthEditable?: boolean
}

/** 各类型的加载占位文案（按需加载时才可见） */
const TIP: Record<string, string> = {
  markdown: '正在加载 Markdown 渲染器…',
  sheet: '正在加载表格渲染器…',
  mindmap: '正在加载思维导图画布…',
  flowchart: '正在加载流程图渲染器…',
  drawing: '正在加载绘图…',
  todo: '正在加载待办清单…',
  calendar: '正在加载工作日历…',
  gantt: '正在加载甘特图…',
  api: '正在加载接口文档…',
  file: '正在加载附件预览器…',
  web: '正在加载网页…',
}

/**
 * 阅读分发组件（I02）：doc_type → MarkdownView / SheetView / MindmapView / FlowchartView
 * / DrawioView（绘图）/ FileView（附件）。
 * XSS 边界：任何非 markdown 内容绝不进入 Vditor/MarkdownView 渲染管线；
 * 未知类型兜底按纯文本 <pre> 展示。
 */
export default function DocContent({
  docType,
  content,
  onRendered,
  bookId,
  onDocCreated,
  docId,
  canWrite,
  widthEditable = true,
}: Props) {
  // 正文宽度（标准/宽屏/全宽 + 拖动条），偏好存 localStorage，阅读页与分享页共用
  const { maxWidth } = useReaderWidth()

  /** 按 doc_type 分发的渲染体（宽度控制在最外层统一施加） */
  let body: JSX.Element
  if (docType === 'markdown') {
    body = (
      <LazyBoundary tip={TIP.markdown}>
        <MarkdownView content={content} onRendered={onRendered} />
      </LazyBoundary>
    )
  } else if (docType === 'sheet') {
    body = (
      <LazyBoundary tip={TIP.sheet}>
        <SheetView content={content} />
      </LazyBoundary>
    )
  } else if (docType === 'mindmap') {
    body = (
      <LazyBoundary tip={TIP.mindmap}>
        <MindmapView content={content} />
      </LazyBoundary>
    )
  } else if (docType === 'flowchart') {
    body = (
      <LazyBoundary tip={TIP.flowchart}>
        <FlowchartView content={content} />
      </LazyBoundary>
    )
  } else if (docType === 'drawing') {
    body = (
      <LazyBoundary tip={TIP.drawing}>
        <DrawioView content={content} />
      </LazyBoundary>
    )
  } else if (docType === 'todo') {
    body = (
      <LazyBoundary tip={TIP.todo}>
        <TodoView content={content} />
      </LazyBoundary>
    )
  } else if (docType === 'calendar') {
    body = (
      <LazyBoundary tip={TIP.calendar}>
        <CalendarView content={content} />
      </LazyBoundary>
    )
  } else if (docType === 'gantt') {
    // 甘特图：横向时间轴需要整幅宽度，不套阅读宽度，也不显示宽度调节器
    body = (
      <LazyBoundary tip={TIP.gantt}>
        <GanttView content={content} docId={docId} progressEditable={canWrite === true} />
      </LazyBoundary>
    )
  } else if (docType === 'file') {
    body = (
      <LazyBoundary tip={TIP.file}>
        <FileView content={content} bookId={bookId} onDocCreated={onDocCreated} />
      </LazyBoundary>
    )
  } else if (docType === 'api') {
    body = (
      <LazyBoundary tip={TIP.api}>
        <ApiView content={content} />
      </LazyBoundary>
    )
  } else if (docType === 'web') {
    body = (
      <LazyBoundary tip={TIP.web}>
        <WebView content={content} />
      </LazyBoundary>
    )
  } else if (docType === 'folder') {
    // 目录（doc_type=folder）：不承载正文，占位提示如何在其下继续建内容。
    // 这里刻意不懒加载任何渲染器 —— 目录没有正文，加载 Vditor/Luckysheet 是纯浪费。
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '96px 24px', textAlign: 'center' }}>
        <FolderOutlined style={{ fontSize: 56, color: '#faad14' }} />
        <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2329' }}>这是一个目录</div>
        <div style={{ fontSize: 13, lineHeight: 1.9, color: '#8a919f', maxWidth: 460 }}>
          目录本身不存放正文，只用来给文档分组分层。
          <br />
          在左侧目录树中右键本目录，即可新建子文档或子目录；也可以把已有文档移动进来。
        </div>
      </div>
    )
  } else {
    // 未知类型兜底：纯文本，不进任何渲染管线
    body = (
      <div style={{ padding: '0 24px 40px' }}>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.8 }}>{content}</pre>
      </div>
    )
  }

  // 甘特图要横向铺满（时间轴在窄栏下没法看），其余类型沿用阅读宽度偏好
  // 甘特图要横向铺满；网页 iframe 同样需要整幅宽度（原型页常按固定画布宽度设计）
  const fullWidth = docType === 'gantt' || docType === 'web'
  // 目录没有正文，宽度调节器无意义
  const showWidthControl = widthEditable && !fullWidth && docType !== 'folder'
  return (
    <div style={{ maxWidth: fullWidth ? undefined : (maxWidth ?? undefined), margin: '0 auto', width: '100%' }}>
      {showWidthControl && <WidthControl compact />}
      {body}
    </div>
  )
}
