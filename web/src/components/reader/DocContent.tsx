import { lazy } from 'react'
import { FolderOutlined } from '@ant-design/icons'
import LazyBoundary from '../common/LazyBoundary'
import WidthControl from './WidthControl'
import { useReaderWidth } from '../../lib/readerWidth'
import { type DocType } from '../../types'

// 按文档类型按需加载渲染器：Vditor / simple-mind-map / Luckysheet / pdf.js / mermaid
// / draw.io / pptx-preview 都只在打开对应类型文档时才需要，静态 import 会把它们全部塞进首屏 chunk。
const MarkdownView = lazy(() => import('./MarkdownView'))
const MindmapView = lazy(() => import('./MindmapView'))
const FlowchartView = lazy(() => import('./FlowchartView'))
const FileView = lazy(() => import('./FileView'))
const DrawioView = lazy(() => import('./DrawioView'))
const WhiteboardView = lazy(() => import('./WhiteboardView'))
const TodoView = lazy(() => import('./TodoView'))
const CalendarView = lazy(() => import('./CalendarView'))
const GanttView = lazy(() => import('./GanttView'))
const ApiView = lazy(() => import('./ApiView'))
const WebView = lazy(() => import('./WebView'))
const GalleryView = lazy(() => import('../gallery/GalleryView'))
const PrototypeView = lazy(() => import('../prototype/PrototypeView'))
// OnlyOffice Web Comp 编辑/预览（Excel/Word/PPT）：阅读态也可编辑（有权限时），
// 旧 luckysheet 正文会在 OnlyOfficeEditor 内转换为 xlsx 再载入。
const OnlyOfficeEditor = lazy(() => import('../editor/OnlyOfficeEditor'))

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
  whiteboard: '正在加载白板…',
  todo: '正在加载待办清单…',
  calendar: '正在加载工作日历…',
  gantt: '正在加载甘特图…',
  api: '正在加载接口文档…',
  file: '正在加载附件预览器…',
  web: '正在加载网页…',
  gallery: '正在加载图片库…',
  prototype: '正在加载需求原型…',
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
        <MarkdownView content={content} docId={docId} onRendered={onRendered} />
      </LazyBoundary>
    )
  } else if (docType === 'sheet') {
    // 表格（含旧 luckysheet 数据 / 导入的 xlsx）统一用 OnlyOffice Web Comp 编辑或预览：
    // 旧 luckysheet 正文会在 OnlyOfficeEditor 内转换为 xlsx 再载入，避免数据丢失。
    body = (
      <LazyBoundary tip="正在加载表格编辑器…">
        <OnlyOfficeEditor docId={docId ?? 0} docType="sheet" initialContent={content} title="" canWrite={canWrite === true} />
      </LazyBoundary>
    )
  } else if (docType === 'word') {
    // Word 文档由 OnlyOffice Web Comp 加载编辑（有权限即可编辑，不再仅是阅读）
    body = (
      <LazyBoundary tip="正在加载 Word 编辑器…">
        <OnlyOfficeEditor docId={docId ?? 0} docType="word" initialContent={content} title="" canWrite={canWrite === true} />
      </LazyBoundary>
    )
  } else if (docType === 'ppt') {
    // PPT 文档由 OnlyOffice Web Comp 加载编辑（有权限即可编辑，不再仅是阅读）
    body = (
      <LazyBoundary tip="正在加载 PPT 编辑器…">
        <OnlyOfficeEditor docId={docId ?? 0} docType="ppt" initialContent={content} title="" canWrite={canWrite === true} />
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
  } else if (docType === 'whiteboard') {
    // 白板：阅读页只渲染保存时生成的 SVG 预览，不加载 Excalidraw 编辑组件
    body = (
      <LazyBoundary tip={TIP.whiteboard}>
        <WhiteboardView content={content} />
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
  } else if (docType === 'gallery') {
    // 图片库：相册网格用缩略图，点开看预览图，下载给原件
    body = (
      <LazyBoundary tip={TIP.gallery}>
        <GalleryView content={content} docId={docId} />
      </LazyBoundary>
    )
  } else if (docType === 'prototype') {
    // 需求原型：卡片 = 一个原型（一份需求说明 + 它的载体），见 PrototypeView
    body = (
      <LazyBoundary tip={TIP.prototype}>
        <PrototypeView content={content} docId={docId} />
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

  // 甘特图要横向铺满；网页 iframe 同样需要整幅宽度（原型页常按固定画布宽度设计）；
  // 图片库/需求原型的网格在窄栏下也会被压得没法看；接口文档是「左侧接口树 + 右侧调试」双面板布局，
  // 需要占满整幅宽度、且不受阅读宽度调节器约束（见 ApiEditor 自身拖拽调宽）；
  // 流程图（mermaid）借用 Markdown 阅读组件渲染，大图（时序/甘特/长流程）在窄阅读栏里会被压得过小，
  // 同样通栏铺满，图形按容器实际宽度自然铺开（不再套阅读宽度调节器）。
  const fullWidth = docType === 'gantt' || docType === 'web' || docType === 'gallery' || docType === 'prototype' || docType === 'api' || docType === 'flowchart'
  // 目录没有正文，宽度调节器无意义；接口文档双面板也不适用单栏阅读宽度
  const showWidthControl = widthEditable && !fullWidth && docType !== 'folder'
  // 需要占满视口剩余高度的类型：
  //   · api —— 阅读模式「左接口树 + 右调试」双面板各自独立滚动；
  //   · sheet / word / ppt —— OnlyOffice 编辑器必须拿到确定高度，否则 iframe 塌成一个
  //     固定值（实测恒为 minHeight 兜底的 556px），不随浏览器窗口伸缩（实测 bug）。
  //     上游（BookPage 阅读分支 / DocSharePage）负责提供 height:100% 的父容器。
  const fillHeight = docType === 'api' || docType === 'sheet' || docType === 'word' || docType === 'ppt'
  return (
    <div
      style={{
        maxWidth: fullWidth ? undefined : (maxWidth ?? undefined),
        margin: '0 auto',
        width: '100%',
        ...(fillHeight ? { height: '100%', display: 'flex', flexDirection: 'column' } : null),
      }}
    >
      {showWidthControl && <WidthControl compact />}
      <div style={fillHeight ? { flex: 1, minHeight: 0 } : undefined}>{body}</div>
    </div>
  )
}
