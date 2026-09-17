import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Empty, Result, Spin, Tag } from 'antd'
import { CaretDownOutlined, CaretRightOutlined, FileTextOutlined, FolderOutlined } from '@ant-design/icons'
import { getShare, getShareDoc } from '../api/share'
import MarkdownView from '../components/reader/MarkdownView'
import type { DocDetail, DocNode, ShareInfo } from '../types'

/**
 * 公开分享页（/share/:slug）：免登录只读。
 * 左目录树（无拖拽/管理操作）+ 右阅读视图。
 */
export default function SharePage() {
  const { slug } = useParams()
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [docId, setDocId] = useState<number>(0)
  const [doc, setDoc] = useState<DocDetail | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadingDoc, setLoadingDoc] = useState(false)

  useEffect(() => {
    if (!slug) return
    getShare(slug)
      .then((res) => {
        setInfo(res)
        // 默认选中第一篇文档
        const first = res.docs[0]
        if (first) setDocId(first.id)
      })
      .catch(() => setInvalid(true))
  }, [slug])

  useEffect(() => {
    if (!slug || !docId) {
      setDoc(null)
      return
    }
    setLoadingDoc(true)
    getShareDoc(slug, docId)
      .then(setDoc)
      .catch(() => setDoc(null))
      .finally(() => setLoadingDoc(false))
  }, [slug, docId])

  const childrenMap = useMemo(() => {
    const map = new Map<number, DocNode[]>()
    for (const d of info?.docs ?? []) {
      const list = map.get(d.parent_id) || []
      list.push(d)
      map.set(d.parent_id, list)
    }
    return map
  }, [info])

  // 默认展开所有有子节点的目录
  useEffect(() => {
    if (info && expanded.size === 0) {
      const all = new Set<number>()
      for (const d of info.docs) {
        if ((childrenMap.get(d.id) || []).length > 0) all.add(d.id)
      }
      setExpanded(all)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info])

  const renderRows = (list: DocNode[], depth: number): React.ReactNode =>
    list.map((n) => {
      const children = childrenMap.get(n.id) || []
      const isOpen = expanded.has(n.id)
      return (
        <div key={n.id}>
          <div
            className={'tree-row' + (docId === n.id ? ' selected' : '')}
            style={{ paddingLeft: depth * 16 + 4 }}
            onClick={() => setDocId(n.id)}
          >
            <span
              style={{ width: 16, textAlign: 'center', color: '#8a919f' }}
              onClick={(e) => {
                if (children.length === 0) return
                e.stopPropagation()
                setExpanded((s) => {
                  const next = new Set(s)
                  if (next.has(n.id)) next.delete(n.id)
                  else next.add(n.id)
                  return next
                })
              }}
            >
              {children.length > 0 ? (isOpen ? <CaretDownOutlined /> : <CaretRightOutlined />) : null}
            </span>
            {children.length > 0 ? <FolderOutlined style={{ color: '#faad14' }} /> : <FileTextOutlined style={{ color: '#8a919f' }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{n.title}</span>
          </div>
          {isOpen && children.length > 0 && renderRows(children, depth + 1)}
        </div>
      )
    })

  if (invalid) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Result status="404" title="链接无效" subTitle="该分享链接不存在或知识库已关闭公开访问。" />
      </div>
    )
  }

  if (!info) {
    return <Spin style={{ display: 'block', margin: '200px auto' }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff' }}>
      {/* 顶栏 */}
      <header
        style={{
          height: 52,
          flexShrink: 0,
          borderBottom: '1px solid #ebedf0',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: 10,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 6,
            background: info.book.cover_color || '#2f54eb',
            color: '#fff',
            fontSize: 13,
          }}
        >
          海
        </span>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{info.book.name}</span>
        <Tag color="green">公开分享 · 只读</Tag>
        <div style={{ flex: 1 }} />
        <span style={{ color: '#8a919f', fontSize: 12 }}>
          {info.book.owner_name ? `由 ${info.book.owner_name} 创建` : ''} · 来自海库
        </span>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左侧目录树 */}
        <aside style={{ width: 260, flexShrink: 0, borderRight: '1px solid #ebedf0', overflow: 'auto', padding: 8 }}>
          {info.docs.length === 0 ? <Empty description="暂无文档" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : renderRows(childrenMap.get(0) || [], 0)}
        </aside>

        {/* 阅读区 */}
        <main style={{ flex: 1, overflow: 'auto' }} className="toc-scroll-root">
          {loadingDoc && <Spin style={{ display: 'block', margin: '80px auto' }} />}
          {!loadingDoc && doc && (
            <>
              <div style={{ maxWidth: 780, margin: '0 auto', padding: '28px 24px 0' }}>
                <h1 style={{ fontSize: 26, marginBottom: 8 }}>{doc.title}</h1>
              </div>
              {/* P1 对齐：非 markdown 类型书级公开预览暂以占位提示（doc_type 随文档返回） */}
              {doc.doc_type && doc.doc_type !== 'markdown' ? (
                <div style={{ maxWidth: 780, margin: '40px auto', textAlign: 'center', color: '#8a919f' }}>
                  该类型（{doc.doc_type}）暂不支持书级公开预览，请在知识库内查看。
                </div>
              ) : (
                <MarkdownView content={doc.content} />
              )}
            </>
          )}
          {!loadingDoc && !doc && info.docs.length > 0 && <Spin style={{ display: 'block', margin: '80px auto' }} />}
        </main>
      </div>
    </div>
  )
}
