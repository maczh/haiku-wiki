import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  List,
  Progress,
  Radio,
  Space,
  Switch,
  Typography,
  message,
} from 'antd'
import { DatabaseOutlined } from '@ant-design/icons'
import {
  migrateDatabase,
  migrateStatus,
  testDatabaseConnection,
} from '../api/admin'
import type { MigrateStatus } from '../types'

/**
 * 数据库迁移（SQLite ↔ MySQL，仅管理员）。
 * 流程：填写目标连接 → 测试连接 → 开始迁移（异步）→ 轮询进度 → 完成后若切换则服务重启。
 */
export default function DatabaseMigrationPage() {
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<MigrateStatus | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const driver = Form.useWatch('driver', form)

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
      await testDatabaseConnection(values)
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
      await migrateDatabase(values)
      startPolling()
    } catch {
      setRunning(false)
    }
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <DatabaseOutlined /> 数据库迁移
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        将当前数据库的全部数据复制到目标数据库。建议先在下方「测试连接」确认目标可达，再开始迁移。
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" disabled={running}>
          <Form.Item name="driver" label="目标数据库类型" initialValue="sqlite" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="sqlite">SQLite</Radio>
              <Radio value="mysql">MySQL</Radio>
            </Radio.Group>
          </Form.Item>
          {driver === 'mysql' ? (
            <Space size={16} wrap>
              <Form.Item name="host" label="主机" rules={[{ required: true }]} initialValue="127.0.0.1">
                <Input style={{ width: 180 }} />
              </Form.Item>
              <Form.Item name="port" label="端口" initialValue={3306} rules={[{ required: true }]}>
                <InputNumber style={{ width: 120 }} min={1} max={65535} />
              </Form.Item>
              <Form.Item name="user" label="用户名" rules={[{ required: true }]}>
                <Input style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="password" label="密码">
                <Input.Password style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="name" label="库名" rules={[{ required: true }]}>
                <Input style={{ width: 180 }} placeholder="haiku_wiki" />
              </Form.Item>
            </Space>
          ) : (
            <Form.Item name="dsn" label="SQLite 文件路径" rules={[{ required: true }]} initialValue="./data/haiku.db">
              <Input style={{ width: 320 }} />
            </Form.Item>
          )}
          <Form.Item name="switch" label="迁移成功后切换到新数据库" valuePropName="checked" initialValue={true}>
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
          {status.switched && <Alert style={{ marginTop: 8 }} type="info" showIcon message="已切换到新数据库" />}
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
