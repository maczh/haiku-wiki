import type { ComponentType } from 'react'
import type { DocType } from '../types'
import MarkdownView from '../components/reader/MarkdownView'
import SheetView from '../components/reader/SheetView'
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
import { isOfficeContent } from '../lib/officeDoc'

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
export const READER_MAP: Partial<Record<DocType, ComponentType<H5ReaderProps>>> = {
  markdown: MarkdownView,
  sheet: SheetView,
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
  // OnlyOffice Web Comp 生成的 Word/PPT 文档复用既有附件阅读组件（mammoth/pptx-preview）
  word: FileView,
  ppt: FileView,
  gallery: GalleryView,
  prototype: PrototypeView,
}

/**
 * 按「类型 + 正文内容」挑选 H5 阅读组件。
 *
 * 表格类型现在承载两种正文：旧版 luckysheet JSON（SheetView）与 OnlyOffice 办公文件
 * 引用 {url,filename,ext}（导入的 xlsx / 新建 Excel 文件保存后的产物）。后者若交给
 * SheetView 会被误判为「内容格式异常」**重置为空表格**（实测 bug），H5 又不接
 * OnlyOffice（移动端首屏成本高），因此 office 引用一律降级为 FileView 附件卡
 * （展示文件名/大小 + 原文件下载，docx/pptx 仍能直接预览内容）。
 */
export function pickReader(docType: DocType, content: string): ComponentType<H5ReaderProps> | undefined {
  if ((docType === 'sheet' || docType === 'word' || docType === 'ppt') && isOfficeContent(content)) {
    return FileView
  }
  return READER_MAP[docType]
}
