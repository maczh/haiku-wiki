import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Select, Spin, message } from 'antd'
import TemplateGallery from '../components/template/TemplateGallery'
import { listBooks } from '../api/books'
import { createDoc } from '../api/docs'
import type { DocTemplate } from '../api/templates'
import { DOC_TYPE_LABEL, type BookWithCount, type DocType } from '../types'

/**
 * 模板中心（独立页面入口，与「新建文档」弹窗内的画廊共用同一组件）。
 * 用户在此浏览全部内置模板，选定模板后落到某个知识库创建文档。
 */
export default function TemplateGalleryPage() {
  const navigate = useNavigate()
  const [books, setBooks] = useState<BookWithCount[]>([])
  const [targetBook, setTargetBook] = useState<number | null>(null)
  const [bookLoading, setBookLoading] = useState(true)

  useEffect(() => {
    listBooks()
      .then((shelf) => {
        const all = [...shelf.mine, ...shelf.visible, ...shelf.teams]
        setBooks(all)
        setTargetBook(all[0]?.id ?? null)
      })
      .catch(() => setBooks([]))
      .finally(() => setBookLoading(false))
  }, [])

  async function useTemplate(t: DocTemplate) {
    if (!targetBook) {
      message.warning('请先选择一个知识库')
      return
    }
    try {
      const doc = await createDoc(targetBook, 0, t.title, t.doc_type, t.content)
      message.success('已基于模板创建文档')
      navigate(`/books/${targetBook}?docId=${doc.id}&tab=edit`)
    } catch {
      /* 拦截器已提示 */
    }
  }

  async function useBlank(dt: DocType) {
    if (!targetBook) {
      message.warning('请先选择一个知识库')
      return
    }
    const title = `未命名${DOC_TYPE_LABEL[dt]}`
    try {
      const doc = await createDoc(targetBook, 0, title, dt, '')
      message.success('已创建空白文档')
      navigate(`/books/${targetBook}?docId=${doc.id}&tab=edit`)
    } catch {
      /* 拦截器已提示 */
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 12,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 700, color: '#1f2329' }}>模板中心</span>
        <span style={{ color: '#8a919f', fontSize: 13 }}>从企业办公常用模板快速创建文档</span>
        <div style={{ flex: 1 }} />
        {bookLoading ? (
          <Spin size="small" />
        ) : (
          <Select
            style={{ width: 220 }}
            placeholder="选择目标知识库"
            value={targetBook ?? undefined}
            onChange={setTargetBook}
            options={books.map((b) => ({ value: b.id, label: b.name }))}
          />
        )}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          border: '1px solid #ebedf0',
          borderRadius: 8,
          background: '#fff',
          padding: 8,
        }}
      >
        <TemplateGallery
          initialDocType={undefined}
          onSelect={useTemplate}
          onSelectBlank={useBlank}
          showBlank
        />
      </div>
    </div>
  )
}
