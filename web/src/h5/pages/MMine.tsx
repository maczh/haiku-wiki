import { useNavigate } from 'react-router-dom'
import { Avatar, Button, Divider, message } from 'antd'
import { LogoutOutlined, MobileOutlined, ReloadOutlined } from '@ant-design/icons'
import { useAuthStore } from '../../stores/authStore'
import { useViewMode, VIEW_MODE_KEY } from '../useViewMode'
import { isMobile } from '../../lib/isMobile'

/**
 * H5 「我的」页：展示登录态，提供登出、切桌面版、恢复自动（按 UA 重算）入口。
 *
 *   · 已登录：昵称 / 登出 / 切换桌面版（setMode('desktop') + 回桌面根）
 *   · 未登录：引导去 /m/login
 *   · 恢复自动：清除 localStorage 记忆键，按 UA 重新判定视图模式
 */
export default function MMine() {
  const navigate = useNavigate()
  const { user, token, logout } = useAuthStore()
  const { setMode } = useViewMode()

  const loggedIn = !!token && !!user

  function switchToDesktop() {
    setMode('desktop')
    navigate('/')
  }

  function restoreAuto() {
    try {
      localStorage.removeItem(VIEW_MODE_KEY)
    } catch {
      /* 忽略清除失败 */
    }
    const uaMode = isMobile() ? 'h5' : 'desktop'
    setMode(uaMode)
    message.success(`已恢复自动识别（当前：${uaMode === 'h5' ? '手机版' : '桌面版'}）`)
    if (uaMode === 'desktop') navigate('/')
  }

  return (
    <div style={{ padding: 16 }}>
      {loggedIn ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: '#fff',
              borderRadius: 10,
              padding: 16,
              border: '1px solid #f0f2f5',
            }}
          >
            <Avatar size={48} style={{ background: '#2f54eb', flexShrink: 0 }}>
              {(user!.nickname || user!.username || 'U').slice(0, 1).toUpperCase()}
            </Avatar>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2329' }}>{user!.nickname || user!.username}</div>
              <div style={{ fontSize: 12, color: '#8a919f', marginTop: 2 }}>@{user!.username}</div>
            </div>
          </div>

          <Divider style={{ margin: '16px 0' }} />

          <Button block icon={<MobileOutlined />} onClick={switchToDesktop} style={{ marginBottom: 12 }}>
            切换桌面版
          </Button>
          <Button block icon={<ReloadOutlined />} onClick={restoreAuto} style={{ marginBottom: 12 }}>
            恢复自动（按设备识别）
          </Button>
          <Button
            block
            danger
            icon={<LogoutOutlined />}
            onClick={() => logout()}
          >
            退出登录
          </Button>
        </>
      ) : (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div style={{ fontSize: 15, color: '#5f6672', marginBottom: 16 }}>你还没有登录</div>
          <Button type="primary" onClick={() => navigate('/m/login')}>
            去登录
          </Button>
        </div>
      )}
    </div>
  )
}
