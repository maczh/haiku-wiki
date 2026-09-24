import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Result, Spin } from 'antd'
import { ArrowLeftOutlined, ShareAltOutlined } from '@ant-design/icons'
import { getDocShareMeta, verifyDocShare } from '../../api/share'
import type { DocShareContent, DocShareMeta } from '../../types'
import { READER_MAP } from '../readerMap'
import H5DocContainer from '../H5DocContainer'
import ShareSheet from '../ShareSheet'
import { useShareLink } from '../useShareLink'
import { docShareUrl } from '../../lib/share'
import { h5ContainerProps, isH5Degraded } from '../styles'
import PasswordGate from '../../components/share/PasswordGate'

/**
 * H5 文档级公开分享阅读页（/doc-share/:slug，与桌面版同路径，免登录）。
 *
 * 桌面版是「顶栏 + 正文 + 右侧大纲/点评」布局；移动端改为单栏沉浸阅读：
 *   · 顶栏：返回 + 文档标题；
 *   · 正文：复用桌面版同一套阅读组件（READER_MAP）在 H5DocContainer 内滚动；
 *   · 密码门、失效判定与桌面版一致（复用 PasswordGate / getDocShareMeta / verifyDocShare）。
 */
export default function MShareDoc() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [meta, setMeta] = useState<DocShareMeta | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [content, setContent] = useState<DocShareContent | null>(null)
  const [password, setPassword] = useState('')
  // 本页本身就是公开链接，直接分享当前地址（无需再请求后端）
  const share = useShareLink()

  useEffect(() => {
    if (!slug) return
    setMeta(null)
    setInvalid(false)
    setContent(null)
    getDocShareMeta(slug)
      .then(setMeta)
      .catch(() => setInvalid(true))
  }, [slug])

  useEffect(() => {
    if (!slug || !meta || meta.has_password || meta.expired || content) return
    verifyDocShare(slug)
      .then(setContent)
      .catch(() => setInvalid(true))
  }, [slug, meta, content])

  const handleVerify = useCallback(
    async (pwd: string) => {
      if (!slug) return
      const res = await verifyDocShare(slug, pwd)
      setContent(res)
      setPassword(pwd)
    },
    [slug],
  )

  if (invalid) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Result status="404" title="链接无效" subTitle="该分享链接不存在、已被撤销或已停用。" />
      </div>
    )
  }
  if (!meta) {
    return <Spin style={{ display: 'block', margin: '140px auto' }} />
  }
  if (meta.expired) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Result status="403" title="分享已失效" subTitle="该分享链接已过有效期。" />
      </div>
    )
  }
  if (meta.has_password && !content) {
    return <PasswordGate onSubmit={handleVerify} />
  }
  if (!content) {
    return <Spin style={{ display: 'block', margin: '140px auto' }} />
  }

  const Reader = READER_MAP[content.doc_type]
  const h5c = h5ContainerProps(content.doc_type)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#f5f6f8' }}>
      {/* 顶栏 */}
      <header
        style={{
          height: 52,
          flexShrink: 0,
          background: '#fff',
          borderBottom: '1px solid #ebedf0',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 8,
        }}
      >
        <ArrowLeftOutlined
          onClick={() => navigate(-1)}
          style={{ fontSize: 18, color: '#1f2329', cursor: 'pointer', flexShrink: 0 }}
        />
        <div
          style={{
            flex: 1,
            textAlign: 'left',
            fontWeight: 600,
            fontSize: 16,
            color: '#1f2329',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {content.title}
        </div>
        <ShareAltOutlined
          data-h5-share-entry="1"
          onClick={() => share.openShare(content.title, { kind: 'url', url: docShareUrl(slug || '') })}
          style={{ fontSize: 18, color: '#1f2329', cursor: 'pointer', flexShrink: 0 }}
        />
      </header>

      {/* 正文区 */}
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <H5DocContainer
          degradedHint={
            isH5Degraded(content.doc_type)
              ? '该类型在手机端阅读体验有所下降，建议在桌面版查看'
              : undefined
          }
          zoomable={h5c.zoomable}
          fill={h5c.fill}
        >
          {Reader ? (
            <Reader content={content.content} docId={content.doc_id} canWrite={false} />
          ) : (
            <div style={{ padding: 16 }}>
              <Alert type="warning" showIcon message="暂不支持的文档类型" />
            </div>
          )}
        </H5DocContainer>
      </main>

      <ShareSheet
        open={share.open}
        onClose={share.closeShare}
        title={share.title}
        url={share.url}
        loading={share.loading}
        error={share.error}
      />
    </div>
  )
}
