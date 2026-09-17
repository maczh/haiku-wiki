import { useEffect, useMemo, useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Dropdown, Empty, Input, Modal, Select, Spin, message } from 'antd'
import {
  ApartmentOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FolderOutlined,
  HolderOutlined,
  PartitionOutlined,
  PlusOutlined,
  TableOutlined,
} from '@ant-design/icons'
import { buildChildrenMap, useDocTreeStore } from '../../stores/docTreeStore'
import { createDoc, deleteDoc, moveDoc, patchDoc } from '../../api/docs'
import { DOC_TYPES, DOC_TYPE_LABEL, type DocNode, type DocType } from '../../types'

/** 目录树节点图标按 doc_type 分发（目录仍是 Folder；markdown 文档用 File） */
function nodeIcon(node: DocNode, hasChildren: boolean) {
  if (hasChildren) return <FolderOutlined style={{ color: '#faad14' }} />
  switch (node.doc_type) {
    case 'sheet':
    case 'datatable':
      return <TableOutlined style={{ color: '#13c2c2' }} />
    case 'mindmap':
      return <ApartmentOutlined style={{ color: '#722ed1' }} />
    case 'flowchart':
      return <PartitionOutlined style={{ color: '#fa8c16' }} />
    default:
      return <FileTextOutlined style={{ color: '#8a919f' }} />
  }
}

interface RowProps {
  node: DocNode
  depth: number
  selected: boolean
  expanded: boolean
  hasChildren: boolean
  canWrite: boolean
  onToggle: (id: number) => void
  onSelect: (id: number) => void
  onCreateChild: (parent: DocNode) => void
  onRename: (node: DocNode) => void
  onDelete: (node: DocNode) => void
}

/** 单行节点：dnd-kit useSortable + 右键菜单 */
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
      { key: 'create', icon: <PlusOutlined />, label: '新建子文档', disabled: !p.canWrite },
      { key: 'rename', icon: <FileTextOutlined />, label: '重命名', disabled: !p.canWrite },
      { key: 'delete', icon: <DeleteOutlined />, label: '删除（进回收站）', danger: true, disabled: !p.canWrite },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'create') p.onCreateChild(p.node)
      if (key === 'rename') p.onRename(p.node)
      if (key === 'delete') p.onDelete(p.node)
    },
  }

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
        <HolderOutlined style={{ opacity: 0.25 }} />
      </div>
    </Dropdown>
  )
}

interface Props {
  bookId: number
  selectedId: number | null
  onSelect: (id: number) => void
  canWrite: boolean
}

/**
 * 目录树（dnd-kit 拖拽）：
 *  - 拖拽到目标行左/右半区 = 调整为同级前后顺序
 *  - 拖拽明显右移（>28px）= 变为目标节点的子节点
 *  - 右键菜单：新建子文档 / 重命名 / 删除
 */
export default function DocTree({ bookId, selectedId, onSelect, canWrite }: Props) {
  const { docs, loading, loadTree } = useDocTreeStore()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [renameNode, setRenameNode] = useState<DocNode | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [createParent, setCreateParent] = useState<DocNode | 'root' | null>(null)
  const [createValue, setCreateValue] = useState('')
  const [createType, setCreateType] = useState<DocType>('markdown')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const childrenMap = useMemo(() => buildChildrenMap(docs), [docs])
  const roots = childrenMap.get(0) || []

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
  }, [docs, expanded, childrenMap])

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

  async function submitCreate() {
    if (!createParent) return
    const title = createValue.trim() || '无标题文档'
    const parentId = createParent === 'root' ? 0 : createParent.id
    const doc = await createDoc(bookId, parentId, title, createType)
    setCreateParent(null)
    setCreateValue('')
    setCreateType('markdown')
    await loadTree(bookId)
    // 展开父节点并选中新文档
    if (parentId > 0) setExpanded((s) => new Set(s).add(parentId))
    onSelect(doc.id)
  }

  async function submitRename() {
    if (!renameNode) return
    const title = renameValue.trim() || '无标题文档'
    await patchDoc(renameNode.id, { title })
    setRenameNode(null)
    await loadTree(bookId)
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

  const createModalTitle = createParent === 'root' ? '新建文档' : `在「${(createParent as DocNode)?.title ?? ''}」下新建子文档`

  return (
    <div style={{ padding: 8 }}>
      {canWrite && (
        <div style={{ padding: '4px 4px 8px' }}>
          <a onClick={() => setCreateParent('root')} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#2f54eb' }}>
            <PlusOutlined /> 新建文档
          </a>
        </div>
      )}

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
                onToggle={(id) =>
                  setExpanded((s) => {
                    const next = new Set(s)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                }
                onSelect={onSelect}
                onCreateChild={(n) => {
                  setCreateValue('')
                  // 选中父节点为非 markdown 时，默认跟随其类型（架构文档 §4.1）
                  setCreateType(n.doc_type && n.doc_type !== 'markdown' ? n.doc_type : 'markdown')
                  setCreateParent(n)
                }}
                onRename={(n) => {
                  setRenameValue(n.title)
                  setRenameNode(n)
                }}
                onDelete={confirmDelete}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}

      {/* 新建文档弹窗 */}
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
    </div>
  )
}
