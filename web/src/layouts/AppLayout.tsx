import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Input, Avatar, Dropdown, Tooltip } from 'antd'
import {
  BookOutlined,
  DeleteOutlined,
  LogoutOutlined,
  SearchOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { me } from '../api/auth'

/** 应用主布局：顶部导航（Logo/搜索框/头像）+ 内容区 */
export default function AppLayout() {
  const navigate = useNavigate()
  const { token, user, setUser, logout } = useAuthStore()

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
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              background: '#2f54eb',
              color: '#fff',
              fontSize: 14,
            }}
          >
            海
          </span>
          海库
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
