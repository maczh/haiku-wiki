import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Modal, Popconfirm, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { ReloadOutlined, SafetyCertificateOutlined, SafetyOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { listUsers, resetUserPassword, setUserStatus } from '../api/admin'
import { listBooks } from '../api/books'
import CompanyKBWritersModal from '../components/admin/CompanyKBWritersModal'
import { useAuthStore } from '../stores/authStore'
import type { AdminUser } from '../types'

/**
 * 用户管理（仅管理员可见，路由 /admin/users）。
 *
 * 后端约束（UserService 为单一事实来源，界面只做前置提示、不重复判定）：
 *   - 不能禁用/启用自己；
 *   - 不能禁用管理员账号；
 *   - 重置密码不能针对自己；未填新密码时由后端生成 12 位随机密码并一次性返回明文。
 */
export default function AdminUsersPage() {
  const me = useAuthStore((s) => s.user)
  const [rows, setRows] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')

  // 重置密码弹窗
  const [resetUser, setResetUser] = useState<AdminUser | null>(null)
  const [resetPwd, setResetPwd] = useState('')
  const [resetting, setResetting] = useState(false)

  // 公司知识库写权限管理弹窗
  const [kbBookId, setKbBookId] = useState<number | null>(null)
  const [kbOpen, setKbOpen] = useState(false)

  async function openKbWriters() {
    try {
      const shelf = await listBooks()
      const kb = [...shelf.mine, ...shelf.visible, ...shelf.teams].find((b) => b.is_company_kb)
      if (!kb) {
        message.info('尚未创建公司知识库')
        return
      }
      setKbBookId(kb.id)
      setKbOpen(true)
    } catch {
      /* 拦截器已提示 */
    }
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listUsers(page, pageSize)
      setRows(res.users || [])
      setTotal(res.total || 0)
    } catch {
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function toggleStatus(row: AdminUser, checked: boolean) {
    const status = checked ? 1 : 0
    try {
      const updated = await setUserStatus(row.id, status)
      setRows((list) => list.map((r) => (r.id === updated.id ? updated : r)))
      message.success(updated.status === 1 ? '已启用该账号' : '已禁用该账号')
    } catch {
      // 失败（自分身 / 管理员账号）：刷新回真实状态，避免 Switch 停留在错误位置
      void refresh()
    }
  }

  async function submitReset() {
    if (!resetUser) return
    setResetting(true)
    try {
      const res = await resetUserPassword(resetUser.id, resetPwd.trim() || undefined)
      setResetUser(null)
      setResetPwd('')
      Modal.success({
        title: '密码已重置',
        width: 460,
        content: (
          <div>
            <div style={{ marginBottom: 8 }}>
              用户「{resetUser.username}」的新密码（仅显示一次，请复制后告知对方）：
            </div>
            <Input.Password value={res.password} readOnly autoFocus />
          </div>
        ),
        okText: '知道了',
      })
    } finally {
      setResetting(false)
    }
  }

  const columns: ColumnsType<AdminUser> = [
    {
      title: '用户名',
      dataIndex: 'username',
      width: 140,
      render: (v: string, r) => (
        <Space size={4}>
          <span style={{ fontWeight: 600 }}>{v}</span>
          {me && r.id === me.id && <Tag color="blue">我</Tag>}
        </Space>
      ),
    },
    { title: '姓名', dataIndex: 'name', width: 110, render: (v: string) => v || '—' },
    { title: '邮箱', dataIndex: 'email', width: 200 },
    { title: '部门', dataIndex: 'department', width: 120, render: (v: string) => v || '—' },
    { title: '手机号', dataIndex: 'phone', width: 130, render: (v: string) => v || '—' },
    {
      title: '角色',
      dataIndex: 'role',
      width: 90,
      render: (v: string) => (v === 'admin' ? <Tag color="gold">管理员</Tag> : <Tag>普通用户</Tag>),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (status: number, r) => {
        const self = !!me && r.id === me.id
        const isAdmin = r.role === 'admin'
        const disabled = self || isAdmin
        return (
          <Switch
            size="small"
            checked={status === 1}
            disabled={disabled}
            checkedChildren="启用"
            unCheckedChildren="禁用"
            onClick={(checked) => void toggleStatus(r, checked)}
            title={self ? '不能禁用自己' : isAdmin ? '不能禁用管理员账号' : undefined}
          />
        )
      },
    },
    {
      title: '操作',
      key: 'op',
      width: 180,
      render: (_, r) => {
        const self = !!me && r.id === me.id
        return (
          <Popconfirm
            title={`重置「${r.username}」的密码？`}
            description="重置后原密码立即失效。"
            okText="重置"
            cancelText="取消"
            disabled={self}
            onConfirm={() => {
              setResetPwd('')
              setResetUser(r)
            }}
          >
            <Button size="small" disabled={self} title={self ? '不能重置自己的密码' : undefined}>
              重置密码
            </Button>
          </Popconfirm>
        )
      },
    },
  ]

  const filtered = keyword.trim()
    ? rows.filter((r) =>
        [r.username, r.name, r.email, r.phone, r.department]
          .filter(Boolean)
          .some((f) => String(f).includes(keyword.trim())),
      )
    : rows

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <SafetyCertificateOutlined /> 用户管理
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Input.Search
          placeholder="按用户名 / 姓名 / 邮箱 / 手机号过滤"
          allowClear
          style={{ width: 280 }}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Button icon={<SafetyOutlined />} onClick={() => void openKbWriters()}>
          公司知识库写权限
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
          刷新
        </Button>
      </div>

      <Card size="small">
        <Table<AdminUser>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 位用户`,
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps)
            },
          }}
        />
      </Card>

      <Modal
        title={resetUser ? `重置「${resetUser.username}」的密码` : '重置密码'}
        open={!!resetUser}
        onOk={() => void submitReset()}
        onCancel={() => {
          setResetUser(null)
          setResetPwd('')
        }}
        confirmLoading={resetting}
        okText="确认重置"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 8, color: '#5f6672' }}>
          留空则由系统自动生成 12 位随机密码；重置后仅在此处显示一次。
        </div>
        <Input.Password
          value={resetPwd}
          autoFocus
          placeholder="新密码（至少 6 位，留空自动生成）"
          onChange={(e) => setResetPwd(e.target.value)}
        />
      </Modal>

      <CompanyKBWritersModal
        open={kbOpen}
        onClose={() => setKbOpen(false)}
        bookId={kbBookId ?? 0}
        bookName="公司知识库"
      />
    </div>
  )
}
