import { useEffect, useState } from 'react'
import { Alert, Input, Modal, Select, Spin, message } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import { importUrl } from '../../api/docs'
import { listBooks } from '../../api/books'
import type { ImportUrlResult } from '../../types'

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
 * URL 导入：抓取网页正文（含图片本地化）转成 Markdown 文档落入目标知识库。
 *
 * 抓取与 SSRF 防护全在服务端（POST /api/import/url），前端只负责收集
 * 「链接 + 目标库」两个参数——浏览器直连抓取会被 CORS 挡住，也拿不到稳定正文。
 */
export default function UrlImportDialog({ open, onClose, defaultBookId, parentId = 0, onImported }: Props) {
  const [url, setUrl] = useState('')
  const [bookId, setBookId] = useState<number | null>(defaultBookId)
  const [books, setBooks] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setUrl('')
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
    if (!/^https?:\/\//i.test(raw)) {
      message.warning('链接需以 http:// 或 https:// 开头')
      return
    }
    if (!bookId) {
      message.warning('请选择导入到的知识库')
      return
    }
    setSaving(true)
    try {
      const res: ImportUrlResult = await importUrl(raw, bookId, parentId)
      message.success(`已导入：${res.title}`)
      onClose()
      onImported()
    } catch {
      /* 拦截器已提示（抓取失败 / 非 HTML / 无权限） */
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={
        <>
          <LinkOutlined /> 从 URL 导入
        </>
      }
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={saving}
      okText="导入"
      cancelText="取消"
      destroyOnClose
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 4, color: '#5f6672' }}>网页链接</div>
        <Input
          autoFocus
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPressEnter={() => void submit()}
        />
      </div>
      <div>
        <div style={{ marginBottom: 4, color: '#5f6672' }}>导入到</div>
        {loading ? (
          <Spin size="small" />
        ) : (
          <Select
            style={{ width: '100%' }}
            placeholder="选择目标知识库"
            value={bookId}
            onChange={setBookId}
            options={books.map((b) => ({ value: b.id, label: b.name }))}
          />
        )}
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginTop: 16 }}
        message="说明"
        description="服务端抓取页面正文并转为 Markdown（图片会下载入库本地化），仅支持 text/html 页面；正文上限 1MB。"
      />
    </Modal>
  )
}
