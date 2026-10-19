/**
 * 网盘文件的彩色类型图标（仿百度网盘 / 阿里云盘 的色块图标）。
 *
 * 纯展示组件：根据文件名 + 是否目录，渲染一块圆角色块 + antd 图标。
 * 色块尺寸由 `size`（图标字形 px）推算：色块 = size * 1.6，border-radius 10px。
 */

import type { CSSProperties, ReactNode } from 'react'
import {
  CustomerServiceOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileWordOutlined,
  FileZipOutlined,
  FolderOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import { categoryOf } from '../../lib/netdisk/format'

type TileKind =
  | 'folder'
  | 'image'
  | 'docWord'
  | 'docText'
  | 'sheet'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'zip'
  | 'other'

const COLOR: Record<TileKind, string> = {
  folder: '#faad14',
  image: '#52c41a',
  docWord: '#2f54eb',
  docText: '#2f54eb',
  sheet: '#13a8a8',
  pdf: '#f5222d',
  video: '#722ed1',
  audio: '#fa8c16',
  zip: '#8c6e54',
  other: '#8a919f',
}

function kindOf(name: string, isDir: boolean): TileKind {
  if (isDir) return 'folder'
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const cat = categoryOf(name, false)
  switch (cat) {
    case 'image':
      return 'image'
    case 'doc':
      // txt / md 用「文本」图标，其余（doc/docx/rtf/wps）用「文档」图标
      return ext === 'txt' || ext === 'md' ? 'docText' : 'docWord'
    case 'sheet':
      return 'sheet'
    case 'pdf':
      return 'pdf'
    case 'video':
      return 'video'
    case 'audio':
      return 'audio'
    case 'zip':
      return 'zip'
    default:
      return 'other'
  }
}

function iconOf(kind: TileKind): ReactNode {
  switch (kind) {
    case 'folder':
      return <FolderOutlined />
    case 'image':
      return <FileImageOutlined />
    case 'docWord':
      return <FileWordOutlined />
    case 'docText':
      return <FileTextOutlined />
    case 'sheet':
      return <FileExcelOutlined />
    case 'pdf':
      return <FilePdfOutlined />
    case 'video':
      return <VideoCameraOutlined />
    case 'audio':
      return <CustomerServiceOutlined />
    case 'zip':
      return <FileZipOutlined />
    default:
      return <FileOutlined />
  }
}

interface Props {
  name: string
  isDir: boolean
  /** 图标字形尺寸（px）。列表用 20，网格用 56。色块 = size * 1.6。 */
  size?: number
  /** 是否额外显示扩展名文字（默认 false，保持图标简洁） */
  showExt?: boolean
}

export default function NetdiskFileIcon({ name, isDir, size = 20, showExt = false }: Props) {
  const kind = kindOf(name, isDir)
  const color = COLOR[kind]
  const tile = Math.round(size * 1.6)

  const tileStyle: CSSProperties = {
    width: tile,
    height: tile,
    borderRadius: 10,
    background: `rgba(${hexToRgb(color)}, 0.12)`,
    color,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size,
    lineHeight: 1,
    flexShrink: 0,
    position: 'relative',
  }

  const ext = name.toLowerCase().split('.').pop() ?? ''

  return (
    <span className="hk-nd-file-icon" style={tileStyle} title={isDir ? '目录' : `.${ext}`}>
      {iconOf(kind)}
      {showExt && !isDir && ext && (
        <span
          style={{
            position: 'absolute',
            bottom: 4,
            fontSize: 9,
            fontWeight: 700,
            color,
            letterSpacing: 0.5,
          }}
        >
          {ext.toUpperCase().slice(0, 4)}
        </span>
      )}
    </span>
  )
}

/** #rrggbb → "r, g, b" */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}
