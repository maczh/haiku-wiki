import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { ReloadOutlined, SafetyCertificateOutlined, SafetyOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  deleteUser,
  listUsers,
  listDeletedUsers,
  purgeUser,
  resetUserPassword,
  restoreUser,
  setUserStatus,
} from '../api/admin'
import { listBooks } from '../api/books'
import CompanyKBWritersModal from '../components/admin/CompanyKBWritersModal'
import UserLibraryModal from '../components/admin/UserLibraryModal'
import { useAuthStore } from '../stores/authStore'
import type { AdminUser } from '../types'

/**
 * 用户管理（仅管理员可见，路由 /admin/users）。
 *
 * 后端约束（UserService 为单一事实来源，界面只做前置提示、不重复判定）：
 *   - 不能禁用/启用自己；
 *   - 不能禁用管理员账号；
 *   - 重置密码不能针对自己；
 *   - 删除（软删）/ 彻底删除不能针对自己或管理员账号。
 */
export default function AdminUsersPage() {
  const me = useAuthStore((s) => s.user)
  const [rows, setRows] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')

  // 已删除用户视图
  const [showDeleted, setShowDeleted] = useState(false)
  const [deletedRows, setDeletedRows] = useState<AdminUser[]>([])
  const [deletedTotal, setDeletedTotal] = useState(0)
  const [deletedPage, setDeletedPage] = useState(1)
  const [deletedPageSize, setDeletedPageSize] = useState(20)
  const [deletedLoading, setDeletedLoading] = useState(false)

  // 重置密码弹窗
  const [resetUser, setResetUser] = useState<AdminUser | null>(null)
  const [resetPwd, setResetPwd] = useState('')
  const [resetting, setResetting] = useState(false)

  // 公司知识库写权限管理弹窗
  const [kbBookId, setKbBookId] = useState<number | null>(null)
  const [kbOpen, setKbOpen] = useState(false)

  // 用户文库管理弹窗
  const [libUserId, setLibUserId] = useState<number | null>(null)
  const [libUsername, setLibUsername] = useState('')
  const [libOpen, setLibOpen] = useState(false)

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

  const refreshActive = useCallback(async () => {
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

  const refreshDeleted = useCallback(async () => {
    setDeletedLoading(true)
    try {
      const res = await listDeletedUsers(deletedPage, deletedPageSize)
      setDeletedRows(res.users || [])
      setDeletedTotal(res.total || 0)
    } catch {
      setDeletedRows([])
      setDeletedTotal(0)
    } finally {
      setDeletedLoading(false)
    }
  }, [deletedPage, deletedPageSize])

  useEffect(() => {
    if (showDeleted) void refreshDeleted()
    else void refreshActive()
  }, [showDeleted, refreshActive, refreshDeleted])

  async function toggleStatus(row: AdminUser, checked: boolean) {
    const status = checked ? 1 : 0
    try {
      const updated = await setUserStatus(row.id, status)
      setRows((list) => list.map((r) => (r.id === updated.id ? updated : r)))
      message.success(updated.status === 1 ? '已启用该账号' : '已禁用该账号')
    } catch {
      void refreshActive()
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

  async function handleDelete(row: AdminUser) {
    try {
      await deleteUser(row.id)
      message.success('已删除该用户（可在「已删除用户」中恢复）')
      void refreshActive()
    } catch {
      /* 拦截器已提示 */
    }
  }

  async function handleRestore(row: AdminUser) {
    try {
      await restoreUser(row.id)
      message.success('已恢复该用户')
      void refreshDeleted()
    } catch {
      /* 拦截器已提示 */
    }
  }

  async function handlePurge(row: AdminUser) {
    try {
      await purgeUser(row.id)
      message.success('已彻底删除该用户')
      void refreshDeleted()
    } catch {
      /* 拦截器已提示 */
    }
  }

  function openLibrary(row: AdminUser) {
    setLibUserId(row.id)
    setLibUsername(row.username)
    setLibOpen(true)
  }

  const activeColumns: ColumnsType<AdminUser> = [
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
      width: 240,
      render: (_, r) => {
        const self = !!me && r.id === me.id
        return (
          <Space size={4}>
            <Button size="small" onClick={() => openLibrary(r)}>
              文库管理
            </Button>
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
            <Popconfirm
              title={`删除用户「${r.username}」？`}
              description="删除后该用户进入已删除列表，可恢复。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              disabled={self || r.role === 'admin'}
              onConfirm={() => void handleDelete(r)}
            >
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={self || r.role === 'admin'}
                title={self ? '不能删除自己' : r.role === 'admin' ? '不能删除管理员账号' : undefined}
              >
                删除
              </Button>
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  const deletedColumns: ColumnsType<AdminUser> = [
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
    {
      title: '角色',
      dataIndex: 'role',
      width: 90,
      render: (v: string) => (v === 'admin' ? <Tag color="gold">管理员</Tag> : <Tag>普通用户</Tag>),
    },
    {
      title: '操作',
      key: 'op',
      width: 180,
      render: (_, r) => {
        const self = !!me && r.id === me.id
        const isAdmin = r.role === 'admin'
        return (
          <Space size={4}>
            <Button size="small" onClick={() => void handleRestore(r)} disabled={isAdmin}>
              恢复
            </Button>
            <Popconfirm
              title={`彻底删除「${r.username}」？`}
              description="将永久删除，不可恢复。"
              okText="彻底删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              disabled={self || isAdmin}
              onConfirm={() => void handlePurge(r)}
            >
              <Button size="small" danger disabled={self || isAdmin}>
                彻底删除
              </Button>
            </Popconfirm>
          </Space>
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
        <Switch
          checkedChildren="已删除用户"
          unCheckedChildren="已删除用户"
          checked={showDeleted}
          onChange={(v) => {
            setShowDeleted(v)
            if (v) {
              setDeletedPage(1)
            } else {
              setPage(1)
            }
          }}
        />
        {!showDeleted && (
          <>
            <Input.Search
              placeholder="按用户名 / 姓名 / 邮箱 / 手机号过滤"
              allowClear
              style={{ width: 280 }}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Button icon={<SafetyOutlined />} onClick={() => void openKbWriters()}>
              公司知识库写权限
            </Button>
          </>
        )}
        <Button icon={<ReloadOutlined />} onClick={() => (showDeleted ? void refreshDeleted() : void refreshActive())}>
          刷新
        </Button>
      </div>

      {showDeleted ? (
        <Card size="small">
          <Table<AdminUser>
            rowKey="id"
            size="middle"
            loading={deletedLoading}
            columns={deletedColumns}
            dataSource={deletedRows}
            pagination={{
              current: deletedPage,
              pageSize: deletedPageSize,
              total: deletedTotal,
              showSizeChanger: true,
              showTotal: (t) => `共 ${t} 位已删除用户`,
              onChange: (p, ps) => {
                setDeletedPage(p)
                setDeletedPageSize(ps)
              },
            }}
          />
        </Card>
      ) : (
        <Card size="small">
          <Table<AdminUser>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={activeColumns}
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
      )}

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

      <UserLibraryModal
        open={libOpen}
        onClose={() => setLibOpen(false)}
        userId={libUserId ?? 0}
        username={libUsername}
      />
    </div>
  )
}
