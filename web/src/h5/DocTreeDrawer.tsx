import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Drawer } from 'antd'
import KnowledgeTree from '../components/tree/KnowledgeTree'
import { listBooks } from '../api/books'
import { useAuthStore } from '../stores/authStore'
import type { Bookshelf } from '../types'

interface Props {
  /** 是否打开抽屉 */
  open: boolean
  /** 关闭抽屉（遮罩点击 / 关闭按钮） */
  onClose: () => void
}

/**
 * H5 文档树抽屉（左侧滑出）。
 *
 * 复用桌面版 KnowledgeTree（保持其完整能力：展开文库、点击文档打开、拖拽移动等），
 * 仅把「打开知识库 / 打开文档」重定向到手机版路由，并把新建/导入/删除等写操作置为 no-op
 * （手机版以阅读/编辑为主，不提供知识库管理入口）。
 */
export default function DocTreeDrawer({ open, onClose }: Props) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [shelf, setShelf] = useState<Bookshelf | null>(null)

  useEffect(() => {
    if (!open) return
    listBooks()
      .then(setShelf)
      .catch(() => setShelf({ mine: [], visible: [], teams: [] }))
  }, [open])

  const noop = () => {}

  return (
    <Drawer
      title="文档树"
      placement="left"
      width="80%"
      open={open}
      onClose={onClose}
      styles={{ body: { padding: 0 } }}
    >
      {shelf && (
        <KnowledgeTree
          books={shelf}
          isAdmin={user?.role === 'admin'}
          onOpenBook={(id) => {
            navigate(`/m/books/${id}`)
            onClose()
          }}
          onOpenDoc={(_bookId, docId) => {
            navigate(`/m/doc/${docId}`)
            onClose()
          }}
          onNewDoc={noop}
          onImport={noop}
          onNewBook={noop}
          onEditBook={noop}
          onDeleteBook={noop}
          onManageWriters={noop}
        />
      )}
    </Drawer>
  )
}
