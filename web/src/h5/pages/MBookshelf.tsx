import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Empty, List, Spin, message } from 'antd'
import { FolderOutlined, PartitionOutlined, UploadOutlined } from '@ant-design/icons'
import { getBook, listBooks } from '../../api/books'
import { getTree } from '../../api/docs'
import { buildChildrenMap } from '../../lib/docTree'
import { iconForDocType } from '../../lib/fileIcon'
import type { Book, Bookshelf, DocNode } from '../../types'
import { useH5Layout } from '../MobileLayout'
import DocTreeDrawer from '../DocTreeDrawer'
import MobileImportSheet from '../components/MobileImportSheet'

/**
 * H5 文库页。
 *
 *   · 无 :bookId → 展示知识库列表，点击进入某文库（/m/books/:bookId）
 *   · 有 :bookId → 展示该文库文档树（按 parent_id 组树），点击文档 → /m/doc/:id
 *   · 顶部「文档树」按钮滑出 DocTreeDrawer（复用桌面版 KnowledgeTree）
 */
export default function MBookshelf() {
  const navigate = useNavigate()
  const { bookId } = useParams()
  const { setHeader } = useH5Layout()

  const [shelf, setShelf] = useState<Bookshelf | null>(null)
  const [book, setBook] = useState<Book | null>(null)
  const [nodes, setNodes] = useState<DocNode[]>([])
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // 导入目标文库：优先当前文库；文库列表页则取第一个「我的/团队」文库
  const importBookId = useMemo(() => {
    if (bookId) return Number(bookId)
    const books = shelf ? [...shelf.mine, ...shelf.teams] : []
    return books.length > 0 ? books[0].id : 0
  }, [bookId, shelf])

  // 无 bookId：拉取文库列表
  useEffect(() => {
    if (bookId) return
    listBooks()
      .then(setShelf)
      .catch(() => setShelf({ mine: [], visible: [], teams: [] }))
  }, [bookId])

  // 有 bookId：拉库信息 + 文档树
  useEffect(() => {
    if (!bookId) return
    const id = Number(bookId)
    let alive = true
    setLoading(true)
    Promise.all([getBook(id).catch(() => null), getTree(id).catch(() => [])])
      .then(([b, tree]) => {
        if (!alive) return
        if (b) setBook(b)
        setNodes(tree as DocNode[])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [bookId])

  // 顶栏：文库名 + 「文档树」按钮
  useEffect(() => {
    if (!bookId) return
    setHeader({
      title: book?.name || '文库',
      right: (
        <Button
          size="small"
          icon={<PartitionOutlined />}
          onClick={() => setDrawerOpen(true)}
        >
          文档树
        </Button>
      ),
    })
  }, [bookId, book?.name, setHeader])

  // ⚠️ Hooks 必须无条件、按固定顺序调用：childrenMap / roots 提前到早退 return 之前计算，
  // 否则从 /m/books 切到 /m/books/:bookId（同一组件实例）时 hook 数量变化，
  // React 会抛「Rendered more hooks than during the previous render」。
  const childrenMap = useMemo(() => buildChildrenMap(nodes), [nodes])
  const roots = useMemo(() => childrenMap.get(0) || [], [childrenMap])

  if (!bookId) {
    const books = shelf ? [...shelf.mine, ...shelf.teams] : []
    if (!shelf) return <Spin style={{ display: 'block', margin: '80px auto' }} />
    return (
      <div style={{ padding: 12 }}>
        {books.length === 0 ? (
          <Empty description="还没有知识库" style={{ marginTop: 40 }} />
        ) : (
          <List
            style={{ background: '#fff', borderRadius: 10, overflow: 'hidden' }}
            dataSource={books}
            renderItem={(b) => (
              <List.Item
                role="button"
                onClick={() => navigate(`/m/books/${b.id}`)}
                style={{ cursor: 'pointer', padding: '14px 16px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                  <BookDot color={b.cover_color} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#1f2329' }}>{b.name}</div>
                    <div style={{ fontSize: 12, color: '#8a919f', marginTop: 2 }}>{b.doc_count} 篇文档</div>
                  </div>
                </div>
              </List.Item>
            )}
          />
        )}
        {importBookId > 0 && (
          <button
            type="button"
            aria-label="导入文件"
            onClick={() => setImportOpen(true)}
            style={{
              position: 'fixed',
              right: 16,
              bottom: 76,
              zIndex: 50,
              width: 52,
              height: 52,
              borderRadius: '50%',
              border: 'none',
              background: '#2f54eb',
              color: '#fff',
              boxShadow: '0 6px 16px rgba(47,84,235,0.4)',
              fontSize: 22,
              cursor: 'pointer',
            }}
          >
            <UploadOutlined />
          </button>
        )}
        <MobileImportSheet
          open={importOpen}
          onClose={() => setImportOpen(false)}
          bookId={importBookId}
          onImported={() => {
            if (bookId) getTree(Number(bookId)).then(setNodes).catch(() => {})
          }}
        />
      </div>
    )
  }

  // 有 bookId：组树并渲染（childrenMap / roots 见上方 Hooks 区）
  if (loading && nodes.length === 0 && !book) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />
  }

  return (
    <div style={{ padding: '8px 12px 16px' }}>
      {roots.length === 0 ? (
        <Empty description="该文库还没有文档" style={{ marginTop: 60 }} />
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden' }}>
          <DocTreeList nodes={roots} depth={0} childrenMap={childrenMap} onOpenDoc={(id) => navigate(`/m/doc/${id}`)} />
        </div>
      )}

      <DocTreeDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <button
        type="button"
        aria-label="导入文件"
        onClick={() => setImportOpen(true)}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 76,
          zIndex: 50,
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: 'none',
          background: '#2f54eb',
          color: '#fff',
          boxShadow: '0 6px 16px rgba(47,84,235,0.4)',
          fontSize: 22,
          cursor: 'pointer',
        }}
      >
        <UploadOutlined />
      </button>
      <MobileImportSheet
        open={importOpen}
        onClose={() => setImportOpen(false)}
        bookId={importBookId}
        onImported={() => {
          if (bookId) getTree(Number(bookId)).then(setNodes).catch(() => {})
        }}
      />
    </div>
  )
}

