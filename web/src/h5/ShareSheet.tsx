import { useEffect, useState } from 'react'
import { Alert, message, Spin } from 'antd'
import { CheckOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons'
import {
  SHARE_CHANNELS,
  canNativeShare,
  copyText,
  nativeShare,
  openShareChannel,
  type ShareChannel,
} from '../lib/share'

interface Props {
  open: boolean
  onClose: () => void
  /** 分享标题（文档 / 文库名） */
  title: string
  /** 分享链接（为空时显示 loading，由调用方异步准备） */
  url: string
  /** 链接还在生成中 */
  loading?: boolean
  /** 生成失败的原因（无写权限等后端错误） */
  error?: string
}

/**
 * H5 分享面板（底部弹层）。
 *
 * 优先走系统分享（能唤起微信/QQ/微博/钉钉等任意已安装 App），
 * 不支持时列出各渠道：有 URL scheme 的直接唤起，微信/朋友圈这种无法直传的
 * 走「复制链接 + 提示去粘贴」。
 */
export default function ShareSheet({ open, onClose, title, url, loading = false, error = '' }: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) setCopied(false)
  }, [open])

  if (!open) return null

  const doSystem = async () => {
    if (!url) return
    const ok = await nativeShare({ title, text: title, url })
    if (ok) {
      onClose()
      return
    }
    // 系统分享不可用/被取消：留在面板里让用户选具体渠道
  }

  const doCopy = async () => {
    if (!url) return
    const ok = await copyText(url)
    setCopied(ok)
    if (ok) message.success('链接已复制')
    else message.warning('复制失败，请长按链接手动复制')
  }

  const doChannel = async (ch: ShareChannel) => {
    if (!url) return
    // 先把链接放剪贴板：App 打开后直接粘贴；App 没装也不至于「点了没反应」
    await copyText(url)
    message.success(ch.hint || `已复制链接，正在打开${ch.name}`)
    openShareChannel(ch, url, title)
    onClose()
  }

  return (
    <div
      data-h5-share-sheet="1"
      style={{ position: 'fixed', inset: 0, zIndex: 1200 }}
      onClick={onClose}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)' }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          background: '#fff',
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          padding: '14px 12px calc(14px + env(safe-area-inset-bottom, 0px))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ textAlign: 'center', fontSize: 15, fontWeight: 600, color: '#1f2329', marginBottom: 4 }}>
          分享
        </div>
        <div
          style={{
            fontSize: 12,
            color: '#8a919f',
            textAlign: 'center',
            marginBottom: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>

        {error ? (
          <Alert
            type="error"
            showIcon
            message={error}
            style={{ marginBottom: 8 }}
          />
        ) : loading || !url ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 0' }}>
            <Spin size="small" />
            <span style={{ marginLeft: 8, fontSize: 13, color: '#8a919f' }}>正在生成分享链接…</span>
          </div>
        ) : (
          <>
            {canNativeShare() && (
              <button
                type="button"
                data-h5-share-system="1"
                onClick={doSystem}
                style={{
                  width: '100%',
                  height: 44,
                  marginBottom: 10,
                  border: '1px solid #1677ff',
                  borderRadius: 10,
                  background: '#1677ff',
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                分享到…（系统）
              </button>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {SHARE_CHANNELS.map((ch) => (
                <button
                  key={ch.key}
                  type="button"
                  data-h5-share-channel={ch.key}
                  onClick={() => doChannel(ch)}
                  style={{
                    width: 'calc(25% - 8px)',
                    height: 62,
                    border: '1px solid #f0f0f0',
                    borderRadius: 10,
                    background: '#fafafa',
                    color: '#1f2329',
                    fontSize: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    padding: 0,
                  }}
                >
                  <LinkOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                  {ch.name}
                </button>
              ))}
            </div>

            <div
              style={{
                marginTop: 12,
                padding: '8px 10px',
                background: '#f7f8fa',
                borderRadius: 8,
                fontSize: 12,
                color: '#5f6672',
                wordBreak: 'break-all',
              }}
            >
              {url}
            </div>
            <button
              type="button"
              data-h5-share-copy="1"
              onClick={doCopy}
              style={{
                width: '100%',
                height: 42,
                marginTop: 10,
                border: '1px solid #d9d9d9',
                borderRadius: 10,
                background: '#fff',
                color: '#1f2329',
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {copied ? <CheckOutlined style={{ color: '#52c41a' }} /> : <CopyOutlined />}
              {copied ? '已复制' : '复制链接'}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%',
            height: 42,
            marginTop: 10,
            border: 'none',
            background: 'transparent',
            color: '#8a919f',
            fontSize: 14,
          }}
        >
          取消
        </button>
      </div>
    </div>
  )
}
