import { useEffect, useRef, useState } from 'react'
import { Form, Input, Modal, message } from 'antd'
import { createDoc, getDoc } from '../../api/docs'
import { cloneTodoContent } from '../../lib/todo'
import type { DocDetail, DocNode } from '../../types'

interface Props {
  source: DocNode | null
  getCurrentContent: (docId: number) => string | undefined
  onClose: () => void
  onCreated: (doc: DocDetail) => void
}

/** 编辑器「另存为」与目录树「复制」共用；在原目录创建一份独立的待办清单。 */
export default function TodoCopyDialog({ source, getCurrentContent, onClose, onCreated }: Props) {
  const [form] = Form.useForm<{ title: string }>()
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)

  useEffect(() => {
    if (source) form.setFieldsValue({ title: `${source.title} 副本`.slice(0, 255) })
  }, [source, form])

  async function submit() {
    if (!source || submitting.current) return
    let values: { title: string }
    try {
      values = await form.validateFields()
    } catch {
      form.getFieldInstance('title')?.focus()
      return
    }
    if (submitting.current) return
    submitting.current = true
    setSaving(true)
    try {
      // 确认时读取编辑器草稿，避免 3 秒自动保存尚未触发时遗漏最新修改。
      const draft = getCurrentContent(source.id)
      const { doc } = await getDoc(source.id)
      const content = cloneTodoContent(draft ?? doc.content)
      const copy = await createDoc(doc.book_id, doc.parent_id, values.title.trim(), 'todo', content)
      message.success(`已复制为「${copy.title}」`)
      onCreated(copy)
    } catch {
      // API 拦截器提示请求失败；解析错误在此提示，保留名称以便重试。
      message.error('复制待办清单失败，请检查内容和权限后重试')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      title="另存为待办清单"
      open={source !== null}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="创建副本并编辑"
      cancelText="取消"
      confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      destroyOnClose
    >
      <p>在原目录复制全部待办及其负责人、项目、进度和备注，创建后打开新清单进行编辑。</p>
      <Form form={form} layout="vertical" onFinish={() => void submit()}>
        <Form.Item name="title" label="新清单名称" rules={[{ required: true, whitespace: true, message: '请输入新清单名称' }]}>
          <Input name="todo-copy-title" autoComplete="off" maxLength={255} placeholder="例如：本周工作待办…" disabled={saving} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
