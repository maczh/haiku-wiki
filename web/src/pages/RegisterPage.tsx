import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, Form, Input, Typography, message } from 'antd'
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons'
import { register } from '../api/auth'
import { useAuthStore } from '../stores/authStore'

/** 注册页：首个注册用户自动成为管理员 */
export default function RegisterPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [loading, setLoading] = useState(false)

  async function onFinish(values: { email: string; password: string; nickname?: string }) {
    setLoading(true)
    try {
      const res = await register(values.email, values.password, values.nickname)
      setAuth(res.token, res.user)
      message.success('注册成功，欢迎加入海库！')
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
          注册海库
        </Typography.Title>
        <Typography.Text type="secondary">首个注册用户将自动成为管理员</Typography.Text>
      </div>
      <Form onFinish={onFinish} size="large">
        <Form.Item name="email" rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式不正确' }]}>
          <Input prefix={<MailOutlined />} placeholder="邮箱" />
        </Form.Item>
        <Form.Item name="nickname" rules={[{ max: 64, message: '昵称过长' }]}>
          <Input prefix={<UserOutlined />} placeholder="昵称（可选，默认取邮箱前缀）" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '密码至少 6 位' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="密码（至少 6 位）" />
        </Form.Item>
        <Form.Item
          name="confirm"
          dependencies={['password']}
          rules={[
            { required: true, message: '请再次输入密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) return Promise.resolve()
                return Promise.reject(new Error('两次输入的密码不一致'))
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="确认密码" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            注册
          </Button>
        </Form.Item>
      </Form>
      <div style={{ textAlign: 'center' }}>
        已有账号？<Link to="/login">直接登录</Link>
      </div>
    </Card>
  )
}
