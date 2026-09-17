import { useEffect, useState } from 'react'
import { Button, Card, Input } from 'antd'
import { LockOutlined } from '@ant-design/icons'

interface Props {
  /** 提交校验（内部处理错误提示）；reject 时凭 error.response.data.code 区分 40301/42901 */
  onSubmit: (password: string) => Promise<void>
}

/** 密码门卡片（I03）：密码错误行内提示 + 42901 限频 60s 倒计时 */
export default function PasswordGate({ onSubmit }: Props) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  // 限频倒计时
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function submit() {
    if (loading || cooldown > 0) return
    setLoading(true)
    setError('')
    try {
      await onSubmit(password)
    } catch (e) {
      const respData = (e as { response?: { data?: { code?: number; message?: string } } })?.response?.data
      const code = respData?.code
      if (code === 42901) {
        setError(respData?.message || '尝试次数过多，请稍后再试')
        setCooldown(60)
      } else if (code === 40301) {
        setError('密码错误，请重试')
      } else if (code === 40401) {
        setError('分享链接无效或已失效')
      } else {
        setError(respData?.message || '校验失败，请重试')
      }
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f8fa' }}>
      <Card style={{ width: 380, textAlign: 'center' }}>
        <div style={{ fontSize: 40, color: '#2f54eb', marginBottom: 12 }}>
          <LockOutlined />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>此文档案受密码保护</div>
        <div style={{ color: '#8a919f', fontSize: 13, marginBottom: 20 }}>请输入阅读密码查看内容</div>
        <Input.Password
          size="large"
          placeholder="阅读密码"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          onPressEnter={() => void submit()}
          style={{ marginBottom: 12 }}
        />
        {error && <div style={{ color: '#ff4d4f', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <Button
          type="primary"
          size="large"
          block
          loading={loading}
          disabled={cooldown > 0}
          onClick={() => void submit()}
        >
          {cooldown > 0 ? `尝试过于频繁，${cooldown}s 后可重试` : '查看文档'}
        </Button>
      </Card>
    </div>
  )
}
