/**
 * 网盘连接配置对话框。
 *
 * - SMB（NAS）：**两步流程**（PRD 本次需求）
 *     第 1 步：填写服务器 IP / 用户名 / 密码 / 域，点「下一步：列举共享」拨号枚举共享；
 *     第 2 步：列出该账号在服务器上的全部共享，可多选（编辑态为单选），并显示每个共享的
 *             可读 / 可写权限徽标；保存时为每个选中的共享创建一条连接。
 * - FTP / WebDAV：**单步流程**（沿用 PRD §4.3 / §4.4：先测试连接，通过后才允许保存）。
 */

import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Steps,
  Tag,
} from 'antd'
import { ApiError } from '../../api/request'
import {
  createConnection,
  listSMBShares,
  testUnsaved,
  updateConnection,
  type SMBShareInfo,
} from '../../api/netdisk'
import type { NetdiskConnection, NetdiskConnectionInput, NetdiskKind, NetdiskTestResult } from '../../types'
import { FTP_ENCODINGS } from '../../lib/netdisk/constants'

interface Props {
  open: boolean
  kind: NetdiskKind
  /** 编辑态：传入已有连接 */
  editing?: NetdiskConnection | null
  onClose: () => void
  /** 保存成功（后端回传新连接）；SMB 多共享时为「任一」新建连接，父组件会整体重列 */
  onSaved: (conn: NetdiskConnection) => void
}

/** 各协议的默认端口与说明 */
const KIND_META: Record<string, { title: string; defaultPort: number; portTip?: string }> = {
  smb: { title: 'NAS 网盘（SMB 协议）', defaultPort: 445 },
  ftp: { title: 'NAS 网盘（FTP 协议）', defaultPort: 21 },
  webdav: { title: '通用 WebDAV', defaultPort: 443 },
}

interface FormValues {
  name: string
  host: string
  port?: number
  share?: string
  domain?: string
  username?: string
  password?: string
  mode?: 'passive' | 'active'
  encoding?: 'utf-8' | 'gbk'
}

