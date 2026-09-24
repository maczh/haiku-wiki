import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, List, Spin, Tag } from 'antd'
import { BookOutlined, FileTextOutlined } from '@ant-design/icons'
import { listBooks } from '../../api/books'
import { listRecentDocs } from '../../api/recent'
import { iconForDocType } from '../../lib/fileIcon'
import type { Bookshelf, RecentDocItem } from '../../types'

/**
 * H5 首页：复用桌面版「我的文库 + 最近文档」的数据获取逻辑。
 *
 *   · 文库列表：GET /api/books（Bookshelf，含 mine / teams / visible）
 *   · 最近文档：GET /api/recent-docs
 *
 * 点击文库 → /m/books/:bookId；点击文档 → /m/doc/:id。
 */
export default function MHome() {
  const navigate = useNavigate()
  const [shelf, setShelf] = useState<Bookshelf | null>(null)
  const [recent, setRecent] = useState<RecentDocItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([listBooks().catch(() => null), listRecentDocs(10).catch(() => [])])
      .then(([s, r]) => {
        if (!alive) return
        if (s) setShelf(s)
        setRecent(r as RecentDocItem[])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  if (loading && !shelf) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />
  }

  const books = shelf ? [...shelf.mine, ...shelf.teams] : []

  return (
    <div style={{ padding: 12 }}>
      {/* ---------- 我的文库 ---------- */}
      <SectionTitle>我的文库</SectionTitle>
      {books.length === 0 ? (
        <Empty description="还没有知识库" style={{ margin: '24px 0' }} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 12,
          }}
        >
          {books.map((b) => (
            <div
              key={b.id}
              role="button"
              onClick={() => navigate(`/m/books/${b.id}`)}
              style={{
                background: '#fff',
                borderRadius: 10,
                padding: 14,
                border: '1px solid #f0f2f5',
                borderLeft: `4px solid ${b.cover_color || '#2f54eb'}`,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <BookOutlined style={{ color: b.cover_color || '#2f54eb' }} />
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: '#1f2329',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {b.name}
                </span>
              </div>
              <Tag bordered={false} style={{ background: '#eef2ff', color: '#2f54eb', fontSize: 11 }}>
                {b.doc_count} 篇文档
              </Tag>
            </div>
          ))}
        </div>
      )}

      {/* ---------- 最近文档 ---------- */}
      <SectionTitle>最近文档</SectionTitle>
      {recent.length === 0 ? (
        <Empty description="暂无最近更新的文档" style={{ margin: '24px 0' }} />
      ) : (
        <List
          style={{ background: '#fff', borderRadius: 10, overflow: 'hidden' }}
          dataSource={recent}
          renderItem={(item) => {
            const spec = iconForDocType(item.doc_type)
            return (
              <List.Item
                role="button"
                onClick={() => navigate(`/m/doc/${item.id}`)}
                style={{ cursor: 'pointer', padding: '12px 14px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                  <span style={{ color: spec.color, fontSize: 16 }}>{spec.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        color: '#1f2329',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.title || '未命名'}
                    </div>
                    <div style={{ fontSize: 12, color: '#8a919f', marginTop: 2 }}>
                      {item.book_name} · {new Date(item.updated_at).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                  <FileTextOutlined style={{ color: '#c3c8d4', fontSize: 12 }} />
                </div>
              </List.Item>
            )
          }}
        />
      )}
    </div>
  )
}

/** 区块标题 */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: '#5f6672', margin: '18px 4px 10px' }}>{children}</div>
  )
}
