import { useEffect, useState, lazy } from 'react'
import { Drawer, List, Tag, Typography, Button, Empty, Modal, message } from 'antd'
import { RollbackOutlined } from '@ant-design/icons'
import { listVersions, getVersion, rollbackVersion } from '../../api/docs'
import type { VersionMeta, DocType } from '../../types'
import LazyBoundary from '../common/LazyBoundary'
import dayjs from '../../lib/dayjs'

// ⚠️ 必须懒加载：本组件被 4 个编辑器（Vditor/Sheet/Mindmap/Flowchart）静态引用，
// 若此处静态 import MarkdownView，会把整个 Vditor（~304KB JS + ~40KB CSS）带进
// 每一个编辑页，即使 docType 不是 markdown、即使从不打开版本历史。
const MarkdownView = lazy(() => import('../reader/MarkdownView'))

interface Props {
  open: boolean
  docId: number
  title: string
  /** 快照内容类型：非 markdown 用 <pre> 展示原始 JSON/源码，不进 Markdown 渲染管线（XSS 边界） */
  docType?: DocType
  onClose: () => void
  onRolledBack: () => void
}

const sourceLabel: Record<string, string> = {
  auto: '自动保存',
  manual: '手动保存',
  rollback: '回滚快照',
}

/** 历史版本抽屉：快照列表（最多 20 版）/ 预览 / 回滚 */
export default function VersionDrawer({ open, docId, title, docType = 'markdown', onClose, onRolledBack }: Props) {
  const [items, setItems] = useState<VersionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<{ meta: VersionMeta; content: string } | null>(null)
  const [rolling, setRolling] = useState<number | null>(null)

  useEffect(() => {
    if (open && docId) {
      setLoading(true)
      listVersions(docId)
        .then(setItems)
        .catch(() => setItems([]))
        .finally(() => setLoading(false))
    }
  }, [open, docId])

  async function handlePreview(v: VersionMeta) {
    const detail = await getVersion(docId, v.id)
    setPreview({ meta: v, content: detail.content })
  }

  function handleRollback(v: VersionMeta) {
    Modal.confirm({
      title: '回滚到此版本？',
      content: '当前内容会先保存为一条「回滚快照」，可随时再次恢复。',
      okText: '回滚',
      cancelText: '取消',
      onOk: async () => {
        setRolling(v.id)
        try {
          await rollbackVersion(docId, v.id)
          message.success('已回滚')
          onClose()
          onRolledBack()
        } finally {
          setRolling(null)
        }
      },
    })
  }

  return (
    <Drawer title={`历史版本 · ${title}`} width={420} open={open} onClose={onClose}>
      <List
        loading={loading}
        dataSource={items}
        locale={{ emptyText: <Empty description="暂无版本快照" /> }}
        renderItem={(v) => (
          <List.Item
            actions={[
              <Button key="preview" type="link" size="small" onClick={() => void handlePreview(v)}>
                预览
              </Button>,
              <Button
                key="rollback"
                type="link"
                size="small"
                icon={<RollbackOutlined />}
                loading={rolling === v.id}
                onClick={() => handleRollback(v)}
              >
                回滚
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={
                <span>
                  {dayjs(v.created_at).format('MM-DD HH:mm:ss')}{' '}
                  <Tag color={v.source === 'manual' ? 'blue' : v.source === 'rollback' ? 'orange' : 'default'}>
                    {sourceLabel[v.source] ?? v.source}
                  </Tag>
                </span>
              }
              description={<Typography.Text type="secondary">{v.size} 字</Typography.Text>}
            />
          </List.Item>
        )}
      />

      <Modal
        title={`版本预览 · ${preview ? dayjs(preview.meta.created_at).format('YYYY-MM-DD HH:mm:ss') : ''}`}
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={null}
        width={780}
      >
        {preview && (
          <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
            {docType === 'markdown' ? (
              <LazyBoundary tip="正在加载版本预览…">
                <MarkdownView content={preview.content} />
              </LazyBoundary>
            ) : (
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.7 }}>
                {preview.content || '（空内容）'}
              </pre>
            )}
          </div>
        )}
      </Modal>
    </Drawer>
  )
}
