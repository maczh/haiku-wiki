// 左栏文档/附件图标映射（按文件类型区分）。
//
// 之所以独立成文件：目录树、导入结果、阅读页信息条都要按「类型」取图标，
// 各写一份必然漂移（同一个 .xlsx 在树里是绿色表格、在阅读页变成灰色文本的
// 事已经发生过一次）。这里集中维护 ext → 图标/配色的单一映射，
// 未知扩展名统一回退到附件图标。

import {
  ApartmentOutlined,
  ApiOutlined,
  AudioOutlined,
  BorderOuterOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  DeploymentUnitOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileUnknownOutlined,
  FileWordOutlined,
  FileZipOutlined,
  FolderOutlined,
  NodeIndexOutlined,
  PaperClipOutlined,
  PartitionOutlined,
  TableOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import type { DocType } from '../types'

/** 图标 + 配色（配色沿用语雀风格低饱和色系） */
export interface IconSpec {
  icon: React.ReactNode
  color: string
}

/** 取扩展名（小写，不含点；无扩展名返回空串） */
export function extOfFileName(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/**
 * 扩展名 → 图标。
 * 分组顺序即优先级：先精确命中，再按常见大类回退。
 */
const EXT_ICONS: Record<string, IconSpec> = {
  // 文档
  pdf: { icon: <FilePdfOutlined />, color: '#f5222d' },
  doc: { icon: <FileWordOutlined />, color: '#2f54eb' },
  docx: { icon: <FileWordOutlined />, color: '#2f54eb' },
  wps: { icon: <FileWordOutlined />, color: '#2f54eb' },
  rtf: { icon: <FileWordOutlined />, color: '#1677ff' },
  odt: { icon: <FileWordOutlined />, color: '#1677ff' },
  txt: { icon: <FileTextOutlined />, color: '#8a919f' },
  md: { icon: <FileTextOutlined />, color: '#8a919f' },
  markdown: { icon: <FileTextOutlined />, color: '#8a919f' },
  // 表格
  xls: { icon: <FileExcelOutlined />, color: '#13c2c2' },
  xlsx: { icon: <FileExcelOutlined />, color: '#13c2c2' },
  et: { icon: <FileExcelOutlined />, color: '#13c2c2' },
  csv: { icon: <FileExcelOutlined />, color: '#52c41a' },
  ods: { icon: <FileExcelOutlined />, color: '#13c2c2' },
  // 演示
  ppt: { icon: <FilePptOutlined />, color: '#fa8c16' },
  pptx: { icon: <FilePptOutlined />, color: '#fa8c16' },
  dps: { icon: <FilePptOutlined />, color: '#fa8c16' },
  odp: { icon: <FilePptOutlined />, color: '#fa8c16' },
  // 压缩包
  zip: { icon: <FileZipOutlined />, color: '#faad14' },
  rar: { icon: <FileZipOutlined />, color: '#faad14' },
  '7z': { icon: <FileZipOutlined />, color: '#faad14' },
  tar: { icon: <FileZipOutlined />, color: '#faad14' },
  gz: { icon: <FileZipOutlined />, color: '#faad14' },
  // 图片
  png: { icon: <FileImageOutlined />, color: '#722ed1' },
  jpg: { icon: <FileImageOutlined />, color: '#722ed1' },
  jpeg: { icon: <FileImageOutlined />, color: '#722ed1' },
  gif: { icon: <FileImageOutlined />, color: '#722ed1' },
  bmp: { icon: <FileImageOutlined />, color: '#722ed1' },
  webp: { icon: <FileImageOutlined />, color: '#722ed1' },
  svg: { icon: <FileImageOutlined />, color: '#722ed1' },
  tif: { icon: <FileImageOutlined />, color: '#722ed1' },
  tiff: { icon: <FileImageOutlined />, color: '#722ed1' },
  ico: { icon: <FileImageOutlined />, color: '#722ed1' },
  // 图纸 / 矢量
  dwg: { icon: <BorderOuterOutlined />, color: '#13c2c2' },
  dxf: { icon: <BorderOuterOutlined />, color: '#13c2c2' },
  vsd: { icon: <DeploymentUnitOutlined />, color: '#eb2f96' },
  vsdx: { icon: <DeploymentUnitOutlined />, color: '#eb2f96' },
  drawio: { icon: <DeploymentUnitOutlined />, color: '#eb2f96' },
  // 音视频
  mp4: { icon: <VideoCameraOutlined />, color: '#fa541c' },
  avi: { icon: <VideoCameraOutlined />, color: '#fa541c' },
  mov: { icon: <VideoCameraOutlined />, color: '#fa541c' },
  mkv: { icon: <VideoCameraOutlined />, color: '#fa541c' },
  mp3: { icon: <AudioOutlined />, color: '#fa541c' },
  wav: { icon: <AudioOutlined />, color: '#fa541c' },
  // 代码 / 数据
  js: { icon: <CodeOutlined />, color: '#595959' },
  ts: { icon: <CodeOutlined />, color: '#595959' },
  json: { icon: <CodeOutlined />, color: '#595959' },
  html: { icon: <CodeOutlined />, color: '#595959' },
  htm: { icon: <CodeOutlined />, color: '#595959' },
  css: { icon: <CodeOutlined />, color: '#595959' },
  xml: { icon: <CodeOutlined />, color: '#595959' },
  py: { icon: <CodeOutlined />, color: '#595959' },
  java: { icon: <CodeOutlined />, color: '#595959' },
  go: { icon: <CodeOutlined />, color: '#595959' },
  c: { icon: <CodeOutlined />, color: '#595959' },
  cpp: { icon: <CodeOutlined />, color: '#595959' },
  sh: { icon: <CodeOutlined />, color: '#595959' },
}

/** 未知类型的兜底图标 */
const FALLBACK: IconSpec = { icon: <FileUnknownOutlined />, color: '#8a919f' }
/** 附件（取不到扩展名时）的兜底图标 */
const ATTACHMENT_FALLBACK: IconSpec = { icon: <PaperClipOutlined />, color: '#2f54eb' }
/** 目录（doc_type=folder）配色：与树里「有子节点的文档」保持一致 */
export const FOLDER_COLOR = '#faad14'

/** 按扩展名取图标（未知返回文件兜底图标） */
export function iconForExt(ext: string): IconSpec {
  const key = ext.replace(/^\./, '').toLowerCase()
  return EXT_ICONS[key] ?? FALLBACK
}

/** 按文件名取图标（内部取扩展名） */
export function iconForFileName(name: string): IconSpec {
  const ext = extOfFileName(name)
  return ext ? iconForExt(ext) : FALLBACK
}

/** 附件文档（doc_type=file）图标：优先按扩展名，取不到扩展名时用附件图标 */
export function iconForAttachment(name: string): IconSpec {
  const ext = extOfFileName(name)
  return ext ? iconForExt(ext) : ATTACHMENT_FALLBACK
}

/**
 * 按文档类型取图标（目录树、新建下拉共用）。
 * file（附件）额外传入文件名以便按扩展名区分 pdf / xlsx / dwg …
 * folder（目录）固定用文件夹图标，与树里「有子节点的文档」显示一致。
 */
export function iconForDocType(docType: DocType, name?: string): IconSpec {
  switch (docType) {
    case 'folder':
      return { icon: <FolderOutlined />, color: FOLDER_COLOR }
    case 'sheet':
      return { icon: <TableOutlined />, color: '#13c2c2' }
    case 'mindmap':
      return { icon: <ApartmentOutlined />, color: '#722ed1' }
    case 'flowchart':
      return { icon: <PartitionOutlined />, color: '#fa8c16' }
    case 'drawing':
      return { icon: <DeploymentUnitOutlined />, color: '#eb2f96' }
    case 'todo':
      return { icon: <CheckSquareOutlined />, color: '#52c41a' }
    case 'calendar':
      return { icon: <CalendarOutlined />, color: '#1677ff' }
    case 'gantt':
      return { icon: <NodeIndexOutlined />, color: '#fa8c16' }
    case 'api':
      return { icon: <ApiOutlined />, color: '#13c2c2' }
    case 'file':
      return iconForAttachment(name ?? '')
    default:
      return { icon: <FileTextOutlined />, color: '#8a919f' }
  }
}
