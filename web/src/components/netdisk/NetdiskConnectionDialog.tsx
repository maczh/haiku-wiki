/**
 * NAS / WebDAV 连接配置对话框（SMB / FTP / WebDAV 共用一套骨架，按 kind 显隐字段）。
 *
 * 硬性交互（PRD §4.3 / §4.4）：**先测试连接，通过后才允许保存**。
 * 测试的是「即将保存的这套配置」，与后端 POST /api/netdisks/test 对齐。
 */

import { useEffect, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Modal, Radio, Select, Space } from 'antd'
import { ApiError } from '../../api/request'
import {
  createConnection,
  testUnsaved,
  updateConnection,
} from '../../api/netdisk'
import type { NetdiskConnection, NetdiskConnectionInput, NetdiskKind, NetdiskTestResult } from '../../types'
import { FTP_ENCODINGS, FTP_MODES } from '../../lib/netdisk/constants'

interface Props {
  open: boolean
  kind: NetdiskKind
  /** 编辑态：传入已有连接 */
  editing?: NetdiskConnection | null
  onClose: () => void
  /** 保存成功（后端回传新连接） */
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
  const [form] = Form.useForm<FormValues>()
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testRes, setTestRes] = useState<NetdiskTestResult | null>(null)
  const [error, setError] = useState('')

  const meta = KIND_META[kind] || KIND_META.smb
  const isEdit = Boolean(editing)

  // 打开时重置表单：新建用协议默认值，编辑回填已有值（密码不回填）
  useEffect(() => {
    if (!open) return
    setTestRes(null)
    setError('')
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
  function buildInput(v: FormValues): NetdiskConnectionInput {
    const input: NetdiskConnectionInput = { name: v.name.trim(), kind }
    // 逐字段下发：空串 / undefined 一律跳过（编辑态「留空 = 不修改」靠这个实现）
    const put = <K extends keyof NetdiskConnectionInput>(key: K, val: NetdiskConnectionInput[K] | undefined) => {
      if (val === undefined || val === null) return
      if (typeof val === 'string' && val.trim() === '') return
      input[key] = val
    }
    put('host', v.host?.trim())
    put('port', v.port)
    put('share', v.share?.trim())
    put('domain', v.domain?.trim())
    put('username', v.username?.trim())
    put('mode', v.mode)
    put('encoding', v.encoding)
    // 密码：编辑态留空 = 不修改；新建态必填
    put('password', v.password)
    return input
  }

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
      width={520}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
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
      }
      destroyOnClose
    >
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

        {kind === 'smb' && (
          <Form.Item
            name="share"
            label="共享名（share）"
            rules={[{ required: true, message: '请填写共享名，如 share / homes / public' }]}
            extra="SMB 必须指定要挂载的共享目录"
          >
            <Input placeholder="share" />
          </Form.Item>
        )}

        {kind === 'smb' && (
          <Form.Item name="domain" label="域（domain，可选）">
            <Input placeholder="WORKGROUP 或 AD 域名" />
          </Form.Item>
        )}

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
      {error && !testRes && (
        <Alert style={{ marginTop: 4 }} type="error" showIcon message={error} />
      )}
    </Modal>
  )
}
