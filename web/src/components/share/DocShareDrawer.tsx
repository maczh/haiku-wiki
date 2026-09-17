import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, DatePicker, Drawer, Input, Modal, Popconfirm, Space, Switch, Typography, message } from 'antd'
import { CopyOutlined, DeleteOutlined, ExportOutlined } from '@ant-design/icons'
import { getDocShare, revokeDocShare, updateDocShare } from '../../api/docs'
import type { DocShareView } from '../../types'
import dayjs from '../../lib/dayjs'

interface Props {
  open: boolean
  onClose: () => void
  docId: number
  docTitle: string
}

/**
 * 文档级分享管理抽屉（I04）：
 * 生成/复制链接、密码、有效期（永久/自定义）、启停、撤销 + 访问次数。
 * ⚠️ upsert 语义：每次保存都会刷新 slug，旧链接立即失效（抽屉内醒目提示）。
 */
export default function DocShareDrawer({ open, onClose, docId, docTitle }: Props) {
  const [view, setView] = useState<DocShareView | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pwdInput, setPwdInput] = useState('')
  const [expireAt, setExpireAt] = useState<dayjs.Dayjs | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const v = await getDocShare(docId)
      setView(v)
      setExpireAt(v?.expires_at ? dayjs(v.expires_at) : null)
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => {
    if (open && docId) void load()
    if (!open) {
      setView(null)
      setPwdInput('')
    }
  }, [open, docId, load])

  const shareLink = view ? `${window.location.origin}/doc-share/${view.slug}` : null

  /** 保存设置（upsert：刷新 slug + 覆盖配置） */
  async function apply(payload: { password?: string; expires_at?: string | null; enabled?: boolean }) {
    if (view) {
      // 更新即刷新 slug：醒目确认
      Modal.confirm({
        title: '保存并刷新分享链接？',
        content: '链接将重新生成，旧分享链接会立即失效（复制给别人的旧链接打不开）。',
        okText: '保存并刷新',
        cancelText: '取消',
        onOk: async () => {
          const v = await updateDocShare(docId, payload)
          setView(v)
          setPwdInput('')
          message.success('已保存，链接已刷新')
        },
      })
    } else {
      const v = await updateDocShare(docId, payload)
      setView(v)
      message.success('分享链接已生成')
    }
  }

  function generate() {
    setCreating(true)
    void apply({})
      .catch(() => undefined)
      .finally(() => setCreating(false))
  }

  return (
    <Drawer
      title={`文档分享 · ${docTitle}`}
      width={440}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      {loading && <Typography.Text type="secondary">加载中…</Typography.Text>}

      {!loading && !view && (
        <div>
          <Typography.Paragraph type="secondary">
            还没有为这篇文档生成分享链接。生成后可设置阅读密码与有效期，链接可发给任何人免登录阅读。
          </Typography.Paragraph>
          <Button type="primary" loading={creating} onClick={generate}>
            生成分享链接
          </Button>
        </div>
      )}

      {!loading && view && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Alert
            type="warning"
            showIcon
            message="保存任何设置都会刷新链接"
            description="链接重新生成后，旧分享链接立即失效，需把新链接重新发给对方。"
          />

          {/* 链接 */}
          <div>
            <Typography.Text strong>分享链接</Typography.Text>
            <Space.Compact style={{ width: '100%', marginTop: 8 }}>
              <Input value={shareLink ?? ''} readOnly />
              <Button
                type="primary"
                icon={<CopyOutlined />}
                onClick={() => {
                  if (shareLink) {
                    void navigator.clipboard.writeText(shareLink)
                    message.success('链接已复制')
                  }
                }}
              />
              <Button
                icon={<ExportOutlined />}
                onClick={() => {
                  if (shareLink) window.open(shareLink, '_blank')
                }}
              />
            </Space.Compact>
            <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 6, display: 'block' }}>
              累计访问 {view.views} 次 · 更新于 {dayjs(view.updated_at).format('YYYY-MM-DD HH:mm')}
            </Typography.Text>
          </div>

          {/* 状态开关 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <Typography.Text strong>分享状态</Typography.Text>
              <div style={{ color: '#8a919f', fontSize: 12 }}>关闭后链接立即失效，可随时重新开启</div>
            </div>
            <Switch
              checked={view.enabled}
              checkedChildren="开启"
              unCheckedChildren="停用"
              onChange={(on) => void apply({ enabled: on })}
            />
          </div>

          {/* 阅读密码 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <Typography.Text strong>阅读密码</Typography.Text>
                <div style={{ color: '#8a919f', fontSize: 12 }}>
                  {view.has_password ? '已设置密码，访问需输入' : '未设置，任何拿到链接的人可读'}
                </div>
              </div>
              <Button
                size="small"
                danger={view.has_password}
                onClick={() => void apply({ password: '' })}
                disabled={!view.has_password}
              >
                清除密码
              </Button>
            </div>
            <Space.Compact style={{ width: '100%' }}>
              <Input.Password
                placeholder={view.has_password ? '已设置（输入新密码覆盖）' : '设置阅读密码（至少 4 位）'}
                value={pwdInput}
                onChange={(e) => setPwdInput(e.target.value)}
              />
              <Button
                type="default"
                disabled={pwdInput.length < 4}
                onClick={() => void apply({ password: pwdInput })}
              >
                保存密码
              </Button>
            </Space.Compact>
          </div>

          {/* 有效期 */}
          <div>
            <Typography.Text strong>有效期</Typography.Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <span style={{ color: view.expires_at ? '#8a919f' : '#52c41a', fontSize: 13 }}>
                {view.expires_at ? `至 ${dayjs(view.expires_at).format('YYYY-MM-DD HH:mm')} UTC` : '永久有效'}
              </span>
              <DatePicker
                showTime
                placeholder="选择过期时间"
                value={expireAt}
                disabledDate={(d) => d.isBefore(dayjs(), 'day')}
                onChange={(d) => setExpireAt(d)}
                style={{ flex: 1 }}
              />
              <Button
                disabled={!expireAt}
                onClick={() =>
                  void apply({
                    // 本地时间 → RFC3339 UTC（与全局时间约定一致）
                    expires_at: expireAt ? expireAt.toDate().toISOString() : null,
                  })
                }
              >
                保存
              </Button>
            </div>
            <div style={{ marginTop: 6 }}>
              <Button size="small" type="link" style={{ paddingLeft: 0 }} onClick={() => void apply({ expires_at: null })}>
                恢复为永久有效
              </Button>
            </div>
          </div>

          {/* 撤销 */}
          <Popconfirm
            title="撤销分享？"
            description="链接将立即失效且不可恢复，再次分享会生成新链接。"
            okText="撤销"
            okType="danger"
            cancelText="取消"
            onConfirm={async () => {
              await revokeDocShare(docId)
              message.success('已撤销分享')
              setView(null)
            }}
          >
            <Button danger icon={<DeleteOutlined />} style={{ alignSelf: 'flex-start' }}>
              撤销分享
            </Button>
          </Popconfirm>
        </div>
      )}
    </Drawer>
  )
}
