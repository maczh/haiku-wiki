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
  ImportOutlined,
  LinkOutlined,
  PushpinFilled,
  ShareAltOutlined,
} from '@ant-design/icons'
import type { DocNode, DocType } from '../types'
import { DOC_TYPES, DOC_TYPE_LABEL } from '../types'
import { iconForDocType } from './fileIcon'

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
 * 构建文档行行尾「+」快速新建菜单：
 *   全部可新建类型（DOC_TYPES 顺序：文档/表格/思维导图/流程图/绘图/待办清单/
 *   工作日历/甘特图/接口/图片库/需求原型）
 *   ── 新建分组 / 导入文件
 *
 * 点击类型项回调 `onCreate(docType)`（folder 对应「新建分组」）；
 * 点击「导入文件」回调 `onImport`。图标统一走 iconForDocType，与目录树/阅读页一致。
 * （+ 按钮本身在 canWrite=false 时不渲染，故此处无需 disabled 处理。）
 */
export function buildPlusMenuItems(
  _parent: DocNode,
  onCreate: (docType: DocType) => void,
  onImport: () => void,
): MenuProps['items'] {
  const typeItems: NonNullable<MenuProps['items']> = DOC_TYPES.map((dt) => {
    const spec = iconForDocType(dt)
    return {
      key: dt,
      icon: <span style={{ color: spec.color }}>{spec.icon}</span>,
      label: DOC_TYPE_LABEL[dt],
      onClick: () => onCreate(dt),
    }
  })
  return [
    ...typeItems,
    { type: 'divider' },
    {
      key: 'folder',
      icon: <FolderAddOutlined />,
      label: '新建分组',
      onClick: () => onCreate('folder'),
    },
    {
      key: 'import',
      icon: <ImportOutlined />,
      label: '导入文件',
      onClick: onImport,
    },
  ]
}
