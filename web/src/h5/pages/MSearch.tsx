import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Input, List, Spin } from 'antd'
import { FileTextOutlined, SearchOutlined } from '@ant-design/icons'
import { search } from '../../api/search'
import { iconForDocType } from '../../lib/fileIcon'
import Highlight from '../../components/common/Highlight'
import type { DocType, SearchHit } from '../../types'

/**
 * H5 搜索页：复用桌面版 SearchPage 的搜索 API（GET /api/search）。
 *
 * 移动端输入框 + 结果列表，关键词高亮；点击结果 → /m/doc/:id。
 */
export default function MSearch() {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!q) {
      setHits([])
      return
    }
    let alive = true
    setLoading(true)
    search(q)
      .then((res) => {
        if (alive) setHits(res)
      })
      .catch(() => {
        if (alive) setHits([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [q])

  return (
    <div style={{ padding: 12 }}>
      <Input
        size="large"
        allowClear
        prefix={<SearchOutlined style={{ color: '#bbb' }} />}
        placeholder="搜索标题与正文…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onPressEnter={() => setQ(input.trim())}
        onBlur={() => setQ(input.trim())}
        style={{ marginBottom: 16 }}
      />

      {loading && <Spin style={{ display: 'block', margin: '60px auto' }} />}

      {!loading && q && hits.length === 0 && <Empty description={`未找到与「${q}」相关的内容`} style={{ marginTop: 40 }} />}

      {!loading && hits.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: '#8a919f', marginBottom: 8 }}>
            找到 {hits.length} 条与「{q}」相关的内容
          </div>
          <List
            style={{ background: '#fff', borderRadius: 10, overflow: 'hidden' }}
            dataSource={hits}
            renderItem={(h) => {
              const spec = iconForDocType((h.doc_type as DocType) ?? 'markdown')
              return (
                <List.Item
                  role="button"
                  onClick={() => navigate(`/m/doc/${h.doc_id}`)}
                  style={{ cursor: 'pointer', padding: '12px 14px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                    <span style={{ color: spec.color, fontSize: 16 }}>{spec.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1f2329' }}>
                        <Highlight text={h.title} keyword={q} />
                      </div>
                      <div style={{ fontSize: 12, color: '#8a919f', marginTop: 2 }}>
                        {h.book_name} · {new Date(h.updated_at).toLocaleDateString('zh-CN')}
                      </div>
                      <div style={{ fontSize: 13, color: '#5f6672', marginTop: 4, lineHeight: 1.6 }}>
                        {h.snippet ? <Highlight text={h.snippet} keyword={q} /> : '结构化文档，无文本摘要'}
                      </div>
                    </div>
                    <FileTextOutlined style={{ color: '#c3c8d4', fontSize: 12, flexShrink: 0 }} />
                  </div>
                </List.Item>
              )
            }}
          />
        </>
      )}
    </div>
  )
}
