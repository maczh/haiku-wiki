import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ArrowLeftOutlined,
  BookOutlined,
  CrownOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
} from '@ant-design/icons'
import {
  addTeamMember,
  createTeamLibrary,
  deleteTeam,
  getTeam,
  listTeamLibraries,
  listTeamMembers,
  removeTeamMember,
  setTeamMemberRole,
  updateTeam,
} from '../api/teams'
import { useAuthStore } from '../stores/authStore'
import type { Book, Team, TeamMemberView } from '../types'

/**
 * 团队详情（/teams/:id）：团队信息编辑 + 成员管理 + 团队文库。
 *
 * 权限（后端 TeamService 判定，界面按 my_role 隐藏不可用入口）：
 *   - 创建者 = 团队 admin，不可被移除、不可降权、角色不可更改；
 *   - 仅团队 admin 可改团队信息 / 增删成员 / 改成员角色 / 新建文库 / 删除团队；
 *   - 成员任意角色都能看到并进入团队文库（后端对团队文库放开读写）。
 */
export default function TeamDetailPage() {
  const { teamId } = useParams()
  const teamID = Number(teamId)
  const navigate = useNavigate()
  const me = useAuthStore((s) => s.user)

  const [team, setTeam] = useState<Team | null>(null)
  const [myRole, setMyRole] = useState<'admin' | 'member'>('member')
  const [members, setMembers] = useState<TeamMemberView[]>([])
  const [libs, setLibs] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // 添加成员
  const [identifier, setIdentifier] = useState('')
  const [addRole, setAddRole] = useState<'admin' | 'member'>('member')
  const [adding, setAdding] = useState(false)

  // 编辑团队 / 删除
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [saving, setSaving] = useState(false)

  // 新建团队文库
  const [libOpen, setLibOpen] = useState(false)
  const [libName, setLibName] = useState('')
  const [libSaving, setLibSaving] = useState(false)

  const isAdmin = myRole === 'admin'

  const refreshMembers = useCallback(async () => {
    try {
      const list = await listTeamMembers(teamID)
      setMembers(list || [])
    } catch {
      setMembers([])
    }
  }, [teamID])

  const refreshLibs = useCallback(async () => {
    try {
      const list = await listTeamLibraries(teamID)
      setLibs(list || [])
    } catch {
      setLibs([])
    }
  }, [teamID])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTeam(teamID)
      setTeam(res.team)
      setMyRole(res.my_role)
      await Promise.all([refreshMembers(), refreshLibs()])
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [teamID, refreshMembers, refreshLibs])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function submitAddMember() {
    const kw = identifier.trim()
    if (!kw) {
      message.warning('请输入用户名 / 手机号 / 姓名 / 邮箱')
      return
    }
    setAdding(true)
    try {
      await addTeamMember(teamID, { identifier: kw, role: addRole })
      setIdentifier('')
      setAddRole('member')
      message.success('已加入团队')
      await refreshMembers()
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(m: TeamMemberView) {
    try {
      await removeTeamMember(teamID, m.user_id)
      message.success('已移出团队')
      await refreshMembers()
    } catch {
      /* 拦截器已提示（创建者不可移除 / 至少保留一名管理员） */
    }
  }

  async function handleRole(m: TeamMemberView, role: 'admin' | 'member') {
    try {
      await setTeamMemberRole(teamID, m.user_id, role)
      message.success(role === 'admin' ? '已设为团队管理员' : '已降级为普通成员')
      await refreshMembers()
    } catch {
      /* 拦截器已提示 */
    }
  }

  async function submitEdit() {
    const name = editName.trim()
    if (!name) {
      message.warning('团队名称不能为空')
      return
    }
    setSaving(true)
    try {
      const t = await updateTeam(teamID, { name, description: editDesc.trim() })
      setTeam(t)
      setEditOpen(false)
      message.success('已保存')
    } finally {
      setSaving(false)
    }
  }

  async function submitDelete() {
    setSaving(true)
    try {
      await deleteTeam(teamID)
      message.success('团队已删除')
      navigate('/teams', { replace: true })
    } finally {
      setSaving(false)
    }
  }

  async function submitCreateLib() {
    setLibSaving(true)
    try {
      const b = await createTeamLibrary(teamID, libName.trim() || undefined)
      setLibOpen(false)
      setLibName('')
      message.success(`团队文库「${b.name}」已创建`)
      await refreshLibs()
    } finally {
      setLibSaving(false)
    }
  }

  const columns: ColumnsType<TeamMemberView> = [
    {
      title: '成员',
      key: 'who',
      render: (_, m) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {m.name || m.username}
            {m.user_id === team?.owner_id && (
              <Tag color="gold" style={{ marginLeft: 6 }}>
                <CrownOutlined /> 创建者
              </Tag>
            )}
            {me && m.user_id === me.id && (
              <Tag color="blue" style={{ marginLeft: 6 }}>
                我
              </Tag>
            )}
          </div>
          <div style={{ color: '#8a919f', fontSize: 12 }}>
            @{m.username}
            {m.department ? ` · ${m.department}` : ''}
          </div>
        </div>
      ),
    },
    { title: '邮箱', dataIndex: 'email', width: 200 },
    {
      title: '角色',
      key: 'role',
      width: 100,
      render: (_, m) => (m.role === 'admin' ? <Tag color="gold">管理员</Tag> : <Tag>成员</Tag>),
    },
    {
      title: '操作',
      key: 'op',
      width: 200,
      render: (_, m) => {
        if (!isAdmin) return <span style={{ color: '#bfbfbf' }}>—</span>
        if (m.user_id === team?.owner_id) return <span style={{ color: '#8a919f' }}>不可操作</span>
        return (
          <Space size={4}>
            {m.role === 'admin' ? (
              <Button size="small" onClick={() => void handleRole(m, 'member')}>
                降级为成员
              </Button>
            ) : (
              <Button size="small" icon={<CrownOutlined />} onClick={() => void handleRole(m, 'admin')}>
                设为管理员
              </Button>
            )}
            <Popconfirm
              title={`将「${m.name || m.username}」移出团队？`}
              okText="移出"
              okType="danger"
              cancelText="取消"
              onConfirm={() => void handleRemove(m)}
            >
              <Button size="small" danger icon={<UserDeleteOutlined />} />
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  if (notFound) {
    return (
      <Empty description="团队不存在或你不是该团队成员" style={{ marginTop: 120 }}>
        <Button type="primary" onClick={() => navigate('/teams')}>
          返回团队列表
        </Button>
      </Empty>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/teams')}>
          团队列表
        </Button>
        <Typography.Title level={4} style={{ margin: 0, flex: 1, minWidth: 0 }}>
          {team?.name ?? '加载中…'}
          {isAdmin && (
            <Tag color="gold" style={{ marginLeft: 8, fontSize: 12, verticalAlign: 'middle' }}>
              我是团队管理员
            </Tag>
          )}
        </Typography.Title>
        {isAdmin && (
          <Space>
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                setEditName(team?.name ?? '')
                setEditDesc(team?.description ?? '')
                setEditOpen(true)
              }}
            >
              编辑团队
            </Button>
            <Popconfirm
              title="删除该团队？"
              description="团队关系与团队名称将被移除，团队文库中的文档仍保留在库中。"
              okText="删除"
              okType="danger"
              cancelText="取消"
              onConfirm={() => void submitDelete()}
            >
              <Button danger icon={<DeleteOutlined />}>
                删除团队
              </Button>
            </Popconfirm>
          </Space>
        )}
      </div>

      {loading && <Spin style={{ display: 'block', margin: '80px auto' }} />}

      {!loading && (
        <>
          <Card
            size="small"
            title="团队简介"
            style={{ marginBottom: 16 }}
            extra={
              isAdmin ? (
                <Button type="link" size="small" onClick={() => setEditOpen(true)}>
                  编辑
                </Button>
              ) : null
            }
          >
            <div style={{ color: team?.description ? '#1f2329' : '#8a919f' }}>
              {team?.description || '暂无简介'}
            </div>
          </Card>

          <Card size="small" title={`团队成员（${members.length}）`} style={{ marginBottom: 16 }}>
            {isAdmin && (
              <Space style={{ marginBottom: 12 }} wrap>
                <Input
                  allowClear
                  style={{ width: 240 }}
                  placeholder="用户名 / 手机号 / 姓名 / 邮箱"
                  prefix={<UserAddOutlined />}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  onPressEnter={() => void submitAddMember()}
                />
                <Select
                  value={addRole}
                  style={{ width: 120 }}
                  onChange={setAddRole}
                  options={[
                    { value: 'member', label: '普通成员' },
                    { value: 'admin', label: '团队管理员' },
                  ]}
                />
                <Button type="primary" loading={adding} onClick={() => void submitAddMember()}>
                  添加成员
                </Button>
              </Space>
            )}
            <Table<TeamMemberView>
              rowKey="user_id"
              size="small"
              columns={columns}
              dataSource={members}
              pagination={false}
            />
          </Card>

          <Card
            size="small"
            title={`团队文库（${libs.length}）`}
            extra={
              isAdmin ? (
                <Button
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setLibName('')
                    setLibOpen(true)
                  }}
                >
                  新建文库
                </Button>
              ) : null
            }
          >
            {libs.length === 0 ? (
              <Empty description="该团队还没有文库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Row gutter={[12, 12]}>
                {libs.map((b) => (
                  <Col key={b.id} xs={24} sm={12} md={8} lg={6}>
                    <Card
                      size="small"
                      hoverable
                      onClick={() => navigate(`/books/${b.id}`)}
                      style={{ height: '100%' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <BookOutlined style={{ color: '#2f54eb' }} />
                        <div
                          style={{
                            fontWeight: 600,
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {b.name}
                        </div>
                      </div>
                      <div style={{ color: '#8a919f', fontSize: 12, marginTop: 6 }}>
                        {b.description || '团队共享文库'}
                      </div>
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </Card>
        </>
      )}

      {/* 编辑团队 */}
      <Modal
        title="编辑团队"
        open={editOpen}
        onOk={() => void submitEdit()}
        onCancel={() => setEditOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, color: '#5f6672' }}>团队名称</div>
          <Input
            value={editName}
            autoFocus
            placeholder="团队名称"
            onChange={(e) => setEditName(e.target.value)}
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, color: '#5f6672' }}>团队简介</div>
          <Input.TextArea
            rows={3}
            value={editDesc}
            placeholder="一句话介绍（可选）"
            maxLength={512}
            onChange={(e) => setEditDesc(e.target.value)}
          />
        </div>
      </Modal>

      {/* 新建团队文库 */}
      <Modal
        title="新建团队文库"
        open={libOpen}
        onOk={() => void submitCreateLib()}
        onCancel={() => setLibOpen(false)}
        confirmLoading={libSaving}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          value={libName}
          autoFocus
          placeholder={`文库名称（默认「${team?.name ?? ''}文库」）`}
          onChange={(e) => setLibName(e.target.value)}
        />
        <div style={{ color: '#8a919f', fontSize: 12, marginTop: 8 }}>
          团队文库对团队内所有成员开放读写，不计入个人书架的「我的知识库」。
        </div>
      </Modal>
    </div>
  )
}
