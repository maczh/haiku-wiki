import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Input, List, Modal, Popconfirm, Space, Spin, Tag, Typography, message } from 'antd'
import { DeleteOutlined, UserAddOutlined } from '@ant-design/icons'
import { addCollaborator, listCollaborators, removeCollaborator } from '../../api/docs'
import type { DocCollaborator } from '../../types'

interface Props {
  open: boolean
  /** 被邀请协作的文档 id */
  docId: number | null
  docTitle: string
  onClose: () => void
}

/**
 * 文档协作邀请（个人库文档）。
 *
 * 被邀请者获得该文档「等价 owner」的编辑权限（不受知识库可见性约束），
 * 因此入口只对有编辑权限的用户有意义——后端 CollaboratorService 会二次校验，
 * 无权限者调用会收到 403，界面不做重复判定。
 */
export default function CollaboratorModal({ open, docId, docTitle, onClose }: Props) {
  const [list, setList] = useState<DocCollaborator[]>([])
  const [loading, setLoading] = useState(false)
  const [identifier, setIdentifier] = useState('')
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(async () => {
    if (!docId) return
    setLoading(true)
    try {
      const rows = await listCollaborators(docId)
      setList(rows || [])
    } catch {
      setList([])
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => {
    if (open && docId) void refresh()
    if (!open) {
      setList([])
      setIdentifier('')
    }
  }, [open, docId, refresh])

  async function submitAdd() {
    if (!docId) return
    const kw = identifier.trim()
    if (!kw) {
      message.warning('请输入用户名 / 手机号 / 姓名 / 邮箱')
      return
    }
    setAdding(true)
    try {
      await addCollaborator(docId, kw)
      setIdentifier('')
      message.success('已邀请为协作者')
      await refresh()
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(c: DocCollaborator) {
    if (!docId) return
    try {
      await removeCollaborator(docId, c.user_id)
      message.success('已移除协作者')
      await refresh()
    } catch {
      /* 拦截器已提示 */
    }
  }

  return (
    <Modal
      title={`邀请协作 · ${docTitle || ''}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={520}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="协作者对该文档拥有与你相同的编辑权限，可阅读并修改正文。"
      />

      <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<UserAddOutlined />}
          placeholder="用户名 / 手机号 / 姓名 / 邮箱"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          onPressEnter={() => void submitAdd()}
        />
        <Button type="primary" loading={adding} onClick={() => void submitAdd()}>
          邀请
        </Button>
      </Space.Compact>

      {loading && <Spin style={{ display: 'block', margin: '24px auto' }} />}

      {!loading && list.length === 0 && (
        <Typography.Text type="secondary">还没有协作者，输入用户名 / 手机号 / 姓名搜索并邀请。</Typography.Text>
      )}

      {!loading && list.length > 0 && (
        <List
          size="small"
          dataSource={list}
          renderItem={(c) => (
            <List.Item
              actions={[
                <Popconfirm
                  key="rm"
                  title="移除该协作者？"
                  description="移除后对方将失去该文档的访问权限。"
                  okText="移除"
                  okType="danger"
                  cancelText="取消"
                  onConfirm={() => void handleRemove(c)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space size={6}>
                    <span>{c.name || c.username || `用户 #${c.user_id}`}</span>
                    {c.username && <Tag>@{c.username}</Tag>}
                  </Space>
                }
                description={
                  <span style={{ color: '#8a919f', fontSize: 12 }}>
                    {[c.email, c.phone].filter(Boolean).join(' · ') || `用户 ID ${c.user_id}`}
                  </span>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Modal>
  )
}
