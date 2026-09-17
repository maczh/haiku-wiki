import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Alert, Button, Input, Modal, Space, Typography, message } from 'antd'
import { CopyOutlined, QrcodeOutlined, ShareAltOutlined } from '@ant-design/icons'
import { getDocShare, updateDocShare } from '../../api/docs'

interface Props {
  open: boolean
  onClose: () => void
  docId: number
  docTitle: string
}

/**
 * 「分享到微信」：确保所有文档都能一键生成可免登录阅读的分享链接，并以二维码形式
 * 供用户在手机微信中扫码打开（这是桌面 → 手机微信最可靠的桥接方式）。
 * 链接本质是 /doc-share/:slug 的公开只读页（见 DocSharePage），微信内置浏览器可直接打开。
 */
export default function WeChatShareModal({ open, onClose, docId, docTitle }: Props) {
  const [slug, setSlug] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const link = slug ? `${window.location.origin}/doc-share/${slug}` : ''

  const ensure = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      let view = await getDocShare(docId)
      if (!view) {
        // 该文档尚未生成分享链接 → 创建一条永久有效、无密码的分享
        view = await updateDocShare(docId, { enabled: true, expires_at: null, password: '' })
      }
      setSlug(view.slug)
      const dataUrl = await QRCode.toDataURL(`${window.location.origin}/doc-share/${view.slug}`, {
        width: 248,
        margin: 1,
        color: { dark: '#1f1f1f', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      setQr(dataUrl)
    } catch {
      setError('生成分享链接失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => {
    if (open) void ensure()
    else {
      setSlug(null)
      setQr('')
      setError('')
    }
  }, [open, ensure])

  const copyLink = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link)
      } else {
        const ta = document.createElement('textarea')
        ta.value = link
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      message.success('链接已复制')
    } catch {
      message.error('复制失败，请手动选择链接复制')
    }
  }, [link])

  const shareToWeChat = useCallback(async () => {
    const title = docTitle || '来自寄海文库的文档'
    try {
      if (navigator.share) {
        await navigator.share({ title, text: title, url: link })
        return
      }
    } catch {
      // 用户取消或不支持 → 退回复制
    }
    await copyLink()
    if (!navigator.share) message.info('链接已复制，去微信粘贴给好友或发到「文件传输助手」即可打开')
  }, [docTitle, link, copyLink])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={
        <Space>
          <ShareAltOutlined />
          分享到微信
        </Space>
      }
      width={420}
      destroyOnClose
    >
      {error ? (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 248,
            height: 248,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #ebedf0',
            borderRadius: 12,
            background: '#fff',
          }}
        >
          {qr ? (
            <img src={qr} alt="分享二维码" width={232} height={232} style={{ display: 'block' }} />
          ) : (
            <QrcodeOutlined style={{ fontSize: 48, color: '#bfc4cc' }} />
          )}
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          微信「扫一扫」，在手机上打开阅读
        </Typography.Text>

        <div style={{ width: '100%' }}>
          <div style={{ marginBottom: 6, color: '#5f6672', fontSize: 13 }}>分享链接（免登录只读）</div>
          <Input
            readOnly
            value={loading ? '正在生成…' : link}
            addonAfter={
              <Button type="link" size="small" icon={<CopyOutlined />} onClick={copyLink} disabled={!link}>
                复制
              </Button>
            }
          />
        </div>

        <Button type="primary" block icon={<WechatOutlined />} onClick={shareToWeChat} disabled={!link}>
          分享到微信
        </Button>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0, lineHeight: 1.7 }}>
          在微信中打开：点击右上角「···」→ 发送给朋友 / 分享到朋友圈；或把链接发到「文件传输助手」后点击打开即可阅读。
        </Typography.Paragraph>
      </div>
    </Modal>
  )
}

// 微信图标在 antd 内置图标里没有独立组件，用文字 + 绿色表现，避免引入额外依赖。
function WechatOutlined() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#07c160',
        fontWeight: 700,
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      微
    </span>
  )
}
