import type { ComponentType } from 'react'
import type { DocType } from '../types'
import MarkdownView from '../components/reader/MarkdownView'
import MdBodyWidth from '../components/reader/MdBodyWidth'
import DocxOfficeEditor from '../components/office/DocxEditor'
import LuckySheetEditor from '../components/office/LuckySheetEditor'
import PptistEditor from '../components/office/PptistEditor'
import MindmapView from '../components/reader/MindmapView'
import FlowchartView from '../components/reader/FlowchartView'
import DrawioView from '../components/reader/DrawioView'
import WhiteboardView from '../components/reader/WhiteboardView'
import TodoView from '../components/reader/TodoView'
import CalendarView from '../components/reader/CalendarView'
import GanttView from '../components/reader/GanttView'
import ApiView from '../components/reader/ApiView'
import FileView from '../components/reader/FileView'
import WebView from '../components/reader/WebView'
import GalleryView from '../components/gallery/GalleryView'
import PrototypeView from '../components/prototype/PrototypeView'

/**
 * H5 阅读态统一接收的 props（各 reader 组件 props 的超集，
 * 因此可安全以 `ComponentType<H5ReaderProps>` 收敛到同一张映射表）。
 */
export interface H5ReaderProps {
  /** 文档正文（各 reader 必填） */
  content: string
  /** 文档 id（甘特图回写进度 / 图片库重生成等需要） */
  docId?: number
  /** 所属知识库 id（附件型「另存为绘图」需要） */
  bookId?: number
  /** 当前用户是否有写权限 */
  canWrite?: boolean
}

/**
 * 只读类型 → 阅读组件 映射（14 种非 folder 类型）。
 *
 * 完全复用桌面版 web/src/components/reader/* 与 gallery/prototype 的阅读组件，
 * 不重写任何渲染逻辑；folder 不在此表（它是容器，由 MDoc 单独渲染子文档列表）。
 */
// markdown 在 H5 阅读态同样走百分比宽度模型（默认窗体 80%、可拖拽右缘调整），
// 由 MdBodyWidth 统一施加；其余类型沿用各自渲染组件。
const MarkdownReader = (props: H5ReaderProps) => (
  <MdBodyWidth>
    <MarkdownView content={props.content} docId={props.docId} />
  </MdBodyWidth>
)

export const READER_MAP: Partial<Record<DocType, ComponentType<H5ReaderProps>>> = {
  markdown: MarkdownReader,
  sheet: (props) => <LuckySheetEditor content={props.content} readOnly />,
  excel: (props) => <LuckySheetEditor content={props.content} readOnly />,
  word: (props) => <DocxOfficeEditor content={props.content} readOnly />,
  powerpoint: (props) => <PptistEditor content={props.content} readOnly />,
  mindmap: MindmapView,
  flowchart: FlowchartView,
  drawing: DrawioView,
  whiteboard: WhiteboardView,
  todo: TodoView,
  calendar: CalendarView,
  gantt: GanttView,
  api: ApiView,
  file: FileView,
  web: WebView,
  gallery: GalleryView,
  prototype: PrototypeView,
}
