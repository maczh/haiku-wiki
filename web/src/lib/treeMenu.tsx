/**
 * 目录树 hover「⋮」菜单 与 行尾「+」快速新建菜单 的工厂函数。
 *
 * 设计要点（架构文档 T02 / 共享知识 §2）：
 *  - `buildTreeMenuItems` 产出的 `MenuProps['items']` 既用于右键 contextMenu，
 *    也用于 hover 点击菜单，确保文案 / 顺序 / 禁用逻辑完全一致；
 *  - 全部动作通过 `handlers`（已由调用方绑定到具体节点）执行，工厂不碰任何 API；
 *  - 「+」菜单产出的 6 项直接回调 `onCreate(docType)`，由调用方决定新建流程。
 */

import type { MenuProps } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExportOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  LinkOutlined,
  PictureOutlined,
  PushpinFilled,
  ShareAltOutlined,
  TableOutlined,
} from '@ant-design/icons'
import type { DocNode, DocType } from '../types'

/** ⋮ 菜单所需的全部回调（调用方需绑定到具体 node） */
export interface TreeMenuHandlers {
  onRename: () => void
  onEdit: () => void
  onCopyLink: () => void
  onOpenInNewTab: () => void
  onMoveOut: () => void
  onDuplicate: () => void
  onMove: () => void
  onExport: () => void
  onPin: () => void
  onDelete: () => void
}

/** ⋮ 菜单的上下文 */
export interface TreeMenuContext {
  node: DocNode
  bookId: number
  canWrite: boolean
  handlers: TreeMenuHandlers
}

/**
 * 构建文档行的「⋮」操作菜单（语雀顺序）：
 *   重命名 / 编辑文档 / 复制链接 / 在新标签页打开 / 移出目录
 *   ── 复制… / 移动… / 导出… / 置顶（取消置顶）
 *   ── 删除
 *
 * 需写权限的项在 canWrite=false 时置灰；附件型(file)/目录(folder)不支持编辑。
 */
export function buildTreeMenuItems(ctx: TreeMenuContext): MenuProps['items'] {
  const { node, canWrite, handlers } = ctx
  const isFolder = node.doc_type === 'folder'
  const isFile = node.doc_type === 'file'
  const items: NonNullable<MenuProps['items']> = [
    {
      key: 'rename',
      icon: <EditOutlined />,
      label: '重命名',
      disabled: !canWrite,
      onClick: handlers.onRename,
    },
    {
      key: 'edit',
      icon: <FileTextOutlined />,
      label: '编辑文档',
      disabled: !canWrite || isFile || isFolder,
      onClick: handlers.onEdit,
    },
    {
      key: 'copyLink',
      icon: <LinkOutlined />,
      label: '复制链接',
      onClick: handlers.onCopyLink,
    },
    {
      key: 'openNewTab',
      icon: <ExportOutlined />,
      label: '在新标签页打开',
      onClick: handlers.onOpenInNewTab,
    },
    {
      key: 'moveOut',
      icon: <ExportOutlined />,
      label: '移出目录',
      disabled: !canWrite,
      onClick: handlers.onMoveOut,
    },
    { type: 'divider' },
    {
      key: 'duplicate',
      icon: <CopyOutlined />,
      label: '复制…',
      disabled: !canWrite,
      onClick: handlers.onDuplicate,
    },
    {
      key: 'move',
      icon: <ExportOutlined />,
      label: '移动…',
      disabled: !canWrite,
      onClick: handlers.onMove,
    },
    {
      key: 'export',
      icon: <DownloadOutlined />,
      label: '导出…',
      onClick: handlers.onExport,
    },
    {
      key: 'pin',
      icon: <PushpinFilled style={{ color: node.pinned_at ? '#fa8c16' : undefined }} />,
      label: node.pinned_at ? '取消置顶' : '置顶',
      disabled: !canWrite,
      onClick: handlers.onPin,
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除',
      danger: true,
      disabled: !canWrite,
      onClick: handlers.onDelete,
    },
  ]
  return items
}

/**
 * 构建文档行行尾「+」快速新建菜单（语雀顺序）：
 *   文档 / 表格 / 画板 / 思维导图 / 流程图
 *   ── 新建分组
 *
 * 点击任一项回调 `onCreate(docType)`；其中「新建分组」对应 doc_type='folder'。
 * （+ 按钮本身在 canWrite=false 时不渲染，故此处无需 disabled 处理。）
 */
export function buildPlusMenuItems(
  _parent: DocNode,
  onCreate: (docType: DocType) => void,
): MenuProps['items'] {
  return [
    { key: 'markdown', icon: <FileTextOutlined />, label: '文档', onClick: () => onCreate('markdown') },
    { key: 'sheet', icon: <TableOutlined />, label: '表格', onClick: () => onCreate('sheet') },
    { key: 'drawing', icon: <PictureOutlined />, label: '画板', onClick: () => onCreate('drawing') },
    { key: 'mindmap', label: '思维导图', onClick: () => onCreate('mindmap') },
    { key: 'flowchart', label: '流程图', onClick: () => onCreate('flowchart') },
    { type: 'divider' },
    {
      key: 'folder',
      icon: <FolderAddOutlined />,
      label: '新建分组',
      onClick: () => onCreate('folder'),
    },
  ]
}