/** 文库色点 */
function BookDot({ color }: { color?: string }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color || '#2f54eb',
        flexShrink: 0,
      }}
    />
  )
}

interface TreeListProps {
  nodes: DocNode[]
  depth: number
  childrenMap: Map<number, DocNode[]>
  onOpenDoc: (docId: number) => void
}

/** 递归渲染文档树（目录可展开/收起） */
function DocTreeList({ nodes, depth, childrenMap, onOpenDoc }: TreeListProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return (
    <>
      {nodes.map((n) => {
        const isFolder = n.doc_type === 'folder'
        const kids = childrenMap.get(n.id) || []
        const isOpen = expanded.has(n.id)
        const spec = iconForDocType(n.doc_type)
        return (
          <Fragment key={n.id}>
            <div
              role="button"
              onClick={() => (isFolder ? toggle(n.id) : onOpenDoc(n.id))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 14px',
                paddingLeft: 14 + depth * 16,
                borderBottom: '1px solid #f5f6f8',
                cursor: 'pointer',
              }}
            >
              {isFolder ? (
                <FolderOutlined style={{ color: '#faad14', fontSize: 15, flexShrink: 0 }} />
              ) : (
                <span style={{ color: spec.color, fontSize: 15, flexShrink: 0 }}>{spec.icon}</span>
              )}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 14,
                  color: '#1f2329',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {n.title || '未命名'}
              </span>
              {isFolder && kids.length > 0 && (
                <span style={{ fontSize: 12, color: '#8a919f', flexShrink: 0 }}>{isOpen ? '收起' : `${kids.length}`}</span>
              )}
            </div>
            {isFolder && isOpen && kids.length > 0 && (
              <DocTreeList nodes={kids} depth={depth + 1} childrenMap={childrenMap} onOpenDoc={onOpenDoc} />
            )}
          </Fragment>
        )
      })}
    </>
  )
}
