import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, Col, Form, Input, Row, Typography, message } from 'antd'
import { IdcardOutlined, LockOutlined, MailOutlined, MobileOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'
import { register } from '../api/auth'
import { useAuthStore } from '../stores/authStore'
import { useViewMode } from '../h5/useViewMode'

interface RegisterForm {
  username: string
  name?: string
  email: string
  password: string
  confirm: string
  department?: string
  phone?: string
}

/**
 * 注册页：用户名 / 姓名 / 邮箱 / 密码 / 部门 / 手机号。
 *
 * 用户名、邮箱、手机号三者全局唯一：冲突时后端返回 40901 并带明确文案
 * （「该用户名已注册」等），由 axios 拦截器统一 toast，这里只负责前端格式校验。
 */
export default function RegisterPage() {
  const navigate = useNavigate()
  const { mode } = useViewMode()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [loading, setLoading] = useState(false)

  async function onFinish(values: RegisterForm) {
    setLoading(true)
    try {
      const res = await register({
        username: values.username.trim(),
        name: values.name?.trim() || undefined,
        email: values.email.trim(),
        password: values.password,
        department: values.department?.trim() || undefined,
        phone: values.phone?.trim() || undefined,
      })
      setAuth(res.token, res.user)
      message.success('注册成功，欢迎加入寄海文库！')
      // 按当前视图模式跳转：手机版回 /m，桌面版回 /
      navigate(mode === 'h5' ? '/m' : '/', { replace: true })
    } catch {
      /* 拦截器已提示（含重名 / 邮箱手机号冲突） */
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
      <Card style={{ width: '100%', maxWidth: 460, borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          注册寄海文库
        </Typography.Title>
        <Typography.Text type="secondary">用户名、邮箱、手机号均需唯一</Typography.Text>
      </div>
      <Form onFinish={onFinish} size="large" layout="vertical">
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item
              label="用户名"
              name="username"
              rules={[
                { required: true, message: '请输入用户名' },
                { min: 2, max: 64, message: '用户名需 2~64 个字符' },
                { pattern: /^[A-Za-z0-9_.-]+$/, message: '仅支持字母、数字、_ . -' },
              ]}
            >
              <Input prefix={<UserOutlined />} placeholder="登录用户名（必填）" autoComplete="username" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="姓名" name="name" rules={[{ max: 64, message: '姓名过长' }]}>
              <Input prefix={<IdcardOutlined />} placeholder="真实姓名（可选）" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          label="邮箱"
          name="email"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '邮箱格式不正确' },
          ]}
        >
          <Input prefix={<MailOutlined />} placeholder="邮箱（必填）" />
        </Form.Item>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item
              label="密码"
              name="password"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '密码至少 6 位' },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="密码（至少 6 位）" autoComplete="new-password" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="确认密码"
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
              <Input.Password prefix={<LockOutlined />} placeholder="确认密码" autoComplete="new-password" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="部门" name="department" rules={[{ max: 128, message: '部门名称过长' }]}>
              <Input prefix={<TeamOutlined />} placeholder="所属部门（可选）" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="手机号"
              name="phone"
              rules={[{ pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' }]}
            >
              <Input prefix={<MobileOutlined />} placeholder="手机号（可选）" maxLength={11} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item style={{ marginBottom: 8 }}>
          <Button type="primary" htmlType="submit" block loading={loading}>
            注册
          </Button>
        </Form.Item>
      </Form>
      <div style={{ textAlign: 'center' }}>
        已有账号？<Link to={mode === 'h5' ? '/m/login' : '/login'}>直接登录</Link>
      </div>
      </Card>
    </div>
  )
}
