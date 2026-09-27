import type { ComponentType } from 'react'
import type { DocType } from '../types'
import MarkdownView from '../components/reader/MarkdownView'
import SheetTableView from '../components/reader/SheetTableView'
import SheetOfficeView from '../components/reader/SheetOfficeView'
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
import { isOfficeContent, parseOfficeRef } from '../lib/officeDoc'

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
  // H5 阅读/分享态的**内联 SheetJSON** 用轻量级纯表格组件（原生 <table>，无 luckysheet 内核）；
  // 桌面端编辑/阅读仍走 SheetView。导入的 xlsx（office 引用）由 pickReader 分流到
  // SheetOfficeView（luckysheet 只读），其余 office 引用降级 FileView。
  sheet: SheetTableView,
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

/** 可用 SheetJS 解析的电子表格扩展名（SheetOfficeView 走 luckysheet 只读渲染） */
const SPREADSHEET_OFFICE_EXTS = new Set(['xlsx', 'xls', 'xlsm', 'xltx', 'csv', 'ods'])

/**
 * 按「类型 + 正文内容」挑选 H5 阅读组件。
 *
 * 表格类型现在承载两种正文：
 *   1. 内联 SheetJSON（旧版 luckysheet 数据 / 新建表格）→ READER_MAP 的 sheet（轻量 SheetTableView）；
 *   2. OnlyOffice 办公文件引用 {url,filename,ext}（导入的 xlsx / 新建 Excel 文件保存后的产物）。
 * 第 2 类不能直接喂给 SheetTableView（它只吃 SheetJSON，会判定为空表），H5 也不接 OnlyOffice
 * （移动端首屏成本高）。因此：**电子表格类引用（xlsx/xls/csv…）改用 SheetOfficeView** ——
 * 拉取源文件经 SheetJS 转成 SheetJSON 后由 luckysheet 只读查看；其余 office 引用
 * （docx/pptx 等，或不便解析的 .et）仍降级为 FileView 附件卡（展示文件名/大小 + 原文件下载）。
 */
export function pickReader(docType: DocType, content: string): ComponentType<H5ReaderProps> | undefined {
  if (docType === 'sheet' && isOfficeContent(content)) {
    const ref = parseOfficeRef(content)
    if (ref && SPREADSHEET_OFFICE_EXTS.has(ref.ext)) return SheetOfficeView
  }
  if ((docType === 'sheet' || docType === 'word' || docType === 'ppt') && isOfficeContent(content)) {
    return FileView
  }
  return READER_MAP[docType]
}
