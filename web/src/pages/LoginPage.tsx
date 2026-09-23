import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, Divider, Form, Input, Typography, message } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { login, me } from '../api/auth'
import { useAuthStore } from '../stores/authStore'
import { useViewMode } from '../h5/useViewMode'
import WeChatLoginModal from '../components/WeChatLoginModal'

/** 登录页：账号可为「用户名 / 手机号 / 邮箱」任一（后端按此顺序查找） */
export default function LoginPage() {
  const navigate = useNavigate()
  const { mode } = useViewMode()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [loading, setLoading] = useState(false)
  const [wxOpen, setWxOpen] = useState(false)

  async function goAfterLogin(token: string) {
    try {
      const u = await me()
      setAuth(token, u)
      message.success(`欢迎回来，${u.nickname || u.name || u.username}`)
    } catch {
      // 拿不到用户资料也至少把 token 落下，避免白登
      setAuth(token, null as never)
    }
    navigate(mode === 'h5' ? '/m' : '/', { replace: true })
  }

  async function onFinish(values: { account: string; password: string }) {
    setLoading(true)
    try {
      const res = await login(values.account.trim(), values.password)
      setAuth(res.token, res.user)
      // 管理员提示管理入口位置（入口本身在顶栏头像菜单里）
      if (res.user.role === 'admin') {
        message.success('管理员已登录：可从右上角头像菜单进入「用户管理」')
      } else {
        message.success(`欢迎回来，${res.user.nickname || res.user.name || res.user.username}`)
      }
      // 按当前视图模式跳转：手机版回 /m，桌面版回 /
      navigate(mode === 'h5' ? '/m' : '/', { replace: true })
    } catch {
      /* 拦截器已提示 */
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: '#f5f6f8',
      }}
    >
      <Card style={{ width: '100%', maxWidth: 400, borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          登录寄海文库
        </Typography.Title>
        <Typography.Text type="secondary">企业知识库 · 记录、组织与分享</Typography.Text>
      </div>
      <Form onFinish={onFinish} size="large">
        <Form.Item name="account" rules={[{ required: true, message: '请输入用户名 / 手机号 / 邮箱' }]}>
          <Input prefix={<UserOutlined />} placeholder="用户名 / 手机号 / 邮箱" autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form.Item>
      </Form>

      <Divider plain style={{ fontSize: 12, color: '#999' }}>或</Divider>

      <Button block icon={<span style={{ marginRight: 6 }}>💬</span>} onClick={() => setWxOpen(true)}>
        微信扫码登录
      </Button>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        还没有账号？<Link to={mode === 'h5' ? '/m/register' : '/register'}>立即注册</Link>
      </div>
      </Card>

      <WeChatLoginModal open={wxOpen} onClose={() => setWxOpen(false)} onSuccess={goAfterLogin} />
    </div>
  )
}
