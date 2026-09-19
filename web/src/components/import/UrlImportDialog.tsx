import { useEffect, useState } from 'react'
import { Alert, Input, Modal, Select, message } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import { importUrl } from '../../api/docs'
import { listBooks } from '../../api/books'

interface Props {
  open: boolean
  onClose: () => void
  /** 默认目标知识库（当前所在库） */
  defaultBookId: number
  /** 导入目标目录（文档 id）；0=根目录 */
  parentId?: number
  /** 导入成功后刷新目录树 */
  onImported: () => void
}

/**
 * 网址导入：把外部网址**原样保存**为一篇网页文档，不抓取页面内容。
 *
 * 为什么不抓取：抓取等于把别人的内容复制一份进本站——原站更新后这里就过期了，
 * 还带来版权与存储开销。现在只存地址，阅读页用 iframe 加载原站，永远是最新的。
 *
 * 协议校验（http/https）最终由服务端把关，前端只做即时提示：iframe 的 src 一旦允许
 * javascript:/data:，就等于把脚本执行权交给了输入者。
 */
export default function UrlImportDialog({ open, onClose, defaultBookId, parentId = 0, onImported }: Props) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [bookId, setBookId] = useState<number | null>(defaultBookId)
  const [books, setBooks] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setUrl('')
    setTitle('')
    setBookId(defaultBookId)
    setLoading(true)
    listBooks()
      .then((shelf) => {
        // 个人库 + 团队文库都可作为导入目标（后端按写权限校验）
        const all = [...(shelf.mine || []), ...(shelf.teams || [])]
        setBooks(all.map((b) => ({ id: b.id, name: b.name })))
      })
      .catch(() => setBooks([]))
      .finally(() => setLoading(false))
  }, [open, defaultBookId])

  async function submit() {
    const raw = url.trim()
    if (!raw) {
      message.warning('请输入网页链接')
      return
    }
    if (!/^https?:\/\//i.test(raw) && !/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(raw)) {
      message.warning('请输入 http:// 或 https:// 开头的网址')
      return
    }
    if (!bookId) {
      message.warning('请选择导入到的知识库')
      return
    }
    setSaving(true)
    try {
      await importUrl(raw, bookId, parentId, title.trim() || undefined)
      message.success('已保存为网页文档')
      onImported()
      onClose()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={
        <span>
          <LinkOutlined /> 导入网址
        </span>
      }
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onOk={submit}
      onCancel={onClose}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="只保存网址，不复制页面内容"
        description="保存后以嵌入方式直接打开原网站，内容始终是最新的。少数站点禁止被嵌入，届时可用「在新窗口打开」查看。"
      />
      <Input
        placeholder="https://example.com/docs"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onPressEnter={submit}
        allowClear
      />
      <Input
        placeholder="标题（可选，默认用域名）"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ marginTop: 8 }}
        maxLength={120}
      />
      <Select
        style={{ width: '100%', marginTop: 12 }}
        placeholder="导入到知识库"
        value={bookId ?? undefined}
        loading={loading}
        onChange={setBookId}
        options={books.map((b) => ({ value: b.id, label: b.name }))}
      />
    </Modal>
  )
}
