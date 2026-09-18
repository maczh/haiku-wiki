import { Button, Card, Tag } from 'antd'
import { ApartmentOutlined, BookOutlined, LockOutlined, TeamOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { BookWithCount } from '../../types'
import { VISIBILITY_LABEL } from '../../types'

/** 书架卡片：高仿语雀 —— 封面色块 + 书名 + 文档数 + 可见性角标 */
export default function BookCard({ book, mine }: { book: BookWithCount; mine: boolean }) {
  const navigate = useNavigate()
  const source = book.team_id != null
    ? { icon: <TeamOutlined />, label: '团队', color: 'blue' }
    : mine
      ? { icon: <LockOutlined />, label: book.visibility === 'private' ? '私有' : VISIBILITY_LABEL[book.visibility], color: undefined }
      : { icon: <ApartmentOutlined />, label: '公司', color: 'green' }
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
        <Tag icon={source.icon} color={source.color} style={{ marginRight: 0 }}>
          {source.label}
        </Tag>
      </div>
      <div style={{ color: '#8a919f', fontSize: 12, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>{book.doc_count ?? 0} 篇文档</span>
        <span>{book.team_id != null ? '团队成员共享' : mine ? '我创建的' : '公司共享'}</span>
      </div>
    </Card>
  )
}
