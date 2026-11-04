import { Card, Empty, Space, Tag, Typography } from 'antd'
import { FileTextOutlined, FolderOutlined } from '@ant-design/icons'
import type { DocNode } from '../../types'
import { DOC_TYPE_LABEL } from '../../types'
import { iconForDocType } from '../../lib/fileIcon'

interface Props {
  folder: DocNode
  docs: DocNode[]
  onOpenDoc: (id: number) => void
}

/** 目录的快捷预览：用摘要卡片展示当前目录的直接子文档和子目录。 */
export default function FolderPreview({ folder, docs, onOpenDoc }: Props) {
  const children = docs
    .filter((doc) => doc.parent_id === folder.id)
    .sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0))

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '40px 28px' }}>
      <Typography.Title level={2} style={{ marginTop: 0, marginBottom: 8 }}>
        {folder.title}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        目录快捷预览 · {children.length} 项
      </Typography.Paragraph>
      {children.length === 0 ? (
        <Empty description="此目录暂无文档或子目录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {children.map((child) => {
            const isFolder = child.doc_type === 'folder'
            const spec = iconForDocType(child.doc_type, child.title)
            return (
              <Card
                key={child.id}
                hoverable
                size="small"
                onClick={() => onOpenDoc(child.id)}
                style={{ minHeight: 118 }}
              >
                <Space align="start" size={12} style={{ width: '100%' }}>
                  <span style={{ fontSize: 25, color: isFolder ? '#faad14' : spec.color }}>
                    {isFolder ? <FolderOutlined /> : <FileTextOutlined />}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <Typography.Text strong ellipsis={{ tooltip: child.title }} style={{ display: 'block', maxWidth: 170 }}>
                      {child.title || '未命名'}
                    </Typography.Text>
                    <Tag style={{ marginTop: 12 }}>{isFolder ? '子目录' : (DOC_TYPE_LABEL[child.doc_type] ?? child.doc_type)}</Tag>
                    <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                      更新于 {new Date(child.updated_at).toLocaleDateString('zh-CN')}
                    </Typography.Text>
                  </span>
                </Space>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
