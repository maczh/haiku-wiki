import { Card, Empty, Skeleton, Tag, Tooltip } from 'antd'
import { HistoryOutlined, FileAddOutlined } from '@ant-design/icons'
import { iconForDocType } from '../../lib/fileIcon'
import { relativeTime } from '../../lib/dashboard'
import { DOC_TYPE_LABEL, type RecentDocItem } from '../../types'

interface Props {
  items: RecentDocItem[]
  loading: boolean
  /** 点击某条 → 打开该文档（阅读态） */
  onOpen: (item: RecentDocItem) => void
  /** 列表为空时的引导动作 */
  onCreateDoc: () => void
  extra?: React.ReactNode
}

/**
 * 首页「最近更新」：跨知识库展示最近改动的文档。
 *
 * 数据侧的权限过滤完全在服务端（GET /api/recent-docs），前端不做二次筛选 ——
 * 拿到什么展示什么，因此这里不会出现「点了却打不开」的条目。
 */
export default function RecentDocsCard({ items, loading, onOpen, onCreateDoc, extra }: Props) {
  return (
    <Card
      size="small"
      data-testid="hk-recent-docs"
      title={
        <span style={{ fontSize: 14 }}>
          <HistoryOutlined style={{ marginRight: 6, color: '#2f54eb' }} />
          最近更新
          {items.length > 0 && (
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#8a919f' }}>{items.length} 篇</span>
          )}
        </span>
      }
      extra={extra}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} title={false} />
      ) : items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ fontSize: 13, color: '#8a919f' }}>
              还没有可展示的文档
              <br />
              新建或导入一篇文档后，这里会显示最近的改动
            </span>
          }
        >
          <a onClick={onCreateDoc}>
            <FileAddOutlined /> 新建第一篇文档
          </a>
        </Empty>
      ) : (
        <div>
          {items.map((it) => {
            const spec = iconForDocType(it.doc_type, it.title)
            return (
              <div
                key={it.id}
                className="hk-dash-recent-item"
                role="button"
                tabIndex={0}
                title={`${it.title}　·　${it.book_name}`}
                data-doc-id={it.id}
                onClick={() => onOpen(it)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(it)
                }}
              >
                <span style={{ fontSize: 16, color: spec.color, flex: 'none' }}>{spec.icon}</span>
                <div className="hk-dash-recent-main">
                  <div className="hk-dash-recent-title">{it.title || '未命名文档'}</div>
                  <div className="hk-dash-recent-meta">
                    <Tooltip title="所属知识库">{<span>{it.book_name || '未知知识库'}</span>}</Tooltip>
                    <Tag
                      bordered={false}
                      style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', background: '#f2f4f8', color: '#5f6672' }}
                    >
                      {DOC_TYPE_LABEL[it.doc_type] ?? '文档'}
                    </Tag>
                    {!it.can_write && (
                      <span style={{ color: '#b6bcc8', fontSize: 11 }}>只读</span>
                    )}
                  </div>
                </div>
                <span className="hk-dash-recent-time">{relativeTime(it.updated_at)}</span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
