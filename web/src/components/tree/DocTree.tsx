import { lazy, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button, Dropdown, Empty, Input, Modal, Select, Spin, message } from 'antd'
import {
  CaretDownOutlined,
  CaretRightOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  HolderOutlined,
  ImportOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
  PushpinFilled,
  ShareAltOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import { buildChildrenMap, useDocTreeStore } from '../../stores/docTreeStore'
import {
  createDoc,
  deleteDoc,
  duplicateDoc,
  moveDoc,
  moveDocToBook,
  patchDoc,
  pinDoc,
} from '../../api/docs'
import { listBooks } from '../../api/books'
import { DOC_TYPES, DOC_TYPE_LABEL, type BookWithCount, type DocNode, type DocType } from '../../types'
import LazyBoundary from '../common/LazyBoundary'
import { IMPORT_FORMATS, IMPORT_URL_KEY } from '../../lib/import/formats'
import { iconForDocType } from '../../lib/fileIcon'
import { internalLink } from '../../lib/internalLink'
import { buildPlusMenuItems, buildTreeMenuItems, type TreeMenuHandlers } from '../../lib/treeMenu'
import UrlImportDialog from '../import/UrlImportDialog'

// ⚠️ 必须懒加载：ImportDialog 会静态拉入 lib/import/parse.ts，
// 后者又拉入 SheetJS(xlsx) / turndown / jszip 等解析器。本组件是知识库页的常驻树，
// 静态引入会让「打开知识库」就下载 ~400KB 的导入解析代码（即使用户从不导入）。
const ImportDialog = lazy(() => import('../import/ImportDialog'))

/** 新建文档按类型的默认名（R2）；file（导入的附件）与 folder（目录）不在此入口新建 */
const DEFAULT_NAMES: Record<DocType, string> = {
  markdown: '未命名文档',
  sheet: '未命名表格',
  mindmap: '未命名思维导图',
  flowchart: '未命名流程图',
  drawing: '未命名绘图',
  todo: '未命名待办清单',
  calendar: '未命名工作日历',
  gantt: '未命名甘特图',
  api: '未命名接口',
  file: '未命名附件',
  folder: '未命名目录',
  web: '未命名网页',
  gallery: '未命名图片库',
  prototype: '未命名需求原型',
}

/**
 * 节点图标：目录用 Folder，其余按 doc_type 分发；
 * 附件（doc_type=file）再按标题里的扩展名细分（pdf / xlsx / dwg / zip …）。
 * 映射表统一在 lib/fileIcon.tsx，避免各处各写一份。
 */
function nodeIcon(node: DocNode, hasChildren: boolean) {
  if (hasChildren) return <FolderOutlined style={{ color: '#faad14' }} />
  const spec = iconForDocType(node.doc_type, node.title)
  return <span style={{ color: spec.color }}>{spec.icon}</span>
}

// ---------- R3：导入格式下拉 ----------
//
// 映射表来自 lib/import/formats.ts（轻量模块，不拉解析器）：
// 扩展名集合与 lib/import/parse.ts 的解析器注册表保持一致，
// 这样「选中 Word」时文件对话框就只会筛出 .docx/.doc，不会出现格式与扩展名错配。

interface RowProps {
  node: DocNode
  depth: number
  selected: boolean
  expanded: boolean
  hasChildren: boolean
  canWrite: boolean
  bookId: number
  onToggle: (id: number) => void
  onSelect: (id: number) => void
  /** 复用现有「新建子文档」弹窗：在 parent 下以指定类型新建（走 openCreate） */
  onCreateChildTyped: (parent: DocNode, docType: DocType) => void
  onRename: (node: DocNode) => void
  onDelete: (node: DocNode) => void
  onEdit: (node: DocNode) => void
  onDuplicate: (node: DocNode) => void
  onMove: (node: DocNode) => void
  onExport: (node: DocNode) => void
  onShare: (node: DocNode) => void
  onPin: (node: DocNode) => void
  /** 移出目录：把文档移到当前书根级（parent_id=0） */
  onMoveOut: (node: DocNode) => void
}

/** 单行节点：dnd-kit useSortable + 右键菜单（第四轮 R4 增强） */
function TreeRow(p: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: p.node.id,
    disabled: !p.canWrite,
  })
  const caret = p.hasChildren ? (
    <span
      onClick={(e) => {
        e.stopPropagation()
        p.onToggle(p.node.id)
      }}
      style={{ width: 16, textAlign: 'center', color: '#8a919f' }}
    >
      {p.expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
    </span>
  ) : (
    <span style={{ width: 16, textAlign: 'center' }} />
  )

  const menu = {
    items: [
      { key: 'rename', icon: <EditOutlined />, label: '重命名', disabled: !p.canWrite },
      {
        key: 'edit',
        icon: <FileTextOutlined />,
        label: '编辑文档',
        // 附件型文档（导入的 docx/pdf）按原文件保存，不可编辑
        disabled: !p.canWrite || p.node.doc_type === 'file',
      },
      { key: 'copy', icon: <CopyOutlined />, label: '复制', disabled: !p.canWrite },
      { key: 'move', icon: <FolderOpenOutlined />, label: '移动到其他知识库', disabled: !p.canWrite },
      { key: 'export', icon: <DownloadOutlined />, label: '导出' },
      { key: 'share', icon: <ShareAltOutlined />, label: '分享' },
      {
        key: 'collab',
        icon: <UserAddOutlined />,
        label: '邀请协作',
        // 协作者管理需要文档编辑权限（后端二次校验，此处只做界面前置置灰）
        disabled: !p.canWrite,
      },
      {
        key: 'pin',
        icon: <PushpinFilled style={{ color: p.node.pinned_at ? '#fa8c16' : undefined }} />,
        label: p.node.pinned_at ? '取消置顶' : '置顶',
        disabled: !p.canWrite,
      },
      { type: 'divider' as const },
      { key: 'create', icon: <FileAddOutlined />, label: '新建子文档', disabled: !p.canWrite },
      { key: 'delete', icon: <DeleteOutlined />, label: '删除（进回收站）', danger: true, disabled: !p.canWrite },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'create') p.onCreateChildTyped(p.node, 'markdown')
      if (key === 'rename') p.onRename(p.node)
      if (key === 'edit') p.onEdit(p.node)
      if (key === 'copy') p.onDuplicate(p.node)
      if (key === 'move') p.onMove(p.node)
      if (key === 'export') p.onExport(p.node)
      if (key === 'share') p.onShare(p.node)
      if (key === 'pin') p.onPin(p.node)
      if (key === 'delete') p.onDelete(p.node)
    },
  }

  // 语雀式 hover「⋮」菜单：与右键菜单共用同样的 handlers，但顺序/分组按语雀清单
  const treeMenuHandlers: TreeMenuHandlers = {
    onRename: () => p.onRename(p.node),
    onEdit: () => p.onEdit(p.node),
    onCopyLink: () => {
      const link = internalLink(p.bookId, p.node.id)
      void navigator.clipboard?.writeText(link)
      message.success('链接已复制')
    },
    onOpenInNewTab: () => {
      const link = internalLink(p.bookId, p.node.id)
      window.open(link, '_blank')
    },
    onMoveOut: () => p.onMoveOut(p.node),
    onDuplicate: () => p.onDuplicate(p.node),
    onMove: () => p.onMove(p.node),
    onExport: () => p.onExport(p.node),
    onPin: () => p.onPin(p.node),
    onDelete: () => p.onDelete(p.node),
  }
  const treeMenuCtx = { node: p.node, bookId: p.bookId, canWrite: p.canWrite, handlers: treeMenuHandlers }

  return (
    <Dropdown menu={menu} trigger={['contextMenu']}>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={'tree-row' + (p.selected ? ' selected' : '') + (isDragging ? ' dragging' : '')}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          paddingLeft: p.depth * 16 + 4,
        }}
        onClick={() => p.onSelect(p.node.id)}
      >
        {caret}
        {nodeIcon(p.node, p.hasChildren)}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{p.node.title}</span>
        {/* 置顶标识（R4） */}
        {p.node.pinned_at && <PushpinFilled style={{ color: '#fa8c16', fontSize: 12, marginRight: 2 }} />}
        {/* 语雀式 hover 操作区：⋮（更多操作）与 +（快速新建），默认隐藏，行 hover 出现 */}
        <span
          className="hk-tree-actions"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Dropdown
            menu={{ items: buildTreeMenuItems(treeMenuCtx) }}
            trigger={['click']}
            placement="bottomRight"
          >
            <span
              role="button"
              aria-label="更多操作"
              className="hk-tree-action-btn"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreOutlined style={{ fontSize: 13 }} />
            </span>
          </Dropdown>
          {p.canWrite && (
            <Dropdown
              menu={{ items: buildPlusMenuItems(p.node, (dt) => p.onCreateChildTyped(p.node, dt)) }}
              trigger={['click']}
              placement="bottomRight"
            >
              <span
                role="button"
                aria-label="新建子文档"
                className="hk-tree-action-btn"
                onClick={(e) => e.stopPropagation()}
              >
                <PlusOutlined style={{ fontSize: 12 }} />
              </span>
            </Dropdown>
          )}
        </span>
        <HolderOutlined style={{ opacity: 0.25 }} />
      </div>
    </Dropdown>
  )
}

