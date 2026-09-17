import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Empty, Input, List, Spin, Typography } from 'antd'
import { FileTextOutlined, SearchOutlined } from '@ant-design/icons'
import { search } from '../api/search'
import Highlight from '../components/common/Highlight'
import type { SearchHit } from '../types'

/** 搜索结果页：标题 + 上下文片段，关键词高亮 */
export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const q = searchParams.get('q') || ''
  const [input, setInput] = useState(q)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setInput(q)
    if (!q) {
      setHits([])
      return
    }
    setLoading(true)
    search(q)
      .then(setHits)
      .catch(() => setHits([]))
      .finally(() => setLoading(false))
  }, [q])

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <Input
          size="large"
          allowClear
          prefix={<SearchOutlined style={{ color: '#bbb' }} />}
          placeholder="搜索标题与正文…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={() => setSearchParams(input.trim() ? { q: input.trim() } : {})}
          style={{ marginBottom: 24 }}
        />

        {loading && <Spin style={{ display: 'block', margin: '80px auto' }} />}

        {!loading && q && hits.length === 0 && <Empty description={`未找到与「${q}」相关的内容`} />}

        {!loading && hits.length > 0 && (
          <>
            <Typography.Text type="secondary">
              找到 {hits.length} 条与「{q}」相关的内容（仅包含你有权访问的知识库）
            </Typography.Text>
            <List
              style={{ marginTop: 12 }}
              itemLayout="vertical"
              dataSource={hits}
              renderItem={(h) => (
                <List.Item
                  style={{ cursor: 'pointer', background: '#fff', borderRadius: 8, padding: '16px 20px', marginBottom: 8, border: '1px solid #f0f2f5' }}
                  onClick={() => navigate(`/books/${h.book_id}?docId=${h.doc_id}&tab=read`)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileTextOutlined style={{ color: '#2f54eb' }} />
                    <span style={{ fontWeight: 600, fontSize: 15 }}>
                      <Highlight text={h.title} keyword={q} />
                    </span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {h.book_name} · {new Date(h.updated_at).toLocaleDateString('zh-CN')}
                    </Typography.Text>
                  </div>
                  <div style={{ color: '#5f6672', marginTop: 6, fontSize: 13, lineHeight: 1.7 }}>
                    {/* 非 markdown 类型（sheet/mindmap 等）仅搜标题，snippet 为空 → 结构化文档提示 */}
                    {h.snippet ? <Highlight text={h.snippet} keyword={q} /> : '结构化文档，无文本摘要'}
                  </div>
                </List.Item>
              )}
            />
          </>
        )}
      </div>
    </div>
  )
}
