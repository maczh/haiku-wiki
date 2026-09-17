import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Empty, List, Modal, Spin, Tag, Typography, message } from 'antd'
import { DeleteOutlined, FileTextOutlined, RestOutlined, UndoOutlined } from '@ant-design/icons'
import { listTrash } from '../api/trash'
import { purgeDoc, restoreDoc } from '../api/docs'
import type { TrashItem } from '../types'

/** 回收站（P1）：软删文档列表，支持恢复 / 彻底删除 */
export default function TrashPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    try {
      setItems(await listTrash())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  function handleRestore(item: TrashItem) {
    return async () => {
      await restoreDoc(item.doc_id)
      message.success(`「${item.title}」已恢复`)
      await refresh()
    }
  }

  function handlePurge(item: TrashItem) {
    Modal.confirm({
      title: `彻底删除「${item.title}」？`,
      content: '文档、其子文档及全部版本快照将被永久删除，不可恢复。',
      okText: '彻底删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await purgeDoc(item.doc_id)
        message.success('已彻底删除')
        await refresh()
      },
    })
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <RestOutlined style={{ fontSize: 20, color: '#2f54eb' }} />
          <h2 style={{ margin: 0, fontSize: 20 }}>回收站</h2>
          <Typography.Text type="secondary">软删文档保留在此，可恢复或彻底删除</Typography.Text>
          <div style={{ flex: 1 }} />
          <Button onClick={() => navigate('/')}>返回书架</Button>
        </div>

        {loading && <Spin style={{ display: 'block', margin: '80px auto' }} />}

        {!loading && items.length === 0 && <Empty description="回收站是空的" style={{ marginTop: 80 }} />}

        {!loading && items.length > 0 && (
          <List
            dataSource={items}
            renderItem={(item) => (
              <List.Item
                style={{ background: '#fff', borderRadius: 8, padding: '12px 20px', marginBottom: 8, border: '1px solid #f0f2f5' }}
                actions={[
                  <Button key="restore" type="link" size="small" icon={<UndoOutlined />} onClick={() => void handleRestore(item)()}>
                    恢复
                  </Button>,
                  <Button key="purge" type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handlePurge(item)}>
                    彻底删除
                  </Button>,
                ]}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FileTextOutlined style={{ color: '#8a919f' }} />
                  <span style={{ fontWeight: 500 }}>{item.title}</span>
                  <Tag>{item.book_name}</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    删除于 {item.deleted_at ? new Date(item.deleted_at).toLocaleString('zh-CN') : '-'}
                  </Typography.Text>
                </div>
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  )
}