interface Props {
  bookId: number
  selectedId: number | null
  onSelect: (id: number) => void
  /** 右键"编辑文档"：定位并打开该文档编辑模式（BookPage edit 分支） */
  onOpenInEdit: (id: number) => void
  /** 右键"分享"：由父组件打开 DocShareDrawer */
  onShare: (node: DocNode) => void
  /** 右键"导出"：由父组件打开 ExportDialog（doc 模式） */
  onExportDoc: (node: DocNode) => void
  /** 右键"邀请协作"：由父组件打开协作者管理弹窗 */
  onCollaborators: (node: DocNode) => void
  canWrite: boolean
  /** 知识库右键"新建文档"触发信号（每次自增打开新建弹窗） */
  createSignal: number
}

/**
 * 目录树（dnd-kit 拖拽 / 第四轮 R2-R4 增强）：
 *  - 拖拽到目标行左/右半区 = 调整为同级前后顺序；明显右移 = 变为子节点
 *  - 顶部：新建文档 Dropdown.Button（主按钮=markdown，下拉 4 类型→命名弹窗）+ 导入格式下拉
 *  - 文档右键菜单：重命名/编辑文档/复制/移动/导出/分享/置顶（取消置顶）/新建子文档/删除
 */
export default function DocTree({
  bookId,
  selectedId,
  onSelect,
  onOpenInEdit,
  onShare,
  onExportDoc,
  onCollaborators,
  canWrite,
  createSignal,
}: Props) {
  const { docs, loading, loadTree } = useDocTreeStore()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [renameNode, setRenameNode] = useState<DocNode | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [createParent, setCreateParent] = useState<DocNode | 'root' | null>(null)
  const [createValue, setCreateValue] = useState('')
  const [createType, setCreateType] = useState<DocType>('markdown')

  // R3：导入下拉 → 隐藏文件选择器 → ImportDialog（外部传文件）
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importAcceptRef = useRef<string>(IMPORT_FORMATS[0].accept)
  const [importFiles, setImportFiles] = useState<File[] | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  // R5：URL 导入（下拉里的「网页链接」项，不经过文件选择器）
  const [urlImportOpen, setUrlImportOpen] = useState(false)

  // R4：移动到其他知识库
  const [moveNode, setMoveNode] = useState<DocNode | null>(null)
  const [moveTargetId, setMoveTargetId] = useState<number | null>(null)
  const [moveBooks, setMoveBooks] = useState<BookWithCount[] | null>(null)
  const [moveLoading, setMoveLoading] = useState(false)
  const [moveSaving, setMoveSaving] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const childrenMap = useMemo(() => buildChildrenMap(docs), [docs])
  const roots = childrenMap.get(0) || []

  // 知识库右键"新建文档"：createSignal 自增时打开新建弹窗
  useEffect(() => {
    if (createSignal > 0) {
      setCreateValue(DEFAULT_NAMES.markdown)
      setCreateType('markdown')
      setCreateParent('root')
    }
  }, [createSignal])

  // 默认全部展开（首次加载后）
  useEffect(() => {
    if (docs.length > 0 && expanded.size === 0) {
      const all = new Set<number>()
      for (const d of docs) {
        if ((childrenMap.get(d.id) || []).length > 0) all.add(d.id)
      }
      setExpanded(all)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs])

  interface FlatRow {
    node: DocNode
    depth: number
  }
  const rows: FlatRow[] = useMemo(() => {
    const out: FlatRow[] = []
    const walk = (list: DocNode[], depth: number) => {
      for (const n of list) {
        out.push({ node: n, depth })
        if (expanded.has(n.id)) walk(childrenMap.get(n.id) || [], depth + 1)
      }
    }
    walk(roots, 0)
    return out
  }, [docs, expanded, childrenMap, roots])

  const isDescendant = (target: number, ancestor: number): boolean => {
    let cur = target
    for (let i = 0; i < 64; i++) {
      const d = docs.find((x) => x.id === cur)
      if (!d) return false
      if (d.parent_id === ancestor) return true
      if (d.parent_id === 0) return false
      cur = d.parent_id
    }
    return false
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const activeDoc = docs.find((d) => d.id === active.id)
    const overDoc = docs.find((d) => d.id === over.id)
    if (!activeDoc || !overDoc) return
    if (isDescendant(overDoc.id, activeDoc.id)) {
      message.warning('不能移动到自身或其子孙节点下')
      return
    }
    const translated = active.rect.current.translated
    if (!translated) return
    const dx = translated.left - over.rect.left
    const dy = translated.top + translated.height / 2 - (over.rect.top + over.rect.height / 2)

    try {
      if (dx > 28) {
        // 明显右移：成为 over 的子节点（追加到末尾）
        await moveDoc(activeDoc.id, { parent_id: overDoc.id })
      } else if (dy < 0) {
        // 放到 over 前面
        const siblings = (childrenMap.get(overDoc.parent_id) || []).filter((d) => d.id !== activeDoc.id)
        const prev = siblings.filter((s) => s.pos < overDoc.pos).pop()
        await moveDoc(activeDoc.id, {
          parent_id: overDoc.parent_id,
          prev_pos: prev?.pos,
          next_pos: overDoc.pos,
        })
      } else {
        // 放到 over 后面
        const siblings = (childrenMap.get(overDoc.parent_id) || []).filter((d) => d.id !== activeDoc.id)
        const next = siblings.find((s) => s.pos > overDoc.pos)
        await moveDoc(activeDoc.id, {
          parent_id: overDoc.parent_id,
          prev_pos: overDoc.pos,
          next_pos: next?.pos,
        })
      }
      message.success('已移动')
      await loadTree(bookId)
    } catch {
      /* 拦截器已提示 */
    }
  }

  // ---------- R2：新建文档 ----------

  /** 打开新建弹窗（按类型给默认名） */
  function openCreate(docType: DocType, parent: DocNode | 'root' = 'root') {
    // 选中父节点为非 markdown 时，默认跟随其类型（架构文档 §4.1）；显式选类型时以所选为准
    const t = parent !== 'root' && docType === 'markdown' && parent.doc_type && parent.doc_type !== 'markdown'
      ? parent.doc_type
      : docType
    setCreateType(t)
    setCreateValue(DEFAULT_NAMES[t])
    setCreateParent(parent)
  }

  async function submitCreate() {
    if (!createParent) return
    const title = createValue.trim() || DEFAULT_NAMES[createType]
    const parentId = createParent === 'root' ? 0 : createParent.id
    try {
      const doc = await createDoc(bookId, parentId, title, createType)
      setCreateParent(null)
      setCreateValue('')
      setCreateType('markdown')
      await loadTree(bookId)
      // 展开父节点并选中新文档
      if (parentId > 0) setExpanded((s) => new Set(s).add(parentId))
      onSelect(doc.id)
    } catch {
      /* 拦截器已提示 */
    }
  }

  async function submitRename() {
    if (!renameNode) return
    const title = renameValue.trim() || DEFAULT_NAMES[renameNode.doc_type ?? 'markdown']
    try {
      await patchDoc(renameNode.id, { title })
      setRenameNode(null)
      await loadTree(bookId)
    } catch {
      /* 拦截器已提示 */
    }
  }

  function confirmDelete(node: DocNode) {
    Modal.confirm({
      title: `删除「${node.title}」？`,
      content: '文档及其子文档将移入回收站，可随时恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await deleteDoc(node.id)
        message.success('已移入回收站')
        await loadTree(bookId)
        if (selectedId === node.id) onSelect(0)
      },
    })
  }

  // ---------- R4：复制 / 移动 / 置顶 ----------

  async function handleDuplicate(node: DocNode) {
    try {
      const cp = await duplicateDoc(node.id)
      message.success(`已复制为「${cp.title}」`)
      await loadTree(bookId)
    } catch {
      /* 拦截器已提示 */
    }
  }

  /** 打开移动弹窗：拉取我有写权限的知识库（我的库 + 成员可见库，排除当前库） */
  async function openMove(node: DocNode) {
    setMoveNode(node)
    setMoveTargetId(null)
    setMoveBooks(null)
    setMoveLoading(true)
    try {
      const shelf = await listBooks()
      const writable = [...shelf.mine, ...shelf.visible.filter((b) => b.visibility === 'members')]
      setMoveBooks(writable.filter((b) => b.id !== bookId))
    } catch {
      setMoveBooks([])
    } finally {
      setMoveLoading(false)
    }
  }

  async function submitMove() {
    if (!moveNode || !moveTargetId) return
    setMoveSaving(true)
    try {
      await moveDocToBook(moveNode.id, moveTargetId)
      const target = moveBooks?.find((b) => b.id === moveTargetId)
      message.success(`已移动到「${target?.name ?? '目标知识库'}」根目录`)
      setMoveNode(null)
      await loadTree(bookId)
      if (selectedId === moveNode.id) onSelect(0)
    } catch {
      /* 拦截器已提示 */
    } finally {
      setMoveSaving(false)
    }
  }

  async function handlePin(node: DocNode) {
    try {
      await pinDoc(node.id, !node.pinned_at)
      message.success(node.pinned_at ? '已取消置顶' : '已置顶')
      await loadTree(bookId)
    } catch {
      /* 拦截器已提示 */
    }
  }

  /** 移出目录：把文档移到当前知识库根级（parent_id=0，后端已做防环校验） */
  async function handleMoveOut(node: DocNode) {
    try {
      await moveDoc(node.id, { parent_id: 0 })
      message.success('已移出目录')
      await loadTree(bookId)
    } catch {
      /* 拦截器已提示 */
    }
  }

  // ---------- R3：导入 ----------

  /** 选择导入格式：限定 accept 并打开文件选择器（允许多选） */
  function pickImportFiles(accept: string) {
    importAcceptRef.current = accept
    if (fileInputRef.current) {
      fileInputRef.current.value = '' // 允许重复选择同一文件
      fileInputRef.current.click()
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setImportFiles(files)
    setImportOpen(true)
  }

  const createModalTitle = createParent === 'root' ? '新建文档' : `在「${(createParent as DocNode)?.title ?? ''}」下新建子文档`

  return (
    <div style={{ padding: 8 }}>
      {/* R2/R3：新建文档 Dropdown.Button + 导入格式下拉 */}
      {canWrite && (
        <div style={{ padding: '4px 4px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Dropdown.Button
            type="primary"
            size="small"
            onClick={() => openCreate('markdown')}
            menu={{
              items: DOC_TYPES.map((t) => ({
                key: t,
                icon: nodeIcon({ ...EMPTY_NODE, doc_type: t } as DocNode, false),
                label: DOC_TYPE_LABEL[t],
              })),
              onClick: ({ key }) => openCreate(key as DocType),
            }}
          >
            <FileAddOutlined /> 新建文档
          </Dropdown.Button>
          <Dropdown
            menu={{
              items: [
                // URL 导入置顶：它走弹窗而非文件选择器
                { key: IMPORT_URL_KEY, icon: <LinkOutlined />, label: '网页链接（URL）' },
                { type: 'divider' as const },
                ...IMPORT_FORMATS.map((f) => ({ key: f.key, icon: <ImportOutlined />, label: f.label })),
              ],
              onClick: ({ key }) => {
                if (key === IMPORT_URL_KEY) {
                  setUrlImportOpen(true)
                  return
                }
                const f = IMPORT_FORMATS.find((x) => x.key === key)
                if (f) pickImportFiles(f.accept)
              },
            }}
          >
            <Button size="small" icon={<ImportOutlined />}>
              导入
            </Button>
          </Dropdown>
        </div>
      )}

      {/* R3：隐藏文件选择器（accept 按所选格式限定，多选） */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        multiple
        accept={importAcceptRef.current}
        onChange={onFileInputChange}
      />

      {loading && <Spin style={{ display: 'block', margin: '24px auto' }} />}

      {!loading && docs.length === 0 && (
        <Empty description="暂无文档" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 40 }} />
      )}

      {!loading && docs.length > 0 && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={rows.map((r) => r.node.id)} strategy={verticalListSortingStrategy}>
            {rows.map((r) => (
              <TreeRow
                key={r.node.id}
                node={r.node}
                depth={r.depth}
                selected={selectedId === r.node.id}
                expanded={expanded.has(r.node.id)}
                hasChildren={(childrenMap.get(r.node.id) || []).length > 0}
                canWrite={canWrite}
                bookId={bookId}
                onToggle={(id) =>
                  setExpanded((s) => {
                    const next = new Set(s)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                }
                onSelect={onSelect}
                onCreateChildTyped={(parent, dt) => openCreate(dt, parent)}
                onRename={(n) => {
                  setRenameValue(n.title)
                  setRenameNode(n)
                }}
                onDelete={confirmDelete}
                onEdit={(n) => onOpenInEdit(n.id)}
                onDuplicate={handleDuplicate}
                onMove={openMove}
                onExport={onExportDoc}
                onShare={onShare}
                onPin={handlePin}
                onMoveOut={handleMoveOut}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}

      {/* R2：新建文档弹窗（类型已由下拉选定，此处可微调类型与命名） */}
      <Modal
        title={createModalTitle}
        open={!!createParent}
        onOk={() => void submitCreate()}
        onCancel={() => setCreateParent(null)}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          placeholder="文档标题"
          value={createValue}
          autoFocus
          onChange={(e) => setCreateValue(e.target.value)}
          onPressEnter={() => void submitCreate()}
          style={{ marginBottom: 12 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#5f6672' }}>文档类型：</span>
          <Select
            value={createType}
            style={{ width: 180 }}
            onChange={setCreateType}
            options={DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABEL[t] }))}
          />
        </div>
      </Modal>

      {/* 重命名弹窗 */}
      <Modal
        title="重命名"
        open={!!renameNode}
        onOk={() => void submitRename()}
        onCancel={() => setRenameNode(null)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          value={renameValue}
          autoFocus
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={() => void submitRename()}
        />
      </Modal>

      {/* R4：移动到其他知识库弹窗 */}
      <Modal
        title={`移动「${moveNode?.title ?? ''}」`}
        open={!!moveNode}
        onOk={() => void submitMove()}
        onCancel={() => setMoveNode(null)}
        okText="移动"
        okButtonProps={{ disabled: !moveTargetId }}
        confirmLoading={moveSaving}
        cancelText="取消"
        destroyOnClose
      >
        {moveLoading && <Spin style={{ display: 'block', margin: '16px auto' }} />}
        {!moveLoading && moveBooks && moveBooks.length === 0 && (
          <Empty description="没有可写入的其他知识库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        {!moveLoading && moveBooks && moveBooks.length > 0 && (
          <Select
            style={{ width: '100%' }}
            placeholder="选择目标知识库（我有编辑权限）"
            value={moveTargetId}
            onChange={setMoveTargetId}
            options={moveBooks.map((b) => ({ value: b.id, label: b.name }))}
          />
        )}
        <div style={{ marginTop: 12, color: '#8a919f', fontSize: 12 }}>
          移动后该文档及其子文档将整体迁移到目标知识库根目录末尾。
        </div>
      </Modal>

      {/* R3：导入对话框（复用解析与逐文件反馈逻辑；目标=当前知识库根目录）
          仅在打开时挂载 + 懒加载：ImportDialog 自带 destroyOnClose，且 effect 均以 open 为条件，
          延迟挂载不改变行为（初始文件在同一次 setState 批中一并传入）。 */}
      {importOpen && (
        <LazyBoundary tip="正在加载导入组件…">
          <ImportDialog
            open={importOpen}
            onClose={() => setImportOpen(false)}
            bookId={bookId}
            onImported={() => void loadTree(bookId)}
            initialFiles={importFiles}
            onFilesConsumed={() => setImportFiles(null)}
          />
        </LazyBoundary>
      )}

      {/* R5：URL 导入弹窗（抓取网页转 Markdown 落入本库） */}
      <UrlImportDialog
        open={urlImportOpen}
        onClose={() => setUrlImportOpen(false)}
        defaultBookId={bookId}
        onImported={() => void loadTree(bookId)}
      />
    </div>
  )
}

/** 仅用于取下拉图标的最小节点模板（nodeIcon 需要 DocNode 形状） */
const EMPTY_NODE = {
  id: 0,
  book_id: 0,
  parent_id: 0,
  title: '',
  pos: '',
  pinned_at: null,
  updated_at: '',
}
