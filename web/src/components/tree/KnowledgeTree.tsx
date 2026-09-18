import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tree, Dropdown, Empty, Modal, Input, message } from 'antd'
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
  FolderOpenOutlined,
  ImportOutlined,
  MoreOutlined,
  PlusOutlined,
  PushpinFilled,
  SafetyCertificateOutlined,
  ShareAltOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import type { BookWithCount, Bookshelf, DocNode } from '../../types'
import { getTree, deleteDoc, patchDoc } from '../../api/docs'
import { buildChildrenMap } from '../../stores/docTreeStore'
import { iconForDocType } from '../../lib/fileIcon'
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
  /** 新建文档（可预选书籍与目录；目录=父文档 id，0=根目录） */
  onNewDoc: (bookId?: number, parentId?: number) => void
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
  /** 右键/菜单：复制文档 */
  onDuplicateDoc?: (bookId: number, doc: DocNode) => void
  /** 右键/菜单：移动到其他知识库 */
  onMoveDoc?: (bookId: number, doc: DocNode) => void
  /** 右键/菜单：置顶/取消置顶 */
  onPinDoc?: (bookId: number, doc: DocNode) => void
  /** 右键/菜单：分享 */
  onShareDoc?: (bookId: number, doc: DocNode) => void
  /** 右键/菜单：导出 */
  onExportDoc?: (bookId: number, doc: DocNode) => void
  /** 右键/菜单：邀请协作 */
  onCollaborators?: (bookId: number, doc: DocNode) => void
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
    const spec = iconForDocType(d.doc_type, d.title)
    return {
      key: `doc:${bookId}:${d.id}`,
      title: d.title || '未命名',
      icon: hasKids ? <FolderOutlined style={{ color: '#faad14' }} /> : <span style={{ color: spec.color }}>{spec.icon}</span>,
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
      { key: 'new', icon: <FileAddOutlined />, label: '新建文档', onClick: () => p.onNewDoc(book.id, 0) },
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
    const items: any[] = [
      { key: 'open', icon: <FolderOpenOutlined />, label: '打开', onClick: () => p.onOpenDoc(bookId, doc.id) },
    ]
    if (p.onEditDoc) {
      items.push({
        key: 'edit',
        icon: <FileTextOutlined />,
        label: '编辑文档',
        disabled: !canWrite || doc.doc_type === 'file',
        onClick: () => p.onEditDoc!(bookId, doc),
      })
    }
    items.push(
      { key: 'newChild', icon: <FileAddOutlined />, label: '新建子文档', disabled: !canWrite, onClick: () => p.onNewDoc(bookId, doc.id) },
      { key: 'rename', icon: <EditOutlined />, label: '重命名', disabled: !canWrite, onClick: () => beginRename(bookId, doc) },
    )
    if (p.onDuplicateDoc) {
      items.push({ key: 'duplicate', icon: <CopyOutlined />, label: '复制', disabled: !canWrite, onClick: () => p.onDuplicateDoc!(bookId, doc) })
    }
    if (p.onMoveDoc) {
      items.push({ key: 'move', icon: <FolderOpenOutlined />, label: '移动到其他知识库', disabled: !canWrite, onClick: () => p.onMoveDoc!(bookId, doc) })
    }
    if (p.onExportDoc) {
      items.push({ key: 'export', icon: <DownloadOutlined />, label: '导出', onClick: () => p.onExportDoc!(bookId, doc) })
    }
    if (p.onShareDoc) {
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
      />
    </div>
  )
}
