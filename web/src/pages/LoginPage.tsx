import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, Form, Input, Typography, message } from 'antd'
import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { login } from '../api/auth'
import { useAuthStore } from '../stores/authStore'

/** 登录页（含注册入口） */
export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [loading, setLoading] = useState(false)

  async function onFinish(values: { email: string; password: string }) {
    setLoading(true)
    try {
      const res = await login(values.email, values.password)
      setAuth(res.token, res.user)
      message.success(`欢迎回来，${res.user.nickname}`)
      navigate('/', { replace: true })
    } catch {
      /* 拦截器已提示 */
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card style={{ width: 400, borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          登录寄海文库
        </Typography.Title>
        <Typography.Text type="secondary">企业知识库 · 记录、组织与分享</Typography.Text>
      </div>
      <Form onFinish={onFinish} size="large">
        <Form.Item name="email" rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式不正确' }]}>
          <Input prefix={<MailOutlined />} placeholder="邮箱" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="密码" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form.Item>
      </Form>
      <div style={{ textAlign: 'center' }}>
        还没有账号？<Link to="/register">立即注册</Link>
      </div>
    </Card>
  )
}
