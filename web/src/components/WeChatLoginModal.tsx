import { useEffect, useRef, useState } from 'react'
import { Avatar, Button, Form, Input, Modal, Tabs, Typography, message } from 'antd'
import QRCode from 'qrcode'
import { wechatBind, wechatDevComplete, wechatQRCode, wechatStatus } from '../api/wechat'

interface Props {
  open: boolean
  onClose: () => void
  /** 登录成功（拿到 token）。user 由调用方用 /auth/me 补齐 */
  onSuccess: (token: string) => void
}

type Phase = 'loading' | 'qr' | 'needs_profile' | 'expired'

/**
 * 微信扫码登录弹窗：
 *  - 生成会话 → 把二维码内容渲染成图片 → 轮询状态；
 *  - 已绑定用户 → authorized 直接登录；
 *  - 无对应账号 → needs_profile，用户在弹窗内「绑定已有账号」或「注册新用户」；
 *  - dev 模式（微信未配置）额外提供「模拟扫码」按钮，便于无凭据联调。
 */
export default function WeChatLoginModal({ open, onClose, onSuccess }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [qrDataURL, setQrDataURL] = useState('')
  const [devMode, setDevMode] = useState(false)
  const [ticket, setTicket] = useState('')
  const [linkToken, setLinkToken] = useState('')
  const [wxNick, setWxNick] = useState('')
  const [wxAvatar, setWxAvatar] = useState('')
  const timerRef = useRef<number | null>(null)

  function stopPoll() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  async function start(tk: string) {
    stopPoll()
    timerRef.current = window.setInterval(async () => {
      try {
        const r = await wechatStatus(tk)
        if (r.state === 'authorized' && r.token) {
          stopPoll()
          onSuccess(r.token)
        } else if (r.state === 'needs_profile') {
          stopPoll()
          setLinkToken(r.link_token || '')
          setWxNick(r.nickname || '')
          setWxAvatar(r.avatar || '')
          setPhase('needs_profile')
        } else if (r.state === 'expired') {
          stopPoll()
          setPhase('expired')
        }
      } catch {
        /* 轮询失败静默重试，不阻断 */
      }
    }, 1500)
  }

  useEffect(() => {
    if (!open) return
    let alive = true
    ;(async () => {
      try {
        const r = await wechatQRCode()
        if (!alive) return
        setTicket(r.ticket)
        setDevMode(r.dev_mode)
        const url = await QRCode.toDataURL(r.qrcode_url, { width: 220, margin: 1 })
        setQrDataURL(url)
        setPhase('qr')
        start(r.ticket)
      } catch {
        if (alive) message.error('生成微信登录二维码失败')
      }
    })()
    return () => {
      alive = false
      stopPoll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function refresh() {
    setPhase('loading')
    ;(async () => {
      try {
        const r = await wechatQRCode()
        setTicket(r.ticket)
        setDevMode(r.dev_mode)
        const url = await QRCode.toDataURL(r.qrcode_url, { width: 220, margin: 1 })
        setQrDataURL(url)
        setPhase('qr')
        start(r.ticket)
      } catch {
        message.error('刷新二维码失败')
      }
    })()
  }

  async function simulate() {
    try {
      await wechatDevComplete(ticket, { nickname: wxNick || '微信用户' })
      message.success('已模拟扫码，请稍候…')
    } catch {
      /* 拦截器已提示 */
    }
  }

  return (
    <Modal open={open} onCancel={onClose} footer={null} title="微信扫码登录" centered>
      {phase === 'loading' && <div style={{ textAlign: 'center', padding: 40 }}>加载中…</div>}

      {phase === 'qr' && (
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <img src={qrDataURL} alt="wechat qrcode" style={{ width: 220, height: 220 }} />
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 4 }}>
            请使用微信扫一扫登录
          </Typography.Paragraph>
          {devMode && (
            <Button type="dashed" block onClick={simulate} style={{ marginTop: 8 }}>
              模拟扫码（dev 模式）
            </Button>
          )}
        </div>
      )}

      {phase === 'expired' && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Typography.Paragraph type="secondary">二维码已失效</Typography.Paragraph>
          <Button type="primary" onClick={refresh}>
            刷新二维码
          </Button>
        </div>
      )}

      {phase === 'needs_profile' && (
        <ProfileStep
          nickname={wxNick}
          avatar={wxAvatar}
          onBind={async (account, password) => {
            const res = await wechatBind({ link_token: linkToken, mode: 'bind', account, password })
            onSuccess(res.token)
          }}
          onRegister={async (p) => {
            const res = await wechatBind({ link_token: linkToken, mode: 'register', ...p })
            onSuccess(res.token)
          }}
        />
      )}
    </Modal>
  )
}

interface ProfileProps {
  nickname: string
  avatar: string
  onBind: (account: string, password: string) => Promise<void>
  onRegister: (p: {
    username: string
    email: string
    password: string
    phone?: string
    name?: string
  }) => Promise<void>
}

function ProfileStep({ nickname, avatar, onBind, onRegister }: ProfileProps) {
  const [loading, setLoading] = useState(false)

  async function run(fn: () => Promise<void>) {
    setLoading(true)
    try {
      await fn()
    } catch {
      /* 拦截器已提示 */
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Avatar src={avatar || undefined} style={{ background: '#2f54eb' }}>
          {nickname?.slice(0, 1) || '微'}
        </Avatar>
        <div>
          <div style={{ fontWeight: 600 }}>{nickname || '微信用户'}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            该微信尚未绑定站内账号
          </Typography.Text>
        </div>
      </div>
      <Tabs
        defaultActiveKey="bind"
        items={[
          {
            key: 'bind',
            label: '绑定已有账号',
            children: (
              <Form
                layout="vertical"
                onFinish={(v) => run(() => onBind(v.account, v.password))}
              >
                <Form.Item name="account" label="用户名 / 手机号 / 邮箱" rules={[{ required: true }]}>
                  <Input placeholder="请输入站内账号" />
                </Form.Item>
                <Form.Item name="password" label="密码" rules={[{ required: true }]}>
                  <Input.Password placeholder="请输入密码" />
                </Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading}>
                  绑定并登录
                </Button>
              </Form>
            ),
          },
          {
            key: 'register',
            label: '注册新账号',
            children: (
              <Form
                layout="vertical"
                initialValues={{ name: nickname }}
                onFinish={(v) =>
                  run(() =>
                    onRegister({
                      username: v.username,
                      email: v.email,
                      password: v.password,
                      phone: v.phone,
                      name: v.name || nickname,
                    }),
                  )
                }
              >
                <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                  <Input placeholder="登录用户名" />
                </Form.Item>
                <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
                  <Input placeholder="邮箱" />
                </Form.Item>
                <Form.Item name="name" label="姓名（可选）">
                  <Input placeholder="真实姓名 / 昵称" />
                </Form.Item>
                <Form.Item name="phone" label="手机号（可选）">
                  <Input placeholder="手机号" />
                </Form.Item>
                <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}>
                  <Input.Password placeholder="登录密码" />
                </Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading}>
                  注册并登录
                </Button>
              </Form>
            ),
          },
        ]}
      />
    </div>
  )
}
