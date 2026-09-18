import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Result, Spin, Typography } from 'antd'
import { getDocShareMeta, verifyDocShare } from '../api/share'
import DocContent from '../components/reader/DocContent'
import TocAnchor from '../components/reader/TocAnchor'
import { useReaderWidth } from '../lib/readerWidth'
import PasswordGate from '../components/share/PasswordGate'
import type { DocShareContent, DocShareMeta } from '../types'

/**
 * 文档级分享页（I03，/doc-share/:slug，免登录）：
 * 加载元信息 → 失效页（expired）/ 密码门（has_password）/ 直接渲染；
 * markdown 类型右侧复用 TocAnchor 大纲栏，其余类型隐藏大纲栏（架构决议）。
 */
export default function DocSharePage() {
  const { slug } = useParams()
  // 分享页访客未登录：宽度偏好只存本地，与阅读页同一份 localStorage 键
  const { maxWidth } = useReaderWidth()
  const [meta, setMeta] = useState<DocShareMeta | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [content, setContent] = useState<DocShareContent | null>(null)
  const [tocContainer, setTocContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!slug) return
    setMeta(null)
    setInvalid(false)
    setContent(null)
    getDocShareMeta(slug)
      .then(setMeta)
      .catch(() => setInvalid(true))
  }, [slug])

  // 无密码分享：自动 verify 直接取内容
  useEffect(() => {
    if (!slug || !meta || meta.has_password || meta.expired || content) return
    verifyDocShare(slug)
      .then(setContent)
      .catch(() => setInvalid(true))
  }, [slug, meta, content])

  const handleVerify = useCallback(
    async (password: string) => {
      if (!slug) return
      const res = await verifyDocShare(slug, password)
      setContent(res)
    },
    [slug],
  )

  if (invalid) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Result status="404" title="链接无效" subTitle="该分享链接不存在、已被撤销或已停用。" />
      </div>
    )
  }

  if (!meta) {
    return <Spin style={{ display: 'block', margin: '200px auto' }} />
  }

  if (meta.expired) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Result status="403" title="分享已失效" subTitle="该分享链接已过有效期。" />
      </div>
    )
  }

  // 密码门
  if (meta.has_password && !content) {
    return <PasswordGate onSubmit={handleVerify} />
  }

  if (!content) {
    return <Spin style={{ display: 'block', margin: '200px auto' }} />
  }

  const isMarkdown = content.doc_type === 'markdown'

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
            background: '#2f54eb',
            color: '#fff',
            fontSize: 13,
          }}
        >
          海
        </span>
        <span style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {content.title}
        </span>
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          文档分享 · 只读
        </Typography.Text>
        <div style={{ flex: 1 }} />
        <span style={{ color: '#8a919f', fontSize: 12 }}>来自寄海文库</span>
      </header>

      <div className="toc-scroll-root" style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'auto' }}>
        <main style={{ flex: 1, minWidth: 0 }}>
          {/* 标题块与正文同宽，宽度由正文顶部的调节器统一控制 */}
          <div style={{ maxWidth: maxWidth ?? undefined, margin: '0 auto', padding: '28px 24px 0' }}>
            <h1 style={{ fontSize: 26, marginBottom: 8 }}>{content.title}</h1>
          </div>
          <DocContent
            docType={content.doc_type}
            content={content.content}
            onRendered={isMarkdown ? (el) => setTocContainer(el) : undefined}
          />
        </main>
        {/* 右侧大纲锚点（仅 markdown 类型；非 markdown 隐藏） */}
        {isMarkdown && (
          <aside style={{ width: 200, flexShrink: 0, borderLeft: '1px solid #f0f2f5', overflow: 'auto' }}>
            <TocAnchor container={tocContainer} />
          </aside>
        )}
      </div>
    </div>
  )
}
