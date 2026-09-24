import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Input, Avatar, Dropdown, Tooltip } from 'antd'
import {
  AppstoreOutlined,
  BookOutlined,
  DeleteOutlined,
  LogoutOutlined,
  MobileOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { me } from '../api/auth'
import { useViewMode } from '../h5/useViewMode'
import JihaiLogo from '../components/brand/JihaiLogo'

/** 应用主布局：顶部导航（Logo/搜索框/头像）+ 内容区 */
export default function AppLayout() {
  const navigate = useNavigate()
  const { setMode } = useViewMode()
  const { token, user, setUser, logout } = useAuthStore()

  /** 切换手机版：记忆模式 + 跳转 /m */
  function switchToMobile() {
    setMode('h5')
    navigate('/m')
  }

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true })
      return
    }
    if (!user) {
      me()
        .then(setUser)
        .catch(() => {
          /* 拦截器已处理 401 */
        })
    }
  }, [token, user])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header
        style={{
          height: 56,
          flexShrink: 0,
          background: '#fff',
          borderBottom: '1px solid #ebedf0',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: 16,
        }}
      >
        <div
          onClick={() => navigate('/')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700, fontSize: 18, color: '#001529' }}
        >
          <JihaiLogo size={28} />
          寄海文库
        </div>

        <Input
          allowClear
          size="middle"
          placeholder="搜索标题与正文…"
          prefix={<SearchOutlined style={{ color: '#bbb' }} />}
          style={{ maxWidth: 360 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const q = (e.target as HTMLInputElement).value.trim()
              if (q) navigate(`/search?q=${encodeURIComponent(q)}`)
            }
          }}
        />

        <div style={{ flex: 1 }} />

        <Tooltip title="我的知识库">
          <BookOutlined style={{ fontSize: 17, cursor: 'pointer' }} onClick={() => navigate('/')} />
        </Tooltip>
        <Tooltip title="团队（团队文库与成员管理）">
          <TeamOutlined style={{ fontSize: 17, cursor: 'pointer' }} onClick={() => navigate('/teams')} />
        </Tooltip>
        <Tooltip title="模板中心（企业办公常用模板）">
          <AppstoreOutlined style={{ fontSize: 17, cursor: 'pointer' }} onClick={() => navigate('/templates')} />
        </Tooltip>
        <Tooltip title="回收站">
          <DeleteOutlined style={{ fontSize: 17, cursor: 'pointer' }} onClick={() => navigate('/trash')} />
        </Tooltip>

        <Dropdown
          menu={{
            items: [
              {
                key: 'settings',
                icon: <SettingOutlined />,
                label: '账号设置',
                onClick: () => navigate('/settings'),
              },
              // 仅管理员可见：系统管理（用户管理 / 系统配置 / 数据库迁移 / 存储迁移）
              ...(user?.role === 'admin'
                ? [
                    {
                      key: 'system-management',
                      icon: <SafetyCertificateOutlined />,
                      label: '系统管理',
                      children: [
                        {
                          key: 'admin-users',
                          label: '用户管理',
                          onClick: () => navigate('/admin/users'),
                        },
                        {
                          key: 'admin-templates',
                          label: '导入模板',
                          onClick: () => navigate('/admin/templates'),
                        },
                        {
                          key: 'system-config',
                          label: '系统配置',
                          onClick: () => navigate('/admin/system-config'),
                        },
                        {
                          key: 'migrate-database',
                          label: '数据库迁移',
                          onClick: () => navigate('/admin/migrate/database'),
                        },
                        {
                          key: 'migrate-storage',
                          label: '存储迁移',
                          onClick: () => navigate('/admin/migrate/storage'),
                        },
                      ],
                    },
                  ]
                : []),
              {
                key: 'mobile',
                icon: <MobileOutlined />,
                label: '切换手机版',
                onClick: () => switchToMobile(),
              },
              {
                key: 'logout',
                icon: <LogoutOutlined />,
                label: '退出登录',
                onClick: () => logout(),
              },
            ],
          }}
        >
          <Avatar style={{ background: '#2f54eb', cursor: 'pointer' }}>
            {(user?.nickname || 'U').slice(0, 1).toUpperCase()}
          </Avatar>
        </Dropdown>
      </header>

      <main style={{ flex: 1, overflow: 'hidden' }}>
        <Outlet />
      </main>
    </div>
  )
}
