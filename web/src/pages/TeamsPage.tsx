import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Col, Empty, Form, Input, Modal, Row, Spin, Tag, Typography, message } from 'antd'
import { PlusOutlined, TeamOutlined } from '@ant-design/icons'
import { createTeam, listTeams } from '../api/teams'
import type { TeamWithCount } from '../types'

/**
 * 团队列表页（/teams）。
 *
 * 任何登录用户都能创建团队：创建者自动成为团队管理员，后端同时自动建一个团队文库。
 * 列表只返回「我参与（创建或已加入）」的团队。
 */
export default function TeamsPage() {
  const navigate = useNavigate()
  const [teams, setTeams] = useState<TeamWithCount[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listTeams()
      setTeams(list || [])
    } catch {
      setTeams([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function submitCreate() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const t = await createTeam({ name: values.name.trim(), description: values.description?.trim() })
      message.success('团队已创建，并自动生成了一个团队文库')
      setCreateOpen(false)
      form.resetFields()
      await refresh()
      navigate(`/teams/${t.id}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <TeamOutlined /> 团队
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields()
            setCreateOpen(true)
          }}
        >
          新建团队
        </Button>
      </div>

      {loading && <Spin style={{ display: 'block', margin: '80px auto' }} />}

      {!loading && teams && teams.length === 0 && (
        <Empty description="还没有团队，点击右上角「新建团队」创建">
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建团队
          </Button>
        </Empty>
      )}

      {!loading && teams && teams.length > 0 && (
        <Row gutter={[16, 16]}>
          {teams.map((t) => (
            <Col key={t.id} xs={24} sm={12} md={8} lg={6}>
              <Card
                size="small"
                hoverable
                onClick={() => navigate(`/teams/${t.id}`)}
                style={{ height: '100%' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TeamOutlined style={{ color: '#2f54eb', fontSize: 18 }} />
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.name}
                  </div>
                </div>
                <div
                  style={{
                    color: '#8a919f',
                    fontSize: 12,
                    marginTop: 8,
                    minHeight: 32,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {t.description || '暂无简介'}
                </div>
                <div style={{ marginTop: 8 }}>
                  <Tag color="blue">{t.book_count} 个团队文库</Tag>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title="新建团队"
        open={createOpen}
        onOk={() => void submitCreate()}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={saving}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="团队名称"
            name="name"
            rules={[{ required: true, message: '请输入团队名称' }, { max: 128, message: '名称过长' }]}
          >
            <Input placeholder="例如：产品研发组" autoFocus />
          </Form.Item>
          <Form.Item label="团队简介" name="description">
            <Input.TextArea rows={3} placeholder="一句话介绍这个团队（可选）" maxLength={512} />
          </Form.Item>
        </Form>
        <div style={{ color: '#8a919f', fontSize: 12 }}>
          创建后你将成为该团队管理员，系统会自动创建一个团队文库。
        </div>
      </Modal>
    </div>
  )
}
