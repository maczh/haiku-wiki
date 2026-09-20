import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  List,
  Progress,
  Radio,
  Space,
  Switch,
  Typography,
  message,
} from 'antd'
import { CloudOutlined } from '@ant-design/icons'
import { migrateStatus, migrateStorage, testStorageConnection } from '../api/admin'
import type { MigrateStatus } from '../types'

/**
 * 存储迁移（local ↔ S3，仅管理员）。
 * 流程与数据库迁移一致：填写目标 → 测试连接 → 开始迁移 → 轮询进度 → 完成后若切换则服务重启。
 */
export default function StorageMigrationPage() {
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<MigrateStatus | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stType = Form.useWatch('type', form)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  function startPolling() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(async () => {
      try {
        const res = await migrateStatus()
        const job = res.job
        setStatus(job)
        if (job.status === 'done' || job.status === 'failed') {
          if (timerRef.current) clearInterval(timerRef.current)
          timerRef.current = null
          setRunning(false)
          if (job.status === 'done') {
            message.success(job.switched ? '迁移完成，服务重启中…' : '迁移完成')
          } else {
            message.error('迁移失败：' + job.message)
          }
        }
      } catch {
        /* 服务重启中，连接会暂时失败，继续轮询 */
      }
    }, 1000)
  }

  async function handleTest() {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setTesting(true)
    try {
      await testStorageConnection(values)
      message.success('连接测试成功')
    } catch {
      /* 拦截器已提示 */
    } finally {
      setTesting(false)
    }
  }

  async function handleStart() {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setRunning(true)
    setStatus(null)
    try {
      await migrateStorage(values)
      startPolling()
    } catch {
      setRunning(false)
    }
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <CloudOutlined /> 存储迁移
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        将当前存储（uploads 业务文件）复制到目标存储。建议先「测试连接」确认目标可写，再开始迁移。
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" disabled={running}>
          <Form.Item name="type" label="目标存储类型" initialValue="local" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="local">本地磁盘</Radio>
              <Radio value="s3">S3 对象存储</Radio>
            </Radio.Group>
          </Form.Item>
          {stType === 's3' ? (
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
              <Form.Item name="local_dir" label="本地数据目录（S3 模式也用于存放 SQLite 与临时文件）">
                <Input style={{ width: 280 }} placeholder="./data" />
              </Form.Item>
            </Space>
          ) : (
            <Form.Item name="local_dir" label="本地存储根目录" initialValue="./data" rules={[{ required: true }]}>
              <Input style={{ width: 320 }} />
            </Form.Item>
          )}
          <Form.Item name="switch" label="迁移成功后切换到新存储" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
          <Space>
            <Button onClick={() => void handleTest()} loading={testing} disabled={running}>
              测试连接
            </Button>
            <Button type="primary" onClick={() => void handleStart()} loading={running} disabled={testing}>
              开始迁移
            </Button>
          </Space>
        </Form>
      </Card>

      {status && (
        <Card size="small" title="迁移进度">
          <Progress
            percent={status.total > 0 ? Math.round((status.done / status.total) * 100) : status.status === 'done' ? 100 : 0}
            status={status.status === 'failed' ? 'exception' : status.status === 'done' ? 'success' : 'active'}
          />
          <Typography.Text type="secondary">
            已完成 {status.done} / {status.total}
            {status.skipped > 0 ? `（跳过 ${status.skipped}）` : ''}
            {status.failed > 0 ? `（失败 ${status.failed}）` : ''}
          </Typography.Text>
          {status.switched && <Alert style={{ marginTop: 8 }} type="info" showIcon message="已切换到新存储" />}
          <List
            size="small"
            style={{ marginTop: 8, maxHeight: 260, overflow: 'auto' }}
            dataSource={[status.message].filter(Boolean)}
            locale={{ emptyText: '暂无明细' }}
            renderItem={(m) => <List.Item>{m}</List.Item>}
          />
        </Card>
      )}
    </div>
  )
}
