import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Col, Empty, Form, Input, Modal, Popconfirm, Row, Select, Spin, message } from 'antd'
import { PlusOutlined, TeamOutlined } from '@ant-design/icons'
import { listBooks, createBook, deleteBook, updateBook } from '../api/books'
import BookCard from '../components/book/BookCard'
import type { BookWithCount, Visibility } from '../types'
import { COVER_COLORS, VISIBILITY_LABEL } from '../types'

interface EditState {
  mode: 'create' | 'edit'
  book?: BookWithCount
}

/** 书架页：高仿语雀卡片网格（我的 + 可见的公开/成员库） */
export default function BookshelfPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<{
    mine: BookWithCount[]
    visible: BookWithCount[]
    teams: BookWithCount[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [keyword, setKeyword] = useState('')

  async function refresh() {
    setLoading(true)
    try {
      const res = await listBooks()
      setData({ mine: res.mine || [], visible: res.visible || [], teams: res.teams || [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  function openCreate() {
    setEdit({ mode: 'create' })
    form.setFieldsValue({ name: '', description: '', cover_color: COVER_COLORS[0], visibility: 'private' })
  }

  function openEdit(book: BookWithCount) {
    setEdit({ mode: 'edit', book })
    form.setFieldsValue({
      name: book.name,
      description: book.description,
      cover_color: book.cover_color || COVER_COLORS[0],
      visibility: book.visibility,
    })
  }

  async function submit() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (edit?.mode === 'create') {
        await createBook(values)
        message.success('知识库已创建')
      } else if (edit?.book) {
        await updateBook(edit.book.id, { name: values.name, description: values.description, cover_color: values.cover_color })
        message.success('知识库已更新')
      }
      setEdit(null)
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(book: BookWithCount) {
    await deleteBook(book.id)
    message.success('知识库已删除（其下文档移入回收站逻辑归属库删除）')
    await refresh()
  }

  const filterFn = (b: BookWithCount) => !keyword || b.name.includes(keyword)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20, gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>书架</h2>
        <Input.Search
          placeholder="按名称过滤"
          allowClear
          style={{ width: 220 }}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div style={{ flex: 1 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建知识库
        </Button>
      </div>

      {loading && <Spin style={{ display: 'block', margin: '80px auto' }} />}

      {!loading && data && (
        <>
          <h3 style={{ color: '#5f6672', fontSize: 14 }}>我的知识库</h3>
          {data.mine.filter(filterFn).length === 0 ? (
            <Empty description="还没有知识库，点击右上角新建" style={{ margin: '32px 0' }} />
          ) : (
            <Row gutter={[16, 16]}>
              {data.mine.filter(filterFn).map((b) => (
                <Col key={b.id} xs={24} sm={12} md={8} lg={6} xl={6}>
                  <div
                    onContextMenu={(e) => {
                      e.preventDefault()
                      openEdit(b)
                    }}
                  >
                    <BookCard book={b} mine />
                  </div>
                </Col>
              ))}
            </Row>
          )}

          {data.visible.filter(filterFn).length > 0 && (
            <>
              <h3 style={{ color: '#5f6672', fontSize: 14, marginTop: 32 }}>成员 / 公开知识库</h3>
              <Row gutter={[16, 16]}>
                {data.visible.filter(filterFn).map((b) => (
                  <Col key={b.id} xs={24} sm={12} md={8} lg={6} xl={6}>
                    <BookCard book={b} mine={false} />
                  </Col>
                ))}
              </Row>
            </>
          )}
        </>
      )}

      {/* 新建 / 编辑弹窗 */}
      <Modal
        title={edit?.mode === 'create' ? '新建知识库' : '编辑知识库'}
        open={!!edit}
        onOk={() => void submit()}
        onCancel={() => setEdit(null)}
        confirmLoading={saving}
        okText={edit?.mode === 'create' ? '创建' : '保存'}
        cancelText="取消"
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="封面色" name="cover_color">
            <Select
              options={COVER_COLORS.map((c) => ({ value: c, label: c }))}
              optionRender={(opt) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 4, background: opt.value as string }} />
                  {opt.value}
                </div>
              )}
            />
          </Form.Item>
          <Form.Item
            label="知识库名称"
            name="name"
            rules={[{ required: true, message: '请输入名称' }, { max: 128, message: '名称过长' }]}
          >
            <Input placeholder="例如：产品技术文档" />
          </Form.Item>
          <Form.Item label="简介" name="description">
            <Input.TextArea rows={2} placeholder="一句话介绍这个知识库（可选）" maxLength={512} />
          </Form.Item>
          {edit?.mode === 'create' && (
            <Form.Item label="可见性" name="visibility">
              <Select
                options={(['private', 'members', 'public'] as Visibility[]).map((v) => ({ value: v, label: VISIBILITY_LABEL[v] }))}
              />
            </Form.Item>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {edit?.mode === 'edit' && edit.book ? (
              <Popconfirm
                title="删除后其下文档一并移入回收站，确定删除？"
                okText="删除"
                okType="danger"
                cancelText="取消"
                onConfirm={() => void handleDelete(edit.book!)}
              >
                <Button danger>删除知识库</Button>
              </Popconfirm>
            ) : (
              <span />
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => setEdit(null)}>取消</Button>
              <Button type="primary" loading={saving} onClick={() => void submit()}>
                {edit?.mode === 'create' ? '创建' : '保存'}
              </Button>
            </div>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
