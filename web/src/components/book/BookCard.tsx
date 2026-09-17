import { Button, Card, Tag } from 'antd'
import { BookOutlined, TeamOutlined, GlobalOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { BookWithCount } from '../../types'
import { VISIBILITY_LABEL } from '../../types'

const visibilityIcon = {
  private: <LockOutlined />,
  members: <TeamOutlined />,
  public: <GlobalOutlined />,
}

/** 书架卡片：高仿语雀 —— 封面色块 + 书名 + 文档数 + 可见性角标 */
export default function BookCard({ book, mine }: { book: BookWithCount; mine: boolean }) {
  const navigate = useNavigate()
  return (
    <Card
      hoverable
      style={{ borderRadius: 10, overflow: 'hidden' }}
      styles={{ body: { padding: 12 } }}
      onClick={() => navigate(`/books/${book.id}`)}
    >
      {/* 封面：纯背景色块 + 书名 */}
      <div
        style={{
          height: 120,
          borderRadius: 8,
          background: book.cover_color || '#2f54eb',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          gap: 6,
          marginBottom: 10,
        }}
      >
        <BookOutlined style={{ fontSize: 26, opacity: 0.9 }} />
        <div style={{ fontSize: 16, fontWeight: 600, maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {book.name}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {book.name}
        </span>
        <Tag icon={visibilityIcon[book.visibility]} style={{ marginRight: 0 }}>
          {VISIBILITY_LABEL[book.visibility]}
        </Tag>
      </div>
      <div style={{ color: '#8a919f', fontSize: 12, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>{book.doc_count ?? 0} 篇文档</span>
        <span>{mine ? '我创建的' : '来自他人'}</span>
      </div>
    </Card>
  )
}
