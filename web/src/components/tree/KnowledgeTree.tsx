import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tree, Dropdown, Empty, Modal, Input, Tooltip, message } from 'antd'
import type { TreeProps } from 'antd'
import type { DataNode } from 'antd/es/tree'
import {
  BookOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  ImportOutlined,
  MoreOutlined,
  PlusOutlined,
  PushpinFilled,
  SafetyCertificateOutlined,
  ShareAltOutlined,
  TeamOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import type { BookWithCount, Bookshelf, DocNode } from '../../types'
import { getTree, deleteDoc, patchDoc, moveDoc, moveDocToBook } from '../../api/docs'
import { buildChildrenMap } from '../../stores/docTreeStore'
import { iconForDocType } from '../../lib/fileIcon'
import { isDescendantOf } from '../../lib/docTree'
import { internalLink } from '../../lib/internalLink'
import { buildPlusMenuItems, buildTreeMenuItems, type TreeMenuHandlers } from '../../lib/treeMenu'
import type { ReactNode } from 'react'

interface NodeRaw {
  kind: 'cat' | 'book' | 'doc'
  catKey?: 'private' | 'team' | 'company'
  bookId?: number
  docId?: number
  book?: BookWithCount
  doc?: DocNode
}

interface KNode extends DataNode {
  key: string
  raw: NodeRaw
  children?: KNode[]
}

interface Props {
  books: Bookshelf
  selectedBookId?: number
  selectedDocId?: number
  /** 点击书籍 → 打开知识库 */
  onOpenBook: (bookId: number) => void
  /** 点击文档 → 打开文档 */
  onOpenDoc: (bookId: number, docId: number) => void
  /** 新建节点（可预选书籍与目录；parentId=父文档 id，0=根目录）。
   *  kind='doc' 新建文档（走类型选择），kind='folder' 新建目录（doc_type=folder）。 */
  onNewDoc: (bookId?: number, parentId?: number, kind?: 'doc' | 'folder') => void
  /** 导入（可预选书籍与目录） */
  onImport: (bookId?: number, parentId?: number) => void
  /** 新建知识库（可选预选分类） */
  onNewBook: (cat?: 'private' | 'team' | 'company') => void
  /** 编辑知识库元信息 */
  onEditBook: (book: BookWithCount) => void
  /** 删除知识库（含确认） */
  onDeleteBook: (book: BookWithCount) => void
  /** 管理公司知识库写权限（仅公司库 + 管理员） */
  onManageWriters: (book: BookWithCount) => void
  /** 当前用户是否为管理员 */
  isAdmin: boolean
  /** 外部触发某知识库文档刷新（导入/新建后）；传 {bookId, nonce} 变化即重载并展开 */
  reloadBookId?: number | null
  reloadNonce?: number
  /** 判断某文档是否可写；未传时以 book.can_write 为准 */
  canWriteDoc?: (bookId: number, doc?: DocNode) => boolean
  /** 右键/菜单：编辑文档（打开编辑页） */
  onEditDoc?: (bookId: number, doc: DocNode) => void
  /** 右键/菜单：复制文档（跨知识库 + 指定目标目录，走弹窗） */
  onDuplicateDoc?: (bookId: number, doc: DocNode) => void
  /** 右键/菜单：移动文档（目标目录 / 目标文档，走弹窗） */
  onMoveDoc?: (bookId: number, doc: DocNode) => void
  /**
   * 拖拽移动完成后的通知（源库 id、被移动的文档、目标库 id）。
   * 由页面决定是否要同步 URL（例如正在看的文档被拖到了别的库）与刷新其它区域。
   */
  onDocMoved?: (srcBookId: number, doc: DocNode, targetBookId: number) => void
  /** 右键/菜单：置顶/取消置顶 */
  onPinDoc?: (bookId: number, doc: DocNode) => void
  /** 右键/菜单：分享 */
  onShareDoc?: (bookId: number, doc: DocNode) => void
  /** 右键/菜单：导出 */
  onExportDoc?: (bookId: number, doc: DocNode) => void
  /** 右键/菜单：邀请协作 */
  onCollaborators?: (bookId: number, doc: DocNode) => void
  /** 当前登录用户 id；用于判定「知识库归属」，配合公司文库的「所有人可编辑」菜单可见性 */
  currentUserId?: number
  /**
   * 右键/菜单：切换公司文库文档的「所有人可编辑」。
   * 仅在公司知识库且当前用户是管理员或该库 owner 时由组件渲染入口。
   */
  onTogglePublicEdit?: (bookId: number, doc: DocNode) => void
}

const CAT_LABEL: Record<'private' | 'team' | 'company', string> = {
  private: '私人知识库',
  team: '团队知识库',
  company: '公司知识库',
}

const CAT_ICON: Record<'private' | 'team' | 'company', ReactNode> = {
  private: <BookOutlined style={{ color: '#2f54eb' }} />,
  team: <BookOutlined style={{ color: '#13c2c2' }} />,
  company: <BookOutlined style={{ color: '#722ed1' }} />,
}

/** 由平铺文档列表构建文档子树（递归） */
function buildDocNodes(bookId: number, childrenMap: Map<number, DocNode[]>, parentId: number): KNode[] {
  const list = childrenMap.get(parentId) || []
  return list.map((d) => {
    const kids = childrenMap.get(d.id) || []
    const hasKids = kids.length > 0
    // 目录（doc_type=folder）始终显示文件夹图标；普通文档只在「有子节点」时才显示成文件夹
    const isFolder = d.doc_type === 'folder'
    const spec = iconForDocType(d.doc_type, d.title)
    return {
      key: `doc:${bookId}:${d.id}`,
      title: d.title || '未命名',
      icon: isFolder || hasKids ? <FolderOutlined style={{ color: '#faad14' }} /> : <span style={{ color: spec.color }}>{spec.icon}</span>,
      // 空目录也保留展开箭头位置一致；无子节点时它仍是叶子（点开只是显示占位）
      isLeaf: !hasKids,
      children: hasKids ? buildDocNodes(bookId, childrenMap, d.id) : undefined,
      raw: { kind: 'doc', bookId, docId: d.id, doc: d },
    }
  })
}

export default function KnowledgeTree(p: Props) {
  const { books, selectedBookId, selectedDocId, isAdmin, reloadBookId, reloadNonce } = p

  const bookMap = useMemo(() => {
    const map = new Map<number, BookWithCount>()
    for (const b of [...books.mine, ...books.teams, ...books.visible]) {
      map.set(b.id, b)
    }
    return map
  }, [books])

  const canWriteFor = useCallback(
    (bookId: number, doc?: DocNode) => {
      if (p.canWriteDoc) return p.canWriteDoc(bookId, doc)
      const book = bookMap.get(bookId)
      return book?.can_write === true
    },
    [bookMap, p.canWriteDoc],
  )

  const [treeData, setTreeData] = useState<KNode[]>([])
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  const [loadedKeys, setLoadedKeys] = useState<React.Key[]>([])
  const [renaming, setRenaming] = useState<{ bookId: number; doc: DocNode } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // 知识库 → 已加载文档平铺列表（缓存，局部刷新用）
  const bookDocsRef = useRef<Map<number, DocNode[]>>(new Map())
  // loadedKeys 的 ref 镜像，供 rebuildTop 读取最新值（避免闭包陈旧）
  const loadedRef = useRef<React.Key[]>([])
  loadedRef.current = loadedKeys

  /** 重建顶层结构（分类 → 知识库 → 已加载的文档子树） */
  const rebuildTop = useCallback(() => {
    const loaded = bookDocsRef.current
    const loadedSet = new Set(loadedRef.current)
    const cat = (key: 'private' | 'team' | 'company', list: BookWithCount[]): KNode => ({
      key: `cat:${key}`,
      title: (
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
          {CAT_LABEL[key]}
          <span style={{ color: '#8a919f', fontWeight: 400, marginLeft: 6 }}>{list.length}</span>
        </span>
      ),
      icon: CAT_ICON[key],
      selectable: false,
      children: list.map((b) => {
        const docs = loaded.get(b.id)
        const isLoaded = loadedSet.has(`book:${b.id}`) && docs !== undefined
        const childrenMap = docs ? buildChildrenMap(docs) : new Map<number, DocNode[]>()
        return {
          key: `book:${b.id}`,
          title: b.name || '未命名知识库',
          icon: <BookOutlined style={{ color: b.cover_color || '#2f54eb' }} />,
          isLeaf: false,
          children: isLoaded ? buildDocNodes(b.id, childrenMap, 0) : undefined,
          raw: { kind: 'book', bookId: b.id, book: b },
        } as KNode
      }),
      raw: { kind: 'cat', catKey: key },
    })
    setTreeData([cat('private', books.mine || []), cat('team', books.teams || []), cat('company', books.visible || [])])
  }, [books])

  useEffect(() => {
    rebuildTop()
  }, [rebuildTop, loadedKeys])

  /** 加载（或重载）某知识库的文档 */
  const loadBookDocs = useCallback(
    async (bookId: number, expand: boolean) => {
      try {
        const docs = await getTree(bookId)
        bookDocsRef.current.set(bookId, docs)
        setLoadedKeys((s) => (s.includes(`book:${bookId}`) ? s : [...s, `book:${bookId}`]))
        if (expand) setExpandedKeys((s) => (s.includes(`book:${bookId}`) ? s : [...s, `book:${bookId}`]))
        rebuildTop()
      } catch {
        message.error('文档目录加载失败')
      }
    },
    [rebuildTop],
  )

  // 外部触发刷新（导入/新建成功后）：重载并展开目标库
  useEffect(() => {
    if (reloadBookId != null && reloadNonce && reloadNonce > 0) {
      void loadBookDocs(reloadBookId, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadNonce])

  const onLoadData = useCallback(
    (node: KNode) => {
      if (node.raw.kind === 'book' && node.raw.bookId != null) {
        return loadBookDocs(node.raw.bookId, false)
      }
      return Promise.resolve()
    },
    [loadBookDocs],
  )

  function handleClick(node: KNode) {
    if (node.raw.kind === 'book' && node.raw.bookId != null) {
      p.onOpenBook(node.raw.bookId)
    } else if (node.raw.kind === 'doc' && node.raw.bookId != null && node.raw.docId != null) {
      p.onOpenDoc(node.raw.bookId, node.raw.docId)
    }
  }

  function bookMenu(book: BookWithCount): ReactNode {
    const items: { key: string; icon: ReactNode; label: ReactNode; onClick: () => void; danger?: boolean }[] = [
      { key: 'new', icon: <FileAddOutlined />, label: '新建文档', onClick: () => p.onNewDoc(book.id, 0, 'doc') },
      { key: 'newFolder', icon: <FolderAddOutlined />, label: '新建目录', onClick: () => p.onNewDoc(book.id, 0, 'folder') },
      { key: 'import', icon: <ImportOutlined />, label: '导入', onClick: () => p.onImport(book.id, 0) },
      { key: 'edit', icon: <EditOutlined />, label: '设置', onClick: () => p.onEditBook(book) },
    ]
    if (book.is_company_kb && isAdmin) {
      items.push({ key: 'writers', icon: <SafetyCertificateOutlined />, label: '管理写权限', onClick: () => p.onManageWriters(book) })
    }
    items.push({
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除知识库',
      danger: true,
      onClick: () => p.onDeleteBook(book),
    })
    return (
      <Dropdown
        menu={{
          items: items.map((it) => ({ key: it.key, icon: it.icon, label: it.label, danger: it.danger, onClick: it.onClick })),
        }}
        trigger={['click']}
      >
        <MoreOutlined onClick={(e) => e.stopPropagation()} style={{ color: '#8a919f', padding: '0 4px', cursor: 'pointer' }} />
      </Dropdown>
    )
  }

  function docMenu(node: KNode) {
    const bookId = node.raw.bookId!
    const doc = node.raw.doc!
    const canWrite = canWriteFor(bookId, doc)
    // 目录（folder）不承载正文：不能编辑、导出、分享。复制与移动现在是支持的
    // ——复制会递归带上子文档（后端 /docs/:id/copy），移动只改 parent_id。
    const isFolder = doc.doc_type === 'folder'

    // 语雀式 hover「⋮」菜单：与右键 contextMenu 共用同一组 handlers（顺序/禁用按语雀清单）
    const treeMenuHandlers: TreeMenuHandlers = {
      onRename: () => beginRename(bookId, doc),
      onEdit: () => p.onEditDoc?.(bookId, doc),
      onCopyLink: () => {
        const link = internalLink(bookId, doc.id)
        void navigator.clipboard?.writeText(link)
        message.success('链接已复制')
      },
      onOpenInNewTab: () => window.open(internalLink(bookId, doc.id), '_blank'),
      onMoveOut: () => {
        void moveDoc(doc.id, { parent_id: 0 })
          .then(() => {
            message.success('已移出目录')
            return loadBookDocs(bookId, true)
          })
          .catch(() => undefined)
      },
      onDuplicate: () => p.onDuplicateDoc?.(bookId, doc),
      onMove: () => p.onMoveDoc?.(bookId, doc),
      onExport: () => p.onExportDoc?.(bookId, doc),
      onPin: () => p.onPinDoc?.(bookId, doc),
      onDelete: () => confirmDeleteDoc(bookId, doc),
    }
    const treeMenuCtx = { node: doc, bookId, canWrite, handlers: treeMenuHandlers }
    // 「+」快速新建：文档/表格/画板/思维导图/流程图/新建分组（folder 走 onNewDoc 的 folder 分支）
    const onPlusCreate = (dt: import('../../types').DocType) =>
      dt === 'folder' ? p.onNewDoc(bookId, doc.id, 'folder') : p.onNewDoc(bookId, doc.id, 'doc')

    const items: any[] = [
      { key: 'open', icon: <FolderOpenOutlined />, label: '打开', onClick: () => p.onOpenDoc(bookId, doc.id) },
    ]
    if (p.onEditDoc) {
      items.push({
        key: 'edit',
        icon: <FileTextOutlined />,
        label: '编辑文档',
        disabled: !canWrite || doc.doc_type === 'file' || isFolder,
        onClick: () => p.onEditDoc!(bookId, doc),
      })
    }
    items.push(
      { key: 'newChild', icon: <FileAddOutlined />, label: '新建子文档', disabled: !canWrite, onClick: () => p.onNewDoc(bookId, doc.id, 'doc') },
      { key: 'newChildFolder', icon: <FolderAddOutlined />, label: '新建子目录', disabled: !canWrite, onClick: () => p.onNewDoc(bookId, doc.id, 'folder') },
      { key: 'rename', icon: <EditOutlined />, label: '重命名', disabled: !canWrite, onClick: () => beginRename(bookId, doc) },
    )
    if (p.onDuplicateDoc) {
      // 复制现在会**递归复制整棵子树**（后端 POST /docs/:id/copy），因此目录也可复制
      items.push({ key: 'duplicate', icon: <CopyOutlined />, label: '复制', disabled: !canWrite, onClick: () => p.onDuplicateDoc!(bookId, doc) })
    }
    if (p.onMoveDoc) {
      items.push({ key: 'move', icon: <FolderOpenOutlined />, label: '移动', disabled: !canWrite, onClick: () => p.onMoveDoc!(bookId, doc) })
    }
    if (p.onExportDoc && !isFolder) {
      items.push({ key: 'export', icon: <DownloadOutlined />, label: '导出', onClick: () => p.onExportDoc!(bookId, doc) })
    }
    if (p.onShareDoc && !isFolder) {
      items.push({ key: 'share', icon: <ShareAltOutlined />, label: '分享', onClick: () => p.onShareDoc!(bookId, doc) })
    }
    if (p.onCollaborators) {
      items.push({ key: 'collab', icon: <UserAddOutlined />, label: '邀请协作', disabled: !canWrite, onClick: () => p.onCollaborators!(bookId, doc) })
    }
    if (p.onPinDoc) {
      items.push({
        key: 'pin',
        icon: <PushpinFilled style={{ color: doc.pinned_at ? '#fa8c16' : undefined }} />,
        label: doc.pinned_at ? '取消置顶' : '置顶',
        disabled: !canWrite,
        onClick: () => p.onPinDoc!(bookId, doc),
      })
    }
    if (p.onTogglePublicEdit && !isFolder) {
      // 公司文库专属：管理员 / 库 owner 可以把单篇文档开放给全员编辑（收集建议、意见、bug）
      const bk = bookMap.get(bookId)
      const manageable = bk?.is_company_kb === true && (isAdmin || (p.currentUserId != null && bk.owner_id === p.currentUserId))
      if (manageable) {
        items.push({
          key: 'publicEdit',
          icon: <TeamOutlined style={{ color: doc.public_edit ? '#722ed1' : undefined }} />,
          label: doc.public_edit ? '取消「所有人可编辑」' : '设为「所有人可编辑」',
          onClick: () => p.onTogglePublicEdit!(bookId, doc),
        })
      }
    }
    items.push({ type: 'divider' as const }, {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除（进回收站）',
      danger: true,
      disabled: !canWrite,
      onClick: () => confirmDeleteDoc(bookId, doc),
    })
    return (
      <Dropdown menu={{ items }} trigger={['contextMenu']}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, width: '100%' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.title as ReactNode}</span>
          {doc.public_edit && (
            <Tooltip title="公司文库：全员可编辑，用于提建议 / 意见 / bug">
              <TeamOutlined style={{ color: '#722ed1', flexShrink: 0 }} />
            </Tooltip>
          )}
          {/* 语雀式 hover 操作区：⋮（更多操作）与 +（快速新建），默认隐藏，行 hover 出现 */}
          <span className="hk-tree-actions" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            <Dropdown menu={{ items: buildTreeMenuItems(treeMenuCtx) }} trigger={['click']} placement="bottomRight">
              <span
                role="button"
                aria-label="更多操作"
                className="hk-tree-action-btn"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreOutlined style={{ fontSize: 13 }} />
              </span>
            </Dropdown>
            {canWrite && (
              <Dropdown menu={{ items: buildPlusMenuItems(doc, onPlusCreate) }} trigger={['click']} placement="bottomRight">
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
        </span>
      </Dropdown>
    )
  }

  function beginRename(bookId: number, doc: DocNode) {
    setRenaming({ bookId, doc })
    setRenameValue(doc.title)
  }

  async function submitRename() {
    if (!renaming) return
    const title = renameValue.trim()
    if (!title) {
      setRenaming(null)
      return
    }
    try {
      await patchDoc(renaming.doc.id, { title })
      const docs = bookDocsRef.current.get(renaming.bookId)
      if (docs) {
        bookDocsRef.current.set(
          renaming.bookId,
          docs.map((d) => (d.id === renaming.doc.id ? { ...d, title } : d)),
        )
        rebuildTop()
      }
      setRenaming(null)
    } catch {
      /* 拦截器已提示 */
    }
  }

  function confirmDeleteDoc(bookId: number, doc: DocNode) {
    Modal.confirm({
      title: `删除「${doc.title}」？`,
      content: '文档及其子文档将移入回收站，可随时恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteDoc(doc.id)
          message.success('已移入回收站')
          const docs = bookDocsRef.current.get(bookId)
          if (docs) {
            bookDocsRef.current.set(bookId, docs.filter((d) => d.id !== doc.id))
            rebuildTop()
          }
        } catch {
          /* 拦截器已提示 */
        }
      },
    })
  }

  const selectedKeys = useMemo(() => {
    if (selectedDocId != null && selectedBookId != null) return [`doc:${selectedBookId}:${selectedDocId}`]
    if (selectedBookId != null) return [`book:${selectedBookId}`]
    return []
  }, [selectedBookId, selectedDocId])

  // ---------- 拖拽移动 ----------

  /**
   * 拖拽过程中允许/禁止落点。
   *
   * 「分类」节点（私人 / 团队 / 公司知识库）只是分组标题，不能作为容器 ——
   * 落上去只会让人以为能放进去。知识库与文档节点都允许。
   */
  const allowDrop: TreeProps['allowDrop'] = ({ dropNode }) => {
    return (dropNode as unknown as KNode).raw.kind !== 'cat'
  }

  /** 哪些节点可以被拖动：有写权限的文档/目录。知识库与分类不可拖。 */
  const nodeDraggable = (node: DataNode) => {
    const n = node as unknown as KNode
    if (n.raw.kind !== 'doc') return false
    return canWriteFor(n.raw.bookId!, n.raw.doc)
  }

  /**
   * 拖拽落点 → 移动请求。
   *
   * 落点语义（rc-tree 的 onDrop 契约）：
   *   · `dropToGap === false`（悬停在节点中部）→ 成为该节点的**子节点**；
   *   · `dropToGap === true`（悬停在节点上下缝隙）→ 插入到该节点**前/后**（同级排序）。
   *   rc-tree 回传的 `dropPosition` 是**整棵扁平树的绝对索引**，需要减去落点节点在
   *   其兄弟中的下标才能还原出「前 / 内 / 后」三态（见 dropToGap 的三态换算）。
   *
   * 跨知识库：落到另一个库的库节点或该库的任意文档上，走 move-to-book（带 parent_id）。
   */
  const handleDrop: TreeProps['onDrop'] = async (info) => {
    const drag = info.dragNode as unknown as KNode
    const over = info.node as unknown as KNode
    if (!drag || !over) return
    if (drag.raw.kind !== 'doc') {
      message.info('只有文档或目录可以拖动')
      return
    }
    if (over.raw.kind === 'cat') {
      message.info('请拖到知识库或目录上')
      return
    }
    const srcBookId = drag.raw.bookId!
    const srcDoc = drag.raw.doc!
    if (!canWriteFor(srcBookId, srcDoc)) {
      message.warning('没有编辑权限，无法移动')
      return
    }

    // 三态换算：rc-tree 给的是扁平绝对索引，减去落点在其兄弟中的下标
    const overPos = String((info.node as unknown as { pos?: string }).pos ?? '')
    const siblingIdx = Number(overPos.split('-').pop())
    const rel = info.dropToGap && Number.isFinite(siblingIdx) ? info.dropPosition - siblingIdx : 0

    let targetBookId: number
    let targetParentId = 0
    let prevPos: string | undefined
    let nextPos: string | undefined

    if (over.raw.kind === 'book') {
      // 落到知识库节点：进该库根目录（缝隙落点对「库的排序」无意义，一律按追加处理）
      targetBookId = over.raw.bookId!
    } else {
      const overDoc = over.raw.doc!
      targetBookId = over.raw.bookId!
      if (rel === 0) {
        targetParentId = overDoc.id
      } else {
        targetParentId = overDoc.parent_id
        const sibs = (buildChildrenMap(bookDocsRef.current.get(targetBookId) || []).get(targetParentId) || []).filter(
          (d) => d.id !== srcDoc.id,
        )
        const i = sibs.findIndex((d) => d.id === overDoc.id)
        if (rel < 0) {
          prevPos = i > 0 ? sibs[i - 1].pos : undefined
          nextPos = overDoc.pos
        } else {
          prevPos = overDoc.pos
          nextPos = i >= 0 && i + 1 < sibs.length ? sibs[i + 1].pos : undefined
        }
      }
    }

    if (!canWriteFor(targetBookId)) {
      message.warning('目标知识库没有编辑权限')
      return
    }
    // 防环 + 原地不动：都在前端先拦一道（后端同样校验）
    if (targetBookId === srcBookId) {
      const flat = bookDocsRef.current.get(srcBookId) || []
      if (isDescendantOf(flat, srcDoc.id, targetParentId)) {
        message.warning('不能移动到自身或其子孙节点下')
        return
      }
      if (targetParentId === srcDoc.parent_id && prevPos === srcDoc.pos && !nextPos) {
        return // 落回原位，什么都不做
      }
    }

    try {
      if (targetBookId === srcBookId) {
        await moveDoc(srcDoc.id, { parent_id: targetParentId, prev_pos: prevPos, next_pos: nextPos })
      } else {
        await moveDocToBook(srcDoc.id, targetBookId, targetParentId)
      }
      message.success('已移动')
      // 源库必刷（节点消失）；跨库时目标库也刷，并展开它让用户看到结果
      const jobs = [loadBookDocs(srcBookId, false)]
      if (targetBookId !== srcBookId) jobs.push(loadBookDocs(targetBookId, true))
      await Promise.all(jobs)
      p.onDocMoved?.(srcBookId, srcDoc, targetBookId)
    } catch {
      /* 拦截器已提示 */
    }
  }

  function titleRender(node: KNode): ReactNode {
    if (node.raw.kind === 'cat') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, whiteSpace: 'nowrap' }}>
          {node.title as ReactNode}
          {node.raw.catKey === 'private' && (
            <PlusOutlined
              title="新建知识库"
              style={{ fontSize: 12, color: '#8a919f', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation()
                p.onNewBook('private')
              }}
            />
          )}
        </span>
      )
    }
    if (node.raw.kind === 'book') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.title as ReactNode}</span>
          {bookMenu(node.raw.book!)}
        </span>
      )
    }
    // doc
    if (renaming && renaming.doc.id === node.raw.docId) {
      return (
        <Input
          size="small"
          autoFocus
          value={renameValue}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => void submitRename()}
          onPressEnter={() => void submitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRenaming(null)
          }}
          style={{ width: '80%' }}
        />
      )
    }
    return docMenu(node)
  }

  return (
    <div style={{ padding: '4px 8px' }}>
      {treeData.every((c) => (c.children || []).length === 0) && (
        <Empty description="还没有知识库，点击右上角新建" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 40 }} />
      )}
      <Tree<KNode>
        blockNode
        showIcon
        showLine={{ showLeafIcon: false }}
        className="hk-knowledge-tree"
        treeData={treeData}
        expandedKeys={expandedKeys}
        selectedKeys={selectedKeys}
        loadedKeys={loadedKeys}
        loadData={(n) => onLoadData(n as KNode)}
        onExpand={(keys) => setExpandedKeys(keys)}
        onSelect={(keys, info) => {
          if (keys.length > 0) handleClick(info.node as unknown as KNode)
        }}
        titleRender={(n) => titleRender(n as KNode)}
        // 拖拽移动：只有可写文档能拖；落到知识库节点 = 进该库根目录，
        // 落到文档中部 = 成为其子文档，落到上下缝隙 = 同级前/后插入。
        draggable={{ icon: false, nodeDraggable }}
        allowDrop={allowDrop}
        onDrop={handleDrop}
      />
    </div>
  )
}
