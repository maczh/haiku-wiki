import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Checkbox, DatePicker, Drawer, Input, Modal, Popconfirm, Space, Switch, Typography, message } from 'antd'
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

const sharePasswordChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function generateSharePassword() {
  const values = new Uint32Array(4)
  crypto.getRandomValues(values)
  return Array.from(values, (value) => sharePasswordChars[value % sharePasswordChars.length]).join('')
}

function ShareSettings({
  noPassword,
  setNoPassword,
  pwdInput,
  setPwdInput,
  expireAt,
  setExpireAt,
}: {
  noPassword: boolean
  setNoPassword: (value: boolean) => void
  pwdInput: string
  setPwdInput: (value: string) => void
  expireAt: dayjs.Dayjs | null
  setExpireAt: (value: dayjs.Dayjs | null) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 18 }}>
      <div>
        <Typography.Text strong>分享密码</Typography.Text>
        <Space.Compact style={{ width: '100%', marginTop: 8 }}>
          <Input
            value={noPassword ? '' : pwdInput}
            maxLength={4}
            placeholder="4位字母或数字密码"
            disabled={noPassword}
            onChange={(e) => setPwdInput(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4))}
          />
          <Button disabled={noPassword} onClick={() => setPwdInput(generateSharePassword())}>
            随机生成
          </Button>
        </Space.Compact>
        <Checkbox checked={noPassword} onChange={(e) => setNoPassword(e.target.checked)} style={{ marginTop: 8 }}>
          免密分享
        </Checkbox>
      </div>
      <div>
        <Typography.Text strong>有效期</Typography.Text>
        <DatePicker
          showTime
          placeholder="永久有效（可选择过期时间）"
          value={expireAt}
          disabledDate={(d) => d.isBefore(dayjs(), 'day')}
          onChange={setExpireAt}
          style={{ width: '100%', marginTop: 8 }}
        />
      </div>
    </div>
  )
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
  const [noPassword, setNoPassword] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const v = await getDocShare(docId)
      setView(v)
      // 普通分享默认开启密码保护，首次配置或原分享免密时生成新密码。
      // 已有有效期则保持原配置，否则默认 3 天。
      setExpireAt(v?.expires_at ? dayjs(v.expires_at) : dayjs().add(3, 'day'))
      setNoPassword(false)
      setPwdInput(!v || !v.has_password ? generateSharePassword() : '')
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
  const shareText = shareLink
    ? `${shareLink}${!noPassword && pwdInput ? `\n分享密码：${pwdInput}` : ''}`
    : ''

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
    void apply({ password: noPassword ? '' : pwdInput, expires_at: expireAt ? expireAt.toDate().toISOString() : null })
      .catch(() => undefined)
      .finally(() => setCreating(false))
  }

  return (
    <Drawer
      title={`文档分享 · ${docTitle}`}
      width={440}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      {loading && <Typography.Text type="secondary">加载中…</Typography.Text>}

      {!loading && !view && (
        <div>
          <Typography.Paragraph type="secondary">
            设置分享密码与有效期后，点击“分享”生成免登录链接。
          </Typography.Paragraph>
          <ShareSettings noPassword={noPassword} setNoPassword={setNoPassword} pwdInput={pwdInput} setPwdInput={setPwdInput} expireAt={expireAt} setExpireAt={setExpireAt} />
          <Button type="primary" loading={creating} onClick={generate} disabled={!noPassword && pwdInput.length !== 4}>分享</Button>
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
              <Input.TextArea value={shareText} readOnly autoSize={{ minRows: 2, maxRows: 3 }} />
              <Button
                type="primary"
                icon={<CopyOutlined />}
                onClick={() => {
                  if (shareLink) {
                    void navigator.clipboard.writeText(shareText)
                    message.success('链接和分享密码已复制')
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

          <ShareSettings noPassword={noPassword} setNoPassword={setNoPassword} pwdInput={pwdInput} setPwdInput={setPwdInput} expireAt={expireAt} setExpireAt={setExpireAt} />
          <Button type="primary" loading={creating} onClick={generate} disabled={!noPassword && pwdInput.length !== 4}>分享</Button>

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
