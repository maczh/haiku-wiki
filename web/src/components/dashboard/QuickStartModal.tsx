import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select, Typography, message } from 'antd'
import { createDoc } from '../../api/docs'
import { defaultTitleOf, firstWritableBook } from '../../lib/dashboard'
import { DOC_TYPE_LABEL, DOC_TYPES, type BookWithCount, type DocType } from '../../types'

export type QuickStartMode = 'doc' | 'import-file' | 'import-url'

interface Props {
  open: boolean
  mode: QuickStartMode
  /** 候选知识库（书架里可写的排前面） */
  books: BookWithCount[]
  defaultBookId?: number
  onClose: () => void
  /** mode='doc'：创建成功后回调 */
  onCreated: (bookId: number, docId: number) => void
  /** mode='import-*'：选好目标知识库后回调 */
  onPickBook: (bookId: number) => void
}

const TITLE: Record<QuickStartMode, string> = {
  doc: '快捷新建文档',
  'import-file': '导入文件 · 选择目标知识库',
  'import-url': '导入网页 · 选择目标知识库',
}

const HINT: Record<QuickStartMode, string> = {
  doc: '选好知识库与类型，创建后会直接进入编辑页。',
  'import-file': '文件将导入到所选知识库的根目录，随后可自由拖动层级。',
  'import-url': '服务端抓取网页正文并转为 Markdown 文档（带 SSRF 防护，不能抓内网地址）。',
}

/**
 * 首页快捷操作的统一弹窗：
 *  · mode='doc'        —— 选库 + 类型 + 标题，直接创建并跳转编辑；
 *  · mode='import-*'   —— 只选目标知识库，确定后由父组件带参数跳转到知识库页并自动打开导入对话框。
 *
 * 默认目标库用 firstWritableBook 挑选（首选可写、避开默认只读的公司知识库），
 * 避免用户点「新建文档」落到一个自己没有写权限的库里再被后端拒绝。
 */
export default function QuickStartModal({
  open,
  mode,
  books,
  defaultBookId,
  onClose,
  onCreated,
  onPickBook,
}: Props) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const preferred = defaultBookId || firstWritableBook(books)?.id
    form.setFieldsValue({
      book_id: preferred,
      doc_type: 'markdown' as DocType,
      title: defaultTitleOf('markdown'),
    })
  }, [open, defaultBookId, books, form])

  const options = books.map((b) => ({
    value: b.id,
    label: `${b.name}${b.can_write === false ? '（只读）' : ''}`,
  }))

  async function submit() {
    const values = await form.validateFields()
    if (mode !== 'doc') {
      onPickBook(values.book_id as number)
      onClose()
      return
    }
    setSaving(true)
    try {
      const doc = await createDoc(values.book_id as number, 0, (values.title as string)?.trim() || defaultTitleOf(values.doc_type), values.doc_type)
      message.success('文档已创建')
      onClose()
      onCreated(values.book_id as number, doc.id)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={TITLE[mode]}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={saving}
      okText={mode === 'doc' ? '创建并编辑' : '下一步'}
      cancelText="取消"
      destroyOnClose
      width={460}
      data-testid="hk-quick-modal"
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
        {HINT[mode]}
      </Typography.Paragraph>
      <Form form={form} layout="vertical">
        <Form.Item label="知识库" name="book_id" rules={[{ required: true, message: '请选择知识库' }]}>
          <Select
            placeholder={options.length === 0 ? '还没有知识库，请先新建' : '请选择知识库'}
            options={options}
            disabled={options.length === 0}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        {mode === 'doc' && (
          <>
            <Form.Item label="文档类型" name="doc_type">
              <Select options={DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABEL[t] }))} />
            </Form.Item>
            <Form.Item label="文档名称" name="title" rules={[{ max: 128, message: '名称过长' }]}>
              <Input placeholder="未命名文档" />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  )
}