export default function NetdiskConnectionDialog({ open, kind, editing, onClose, onSaved }: Props) {
  const isSMB = kind === 'smb'
  const isEdit = Boolean(editing)
  const [form] = Form.useForm<FormValues>()

  // SMB 两步状态
  const [step, setStep] = useState<1 | 2>(1)
  const [shares, setShares] = useState<SMBShareInfo[]>([])
  const [loadingShares, setLoadingShares] = useState(false)
  const [shareErr, setShareErr] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  /**
   * SMB 第 1 步表单值快照。
   * ⚠️ 进入第 2 步后整个 `<Form>` 卸载、字段全部失去注册，此时 form.validateFields
   * 只能取到仍在 DOM 里的字段——直接读表单会丢掉 host/port/账号/密码，
   * 保存时后端就会报「主机地址不能为空」。因此第 1 步校验通过时立即快照，第 2 步只用快照。
   */
  const step1Ref = useRef<FormValues | null>(null)

  // FTP/WebDAV 单步状态
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testRes, setTestRes] = useState<NetdiskTestResult | null>(null)
  const [error, setError] = useState('')

  const meta = KIND_META[kind] || KIND_META.smb

  // 打开时重置表单与步骤
  useEffect(() => {
    if (!open) return
    setStep(1)
    setShares([])
    setShareErr('')
    setSelected([])
    setTestRes(null)
    setError('')
    step1Ref.current = null
    form.setFieldsValue({
      name: editing?.name ?? '',
      host: editing?.host ?? '',
      port: editing?.port ?? meta.defaultPort,
      share: editing?.share ?? '',
      domain: '',
      username: '',
      password: '',
      mode: editing?.mode ?? 'passive',
      encoding: editing?.encoding ?? 'utf-8',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, kind])

  /** 表单值 → 后端入参（空串字段一律不下发，避免覆盖掉已保存值） */
  function buildInput(v: FormValues, share?: string): NetdiskConnectionInput {
    const input: NetdiskConnectionInput = { name: v.name.trim(), kind }
    const put = <K extends keyof NetdiskConnectionInput>(key: K, val: NetdiskConnectionInput[K] | undefined) => {
      if (val === undefined || val === null) return
      if (typeof val === 'string' && val.trim() === '') return
      input[key] = val
    }
    put('host', v.host?.trim())
    put('port', v.port)
    put('share', share?.trim() || v.share?.trim())
    put('domain', v.domain?.trim())
    put('username', v.username?.trim())
    put('mode', v.mode)
    put('encoding', v.encoding)
    // 密码：编辑态留空 = 不修改；新建态必填
    put('password', v.password)
    return input
  }

  // ---------- SMB 第 1 步：拨号并列举共享 ----------
  async function handleListShares() {
    let values: FormValues
    try {
      values = await form.validateFields(['name', 'host', 'port', 'username', 'password', 'domain'])
    } catch {
      return
    }
    // 趁 Form 还挂载着，把第 1 步的值快照下来（见 step1Ref 注释）
    step1Ref.current = values
    setLoadingShares(true)
    setShareErr('')
    try {
      const res = await listSMBShares({
        host: values.host.trim(),
        port: values.port,
        username: values.username?.trim(),
        password: values.password,
        domain: values.domain?.trim(),
      })
      const list = res.shares || []
      setShares(list)
      // 预选：可读的共享；编辑态优先预选当前连接的共享
      const pre =
        editing?.share && list.some((s) => s.name === editing.share)
          ? [editing.share]
          : list.filter((s) => s.readable).map((s) => s.name)
      setSelected(isEdit ? pre.slice(0, 1) : pre)
      setStep(2)
    } catch (e) {
      setShareErr(e instanceof ApiError ? e.message : '列举共享失败，请检查服务器地址与账号')
    } finally {
      setLoadingShares(false)
    }
  }

  // ---------- SMB 第 2 步：保存（每个选中共享一条连接） ----------
  async function handleSaveSMB() {
    if (selected.length === 0) {
      setShareErr('请至少选择一个共享')
      return
    }
    // 第 2 步 Form 已卸载，必须用第 1 步的快照（正常流程不为 null；兜底提示回第 1 步）
    const values = step1Ref.current
    if (!values) {
      setShareErr('表单数据已失效，请回到上一步重新填写')
      return
    }
    setSaving(true)
    setShareErr('')
    try {
      const baseName = values.name.trim()
      let last: NetdiskConnection | null = null
      if (isEdit && editing) {
        // 编辑态：单选，更新当前连接指向的共享
        last = await updateConnection(editing.id, buildInput(values, selected[0]))
      } else {
        for (const share of selected) {
          const connName = selected.length === 1 ? baseName : `${baseName} · ${share}`
          last = await createConnection(buildInput({ ...values, name: connName }, share))
        }
      }
      if (last) onSaved(last)
    } catch (e) {
      setShareErr(e instanceof ApiError ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // ---------- FTP / WebDAV：测试 + 保存 ----------
  async function handleTest() {
    let values: FormValues
    try {
      values = await form.validateFields(['name', 'host', 'port', 'share', 'username', 'password', 'domain', 'mode', 'encoding'])
    } catch {
      return
    }
    setTesting(true)
    setError('')
    setTestRes(null)
    try {
      const res = await testUnsaved(buildInput(values))
      setTestRes(res)
      if (!res.ok) setError(res.message || '连接失败')
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '测试连接请求失败'
      setError(msg)
      setTestRes({ ok: false, message: msg })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    if (!testRes?.ok) {
      setError('请先测试连接成功后再保存')
      return
    }
    setSaving(true)
    setError('')
    try {
      const conn = editing
        ? await updateConnection(editing.id, buildInput(values))
        : await createConnection(buildInput(values))
      onSaved(conn)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const testOk = testRes?.ok === true

  return (
    <Modal
      open={open}
      title={`${isEdit ? '编辑' : '新增'}${meta.title}`}
      onCancel={onClose}
      width={isSMB ? 580 : 520}
      footer={null}
      destroyOnHidden
    >
      {isSMB && (
        <Steps
          size="small"
          current={step - 1}
          style={{ marginBottom: 16 }}
          items={[{ title: '服务器与账号' }, { title: '选择共享' }]}
        />
      )}

      {isSMB ? (
        // ---------------- SMB 两步流程 ----------------
        step === 1 ? (
          <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 12 }}>
            <Form.Item
              name="name"
              label="连接名称"
              rules={[{ required: true, message: '请填写连接名称' }, { max: 50, message: '不超过 50 字' }]}
            >
              <Input placeholder="例如：家里 NAS / 公司文件服务器" maxLength={50} />
            </Form.Item>
            <Form.Item
              name="host"
              label="服务器 IP 或主机名"
              rules={[{ required: true, message: '请填写服务器 IP 或主机名' }]}
            >
              <Input placeholder="192.168.1.10 或 nas.local" />
            </Form.Item>
            <Form.Item name="port" label="端口" rules={[{ type: 'number', min: 1, max: 65535, message: '端口范围 1–65535' }]}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="domain" label="域（domain，可选）">
              <Input placeholder="WORKGROUP 或 AD 域名" />
            </Form.Item>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请填写用户名' }]}>
              <Input placeholder={isEdit ? '已保存，如需修改请重新填写' : '留空表示匿名访问'} />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: !isEdit, message: '请填写密码' }]}
              extra={isEdit ? '已保存，留空则不修改' : undefined}
            >
              <Input.Password placeholder={isEdit ? '已保存，留空则不修改' : '留空表示匿名访问'} autoComplete="new-password" />
            </Form.Item>

            {shareErr && <Alert style={{ marginBottom: 12 }} type="error" showIcon message={shareErr} />}

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={onClose}>取消</Button>
              <Button type="primary" loading={loadingShares} onClick={() => void handleListShares()} data-testid="hk-netdisk-smb-next">
                下一步：列举共享
              </Button>
            </div>
          </Form>
        ) : (
          <div style={{ marginTop: 8 }}>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`已在「${form.getFieldValue('host') || '该服务器'}」上发现 ${shares.length} 个共享，请选择要接入的一个或多个：`}
            />
            <Spin spinning={shares.length === 0 && loadingShares}>
              <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #ebedf0', borderRadius: 8, padding: 4 }}>
                {shares.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: '#8a919f' }}>未发现可用共享</div>
                ) : (
                  shares.map((s) => {
                    const checked = selected.includes(s.name)
                    const onToggle = (on: boolean) => {
                      if (isEdit) {
                        // 编辑态单选
                        setSelected(on ? [s.name] : [])
                      } else {
                        setSelected((prev) => (on ? [...prev, s.name] : prev.filter((n) => n !== s.name)))
                      }
                    }
                    return (
                      <div
                        key={s.name}
                        onClick={() => onToggle(!checked)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '10px 12px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: checked ? '#eef3ff' : 'transparent',
                        }}
                        data-testid="hk-netdisk-share-row"
                      >
                        {isEdit ? (
                          <Radio checked={checked} />
                        ) : (
                          <Checkbox checked={checked} onChange={(e) => onToggle(e.target.checked)} />
                        )}
                        <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
                        {s.error ? (
                          <Tag color="error">无权限</Tag>
                        ) : (
                          <>
                            <Tag color={s.readable ? 'blue' : 'default'}>{s.readable ? '可读' : '不可读'}</Tag>
                            <Tag color={s.writable ? 'green' : 'default'}>{s.writable ? '可写' : '只读'}</Tag>
                          </>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </Spin>

            {shareErr && <Alert style={{ marginTop: 12 }} type="error" showIcon message={shareErr} />}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <Button onClick={() => setStep(1)} disabled={saving}>
                上一步
              </Button>
              <Space>
                <Button onClick={onClose}>取消</Button>
                <Button
                  type="primary"
                  loading={saving}
                  disabled={selected.length === 0}
                  onClick={() => void handleSaveSMB()}
                  data-testid="hk-netdisk-save"
                >
                  保存（{selected.length} 个共享）
                </Button>
              </Space>
            </div>
          </div>
        )
      ) : (
        // ---------------- FTP / WebDAV 单步流程 ----------------
        <>
          <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 12 }}>
            <Form.Item
              name="name"
              label="显示名称"
              rules={[{ required: true, message: '请填写显示名称' }, { max: 50, message: '不超过 50 字' }]}
            >
              <Input placeholder="例如：家里 NAS / 公司文件服务器" maxLength={50} />
            </Form.Item>

            <Form.Item
              name="host"
              label={kind === 'webdav' ? 'WebDAV 地址' : '服务器 IP 或主机名'}
              rules={[{ required: true, message: kind === 'webdav' ? '请填写 WebDAV 地址' : '请填写服务器 IP 或主机名' }]}
              extra={kind === 'webdav' ? '形如 https://nas.example.com/dav 或 http://192.168.1.10:5005' : undefined}
            >
              <Input placeholder={kind === 'webdav' ? 'https://nas.example.com/dav' : '192.168.1.10 或 nas.local'} />
            </Form.Item>

            <Form.Item name="port" label="端口" rules={[{ type: 'number', min: 1, max: 65535, message: '端口范围 1–65535' }]}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请填写用户名' }]}>
              <Input placeholder={isEdit ? '已保存，如需修改请重新填写' : '留空表示匿名访问'} />
            </Form.Item>

            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: !isEdit, message: '请填写密码' }]}
              extra={isEdit ? '已保存，留空则不修改' : undefined}
            >
              <Input.Password placeholder={isEdit ? '已保存，留空则不修改' : '留空表示匿名访问'} autoComplete="new-password" />
            </Form.Item>

            {kind === 'ftp' && (
              <>
                <Form.Item name="mode" label="连接模式" extra="主动模式要求服务端能反向连回本机，NAT / 云主机下通常不可用，推荐被动模式">
                  <Radio.Group>
                    <Radio value="passive">被动（PASV）</Radio>
                    <Radio value="active" disabled>
                      主动（PORT，暂不支持）
                    </Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="encoding" label="字符编码" extra="中文文件名出现乱码时改用 GBK">
                  <Select options={FTP_ENCODINGS.map((e) => ({ value: e, label: e === 'utf-8' ? 'UTF-8' : 'GBK' }))} />
                </Form.Item>
              </>
            )}
          </Form>

          {testRes && (
            <Alert
              style={{ marginTop: 4 }}
              type={testRes.ok ? 'success' : 'error'}
              showIcon
              message={
                testRes.ok
                  ? `连接成功${testRes.count != null ? `，根目录可访问 ${testRes.count} 个条目` : ''}${
                      testRes.root_path ? `（${testRes.root_path}）` : ''
                    }`
                  : testRes.message || '连接失败'
              }
            />
          )}
          {error && !testRes && <Alert style={{ marginTop: 4 }} type="error" showIcon message={error} />}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <Button onClick={handleTest} loading={testing} data-testid="hk-netdisk-test">
              测试连接
            </Button>
            <Space>
              <Button onClick={onClose}>取消</Button>
              <Button
                type="primary"
                onClick={handleSave}
                loading={saving}
                disabled={!testOk}
                title={testOk ? undefined : '请先测试连接成功'}
                data-testid="hk-netdisk-save"
              >
                保存
              </Button>
            </Space>
          </div>
        </>
      )}
    </Modal>
  )
}
