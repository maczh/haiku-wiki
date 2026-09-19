import { useEffect, useState } from 'react'
import { Button, Col, Empty, Form, Input, Modal, Popconfirm, Row, Select, Skeleton, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { listBooks, createBook, deleteBook, updateBook } from '../../api/books'
import BookCard from './BookCard'
import type { BookWithCount, Bookshelf, Visibility } from '../../types'
import { COVER_COLORS, VISIBILITY_LABEL } from '../../types'

interface EditState {
  mode: 'create' | 'edit'
  book?: BookWithCount
}

interface Props {
  /** 数据加载完成回调（首页用它做统计、给快捷新建提供候选知识库） */
  onLoaded?: (data: Bookshelf) => void
  /**
   * 外部触发新建知识库：数字自增即打开新建弹窗。
   * 用「信号」而不是回调，是为了让首页快捷操作与书架内部的按钮完全等价
   * （同一套表单与校验，不会出现两条创建路径行为不一致）。
   */
  createSignal?: number
}

/**
 * 书架分区：我的知识库 / 团队知识库 / 公司知识库三类入口。
 *
 * 从原 BookshelfPage 抽出，供首页 Dashboard 复用 —— 首页不再是一个独立页面，
 * 而是「欢迎 + 快捷操作 + 向导/视频 + 最近更新 + 书架」的组合，
 * 书架的数据加载与增删改逻辑仍集中在这一处。
 */
export default function BookshelfSection({ onLoaded, createSignal = 0 }: Props) {
  const [data, setData] = useState<Bookshelf | null>(null)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [keyword, setKeyword] = useState('')

  async function refresh() {
    setLoading(true)
    try {
      const res = await listBooks()
      const next: Bookshelf = { mine: res.mine || [], visible: res.visible || [], teams: res.teams || [] }
      setData(next)
      onLoaded?.(next)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 首页快捷操作「新建知识库」：信号变化即打开同一套新建弹窗
  useEffect(() => {
    if (createSignal > 0) openCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSignal])

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
    message.success('知识库已删除（其下文档一并移入回收站）')
    await refresh()
  }

  const filterFn = (b: BookWithCount) => !keyword || b.name.includes(keyword)
  const groups: { key: string; title: string; list: BookWithCount[]; mine: boolean }[] = data
    ? [
        { key: 'mine', title: '我的知识库', list: data.mine.filter(filterFn), mine: true },
        { key: 'teams', title: '团队知识库', list: data.teams.filter(filterFn), mine: false },
        { key: 'visible', title: '公司知识库', list: data.visible.filter(filterFn), mine: false },
      ]
    : []

  return (
    <div data-testid="hk-bookshelf">
      <div className="hk-dash-section-head">
        <h3 className="hk-dash-section-title">书架</h3>
        <Input.Search
          placeholder="按名称过滤"
          allowClear
          size="small"
          style={{ width: 200, marginLeft: 8 }}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="hk-dash-section-extra" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button size="small" type="primary" icon={<PlusOutlined />} data-testid="hk-bookshelf-create" onClick={openCreate}>
            新建知识库
          </Button>
        </div>
      </div>

      {loading && <Skeleton active paragraph={{ rows: 3 }} />}

      {!loading &&
        groups.map((g) => (
          <div key={g.key} style={{ marginBottom: 20 }}>
            <h4 style={{ color: '#5f6672', fontSize: 13, fontWeight: 600, margin: '0 0 10px' }}>
              {g.title}
              <span style={{ marginLeft: 6, color: '#b6bcc8', fontWeight: 400 }}>{g.list.length}</span>
            </h4>
            {g.list.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span style={{ fontSize: 12, color: '#8a919f' }}>
                    {g.key === 'mine' ? '还没有知识库，点击右上角新建' : '暂时没有这一类知识库'}
                  </span>
                }
                style={{ margin: '12px 0' }}
              />
            ) : (
              <Row gutter={[16, 16]}>
                {g.list.map((b) => (
                  <Col key={b.id} xs={24} sm={12} md={8} lg={6} xl={6}>
                    <div
                      onContextMenu={(e) => {
                        e.preventDefault()
                        openEdit(b)
                      }}
                    >
                      <BookCard book={b} mine={g.mine} />
                    </div>
                  </Col>
                ))}
              </Row>
            )}
          </div>
        ))}

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
