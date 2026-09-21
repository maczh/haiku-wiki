import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select, Tag, Typography, message } from 'antd'
import { createDoc, getTree } from '../../api/docs'
import { defaultTitleOf, firstWritableBook } from '../../lib/dashboard'
import { PICK_BOOK_FIRST, ROOT_DIR_VALUE, buildDirOptions, withRootDir, type DirOption } from '../../lib/dirOptions'
import type { DocTemplate } from '../../api/templates'
import { DOC_TYPE_LABEL, DOC_TYPES, type BookWithCount, type DocType } from '../../types'

export type QuickStartMode = 'doc' | 'import-file' | 'import-url'

interface Props {
  open: boolean
  mode: QuickStartMode
  /** 候选知识库（书架里可写的排前面） */
  books: BookWithCount[]
  defaultBookId?: number
  /**
   * 从「常用模板」板块进入时带上的模板：类型与默认标题由此决定，正文直接落进新文档。
   * 不传就是原来的空白文档流程。
   */
  template?: DocTemplate | null
  onClose: () => void
  /** mode='doc'：创建成功后回调 */
  onCreated: (bookId: number, docId: number) => void
  /** mode='import-*'：选好目标知识库与目录后回调（parentId=0 表示知识库顶层） */
  onPickBook: (bookId: number, parentId: number) => void
}

const TITLE: Record<QuickStartMode, string> = {
  doc: '快捷新建文档',
  'import-file': '导入文件 · 选择目标知识库',
  'import-url': '导入网页 · 选择目标知识库',
}

const HINT: Record<QuickStartMode, string> = {
  doc: '选好知识库、目录与类型，创建后会直接进入编辑页。',
  'import-file': '文件将导入到所选目录，随后可自由拖动层级。',
  'import-url': '服务端抓取网页正文并转为 Markdown 文档（带 SSRF 防护，不能抓内网地址）。',
}

/**
 * 首页快捷操作的统一弹窗：
 *  · mode='doc'        —— 选库 + 目录 + 类型 + 标题，直接创建并跳转编辑；
 *  · mode='import-*'   —— 只选目标知识库与目录，确定后由父组件带参数跳转到知识库页并自动打开导入对话框。
 *
 * 默认目标库用 firstWritableBook 挑选（首选可写、避开默认只读的公司知识库），
 * 避免用户点「新建文档」落到一个自己没有写权限的库里再被后端拒绝。
 */
export default function QuickStartModal({
  open,
  mode,
  books,
  defaultBookId,
  template = null,
  onClose,
  onCreated,
  onPickBook,
}: Props) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  // 目录下拉在选中知识库后才有内容；切换知识库要重新拉树并回落根目录
  const [dirOptions, setDirOptions] = useState<DirOption[]>([])
  const [dirLoading, setDirLoading] = useState(false)
  const [dirDisabled, setDirDisabled] = useState(true)

  useEffect(() => {
    if (!open) return
    const preferred = defaultBookId || firstWritableBook(books)?.id
    // 带模板进来：类型与默认标题都取自模板，用户仍可改标题
    const docType = (template?.doc_type ?? 'markdown') as DocType
    form.setFieldsValue({
      book_id: preferred,
      doc_type: docType,
      title: template?.title || defaultTitleOf(docType),
      parent_id: ROOT_DIR_VALUE,
    })
  }, [open, defaultBookId, books, template, form])

  // 打开时若已预选知识库，目录下拉也要跟上（否则用户看到的是禁用空框）
  useEffect(() => {
    if (!open) return
    const preferred = form.getFieldValue('book_id') as number | undefined
    if (preferred) void loadDirs(preferred)
    else {
      setDirOptions(withRootDir([]))
      setDirDisabled(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function loadDirs(bookId: number) {
    setDirDisabled(false)
    setDirLoading(true)
    try {
      const docs = await getTree(bookId)
      setDirOptions(withRootDir(buildDirOptions(docs)))
    } catch {
      setDirOptions(withRootDir([]))
    } finally {
      setDirLoading(false)
    }
  }

  function onBookChange(bookId: number) {
    // 换库后原来的 parent_id 一定无效，必须回落根目录
    form.setFieldsValue({ parent_id: ROOT_DIR_VALUE })
    void loadDirs(bookId)
  }

  const options = books.map((b) => ({
    value: b.id,
    label: `${b.name}${b.can_write === false ? '（只读）' : ''}`,
  }))

  async function submit() {
    const values = await form.validateFields()
    const parentId = (values.parent_id as number) || ROOT_DIR_VALUE
    if (mode !== 'doc') {
      onPickBook(values.book_id as number, parentId)
      onClose()
      return
    }
    setSaving(true)
    try {
      const doc = await createDoc(
        values.book_id as number,
        parentId,
        (values.title as string)?.trim() || defaultTitleOf(values.doc_type),
        values.doc_type,
        template?.content, // 模板正文：与模板中心/新建文档里的画廊同一份数据
      )
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
        {template ? (
          <span>
            已选模板
            <Tag bordered={false} color="blue" style={{ margin: '0 6px' }}>
              {template.name}
            </Tag>
            （{DOC_TYPE_LABEL[template.doc_type] ?? template.doc_type}）·
            选好知识库与目录即可创建，正文来自模板，创建后可直接改。
          </span>
        ) : (
          HINT[mode]
        )}
      </Typography.Paragraph>
      <Form form={form} layout="vertical">
        <Form.Item label="知识库" name="book_id" rules={[{ required: true, message: '请选择知识库' }]}>
          <Select
            placeholder={options.length === 0 ? '还没有知识库，请先新建' : '请选择知识库'}
            options={options}
            disabled={options.length === 0}
            onChange={onBookChange}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item label="目录（存放位置）" name="parent_id">
          <Select
            data-testid="hk-quick-parent"
            placeholder={dirDisabled ? PICK_BOOK_FIRST : '根目录（知识库顶层）'}
            options={dirOptions}
            disabled={dirDisabled}
            loading={dirLoading}
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
