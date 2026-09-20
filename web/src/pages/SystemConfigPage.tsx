import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Spin,
  Typography,
  message,
} from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import { getSystemConfig, saveSystemConfig } from '../api/admin'
import { me } from '../api/auth'
import type { SystemConfig } from '../types'

/**
 * 系统配置（仅管理员）。
 * 读取 application.yml 的可编辑项，提交后后端写回文件并重启使配置生效；
 * 前端显示「服务重启中」遮罩，轮询 /api/auth/me 探测服务恢复后整页刷新。
 */
export default function SystemConfigPage() {
  const [form] = Form.useForm<SystemConfig>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const dbDriver = Form.useWatch('database.driver', form)
  const storageType = Form.useWatch('storage.type', form)

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await getSystemConfig()
        form.setFieldsValue(cfg)
      } catch {
        /* 拦截器已提示 */
      } finally {
        setLoading(false)
      }
    })()
  }, [form])

  // 轮询探测服务是否重启完成（连接恢复即 reload）
  useEffect(() => {
    if (!restarting) return
    let timer: ReturnType<typeof setTimeout>
    let alive = true
    const poll = async () => {
      try {
        await me()
        if (!alive) return
        message.success('服务已重启，正在刷新…')
        window.location.reload()
        return
      } catch {
        timer = setTimeout(poll, 1500)
      }
    }
    poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [restarting])

  async function handleSave() {
    let values: SystemConfig
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      await saveSystemConfig(values)
      setRestarting(true)
    } catch {
      /* 拦截器已提示 */
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24, position: 'relative' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <SettingOutlined /> 系统配置
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        修改后点击「保存」，后端会写回配置文件并自动重启使配置生效（约 1~2 秒）。
      </Typography.Paragraph>

      <Spin spinning={loading}>
        <Form<SystemConfig> form={form} layout="vertical" disabled={loading || restarting} size="middle">
          <Card size="small" title="服务" style={{ marginBottom: 16 }}>
            <Space size={16} wrap>
              <Form.Item name={['server', 'port']} label="监听端口" rules={[{ required: true, message: '必填' }]}>
                <Input style={{ width: 160 }} placeholder="8080" />
              </Form.Item>
              <Form.Item name={['server', 'mode']} label="运行模式" rules={[{ required: true }]}>
                <Select
                  style={{ width: 160 }}
                  options={[
                    { value: 'debug', label: 'debug' },
                    { value: 'release', label: 'release' },
                  ]}
                />
              </Form.Item>
            </Space>
          </Card>

          <Card size="small" title="JWT" style={{ marginBottom: 16 }}>
            <Form.Item name={['jwt', 'secret']} label="签名密钥" rules={[{ required: true, message: '必填' }]}>
              <Input.Password placeholder="生产环境请修改为强密钥" />
            </Form.Item>
          </Card>

          <Card size="small" title="数据库" style={{ marginBottom: 16 }}>
            <Form.Item name={['database', 'driver']} label="数据库类型" rules={[{ required: true }]}>
              <Radio.Group>
                <Radio value="sqlite">SQLite</Radio>
                <Radio value="mysql">MySQL</Radio>
              </Radio.Group>
            </Form.Item>
            {dbDriver === 'mysql' ? (
              <Space size={16} wrap>
                <Form.Item name={['database', 'host']} label="主机" rules={[{ required: true, message: '必填' }]}>
                  <Input style={{ width: 180 }} placeholder="127.0.0.1" />
                </Form.Item>
                <Form.Item name={['database', 'port']} label="端口" rules={[{ required: true }]}>
                  <InputNumber style={{ width: 120 }} min={1} max={65535} placeholder="3306" />
                </Form.Item>
                <Form.Item name={['database', 'user']} label="用户名" rules={[{ required: true }]}>
                  <Input style={{ width: 160 }} />
                </Form.Item>
                <Form.Item name={['database', 'password']} label="密码">
                  <Input.Password style={{ width: 200 }} />
                </Form.Item>
                <Form.Item name={['database', 'name']} label="库名" rules={[{ required: true }]}>
                  <Input style={{ width: 180 }} placeholder="haiku_wiki" />
                </Form.Item>
              </Space>
            ) : (
              <Form.Item name={['database', 'dsn']} label="SQLite 文件路径" rules={[{ required: true, message: '必填' }]}>
                <Input placeholder="./data/haiku.db" />
              </Form.Item>
            )}
          </Card>

          <Card size="small" title="存储" style={{ marginBottom: 16 }}>
            <Form.Item name={['storage', 'type']} label="存储类型" rules={[{ required: true }]}>
              <Radio.Group>
                <Radio value="local">本地磁盘</Radio>
                <Radio value="s3">S3 对象存储</Radio>
              </Radio.Group>
            </Form.Item>
            {storageType === 's3' ? (
              <Space size={16} wrap>
                <Form.Item name={['s3', 'endpoint']} label="Endpoint" rules={[{ required: true }]}>
                  <Input style={{ width: 280 }} placeholder="http://minio:9000" />
                </Form.Item>
                <Form.Item name={['s3', 'region']} label="Region">
                  <Input style={{ width: 160 }} placeholder="ap-guangzhou" />
                </Form.Item>
                <Form.Item name={['s3', 'bucket']} label="Bucket" rules={[{ required: true }]}>
                  <Input style={{ width: 200 }} />
                </Form.Item>
                <Form.Item name={['s3', 'access_key']} label="AccessKey">
                  <Input style={{ width: 220 }} />
                </Form.Item>
                <Form.Item name={['s3', 'secret_key']} label="SecretKey">
                  <Input.Password style={{ width: 240 }} />
                </Form.Item>
                <Form.Item name={['s3', 'prefix']} label="前缀">
                  <Input style={{ width: 160 }} placeholder="haiku/" />
                </Form.Item>
                <Form.Item name={['s3', 'force_path_style']} label="Path Style">
                  <Radio.Group>
                    <Radio value={true}>true</Radio>
                    <Radio value={false}>false</Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name={['s3', 'public_read']} label="公开读">
                  <Radio.Group>
                    <Radio value={true}>true</Radio>
                    <Radio value={false}>false</Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name={['s3', 'presign_ttl']} label="预签名有效期(分)">
                  <InputNumber style={{ width: 140 }} min={0} />
                </Form.Item>
                <Divider style={{ margin: '4px 0' }} />
                <Form.Item name={['storage', 'local_dir']} label="本地数据目录（仍作为 SQLite 与临时文件根）">
                  <Input style={{ width: 280 }} placeholder="./data" />
                </Form.Item>
              </Space>
            ) : (
              <Form.Item name={['storage', 'local_dir']} label="本地存储根目录" rules={[{ required: true }]}>
                <Input style={{ width: 320 }} placeholder="./data" />
              </Form.Item>
            )}
          </Card>

          <Card size="small" title="上传" style={{ marginBottom: 16 }}>
            <Form.Item name={['upload', 'max_size_mb']} label="单文件上限 (MB)" rules={[{ required: true }]}>
              <InputNumber style={{ width: 160 }} min={1} max={1024} />
            </Form.Item>
          </Card>

          <Button type="primary" loading={saving} onClick={() => void handleSave()}>
            保存并重启
          </Button>
        </Form>
      </Spin>

      {restarting && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(255,255,255,0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            zIndex: 1000,
          }}
        >
          <Spin size="large" />
          <Typography.Text>配置已保存，服务重启中…</Typography.Text>
        </div>
      )}
    </div>
  )
}
