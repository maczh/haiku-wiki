import { useCallback, useEffect, useState } from 'react'
import { Button, List, Modal, Select, Space, Tag, message } from 'antd'
import { DeleteOutlined, SafetyOutlined, UserAddOutlined } from '@ant-design/icons'
import { addBookWriter, listBookWriters, removeBookWriter } from '../../api/admin'
import { listUsers } from '../../api/admin'
import type { AdminUser, BookWriterView } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  /** 公司知识库 ID */
  bookId: number
  bookName?: string
}

/**
 * 公司知识库写权限管理（仅管理员）。
 * 公司知识库对所有登录成员只读；管理员在此授予 / 撤销特定成员的写权限，
 * 管理员自身恒可写（无需在授权表中出现）。授权结果写入 book_writers 表。
 */
export default function CompanyKBWritersModal({ open, onClose, bookId, bookName }: Props) {
  const [writers, setWriters] = useState<BookWriterView[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(false)
  const [addUid, setAddUid] = useState<number | null>(null)
  const [granting, setGranting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ws, ul] = await Promise.all([listBookWriters(bookId), listUsers(1, 500)])
      setWriters(ws)
      setUsers(ul.users || [])
    } catch {
      /* 拦截器已提示 */
    } finally {
      setLoading(false)
    }
  }, [bookId])

  useEffect(() => {
    if (open) {
      setAddUid(null)
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookId])

  const writerIds = new Set(writers.map((w) => w.user_id))
  const candidates = users.filter((u) => u.role !== 'admin' && !writerIds.has(u.id))

  async function handleGrant() {
    if (!addUid) return
    setGranting(true)
    try {
      await addBookWriter(bookId, addUid)
      message.success('已授予写权限')
      setAddUid(null)
      await load()
    } catch {
      /* 拦截器已提示 */
    } finally {
      setGranting(false)
    }
  }

  async function handleRevoke(uid: number) {
    try {
      await removeBookWriter(bookId, uid)
      message.success('已撤销写权限')
      await load()
    } catch {
      /* 拦截器已提示 */
    }
  }

  return (
    <Modal
      title={
        <span>
          <SafetyOutlined /> 公司知识库写权限
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnClose
    >
      <p style={{ color: '#5f6672', fontSize: 13, marginTop: 0 }}>
        公司知识库「{bookName || '公司知识库'}」对所有成员<strong>只读</strong>；管理员恒可写，
        也可在此为普通成员<strong>授予 / 撤销写权限</strong>。
      </p>

      <List
        size="small"
        loading={loading}
        dataSource={writers}
        locale={{ emptyText: '暂无被授权的普通成员' }}
        renderItem={(w) => (
          <List.Item
            actions={[
              <Button
                key="revoke"
                size="small"
                danger
                type="text"
                icon={<DeleteOutlined />}
                onClick={() => void handleRevoke(w.user_id)}
              >
                撤销
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={
                <Space size={6}>
                  <span>{w.name || w.username}</span>
                  {w.username !== (w.name || '') && <Tag>{w.username}</Tag>}
                </Space>
              }
              description={[w.email, w.nickname].filter(Boolean).join(' · ') || undefined}
            />
          </List.Item>
        )}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <Select
          style={{ flex: 1 }}
          placeholder="选择要授权的成员"
          value={addUid ?? undefined}
          showSearch
          optionFilterProp="label"
          options={candidates.map((u) => ({
            value: u.id,
            label: `${u.name || u.username}（${u.username}）`,
          }))}
          onChange={(v) => setAddUid(v)}
        />
        <Button
          type="primary"
          icon={<UserAddOutlined />}
          disabled={!addUid}
          loading={granting}
          onClick={() => void handleGrant()}
        >
          授予写权限
        </Button>
      </div>
    </Modal>
  )
}
