import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Drawer, Empty, Result, Spin } from 'antd'
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  FolderOutlined,
  MenuOutlined,
  ShareAltOutlined,
} from '@ant-design/icons'
import { getShare, getShareDoc } from '../../api/share'
import { iconForDocType } from '../../lib/fileIcon'
import type { DocDetail, DocNode, ShareInfo } from '../../types'
import { READER_MAP } from '../readerMap'
import H5DocContainer from '../H5DocContainer'
import ShareSheet from '../ShareSheet'
import { useShareLink } from '../useShareLink'
import { bookShareUrl } from '../../lib/share'
import { h5ContainerProps, isH5Degraded } from '../styles'

/**
 * H5 文库级公开分享阅读页（/share/:slug，与桌面版同路径，免登录）。
 *
 * 桌面版分享页是「左目录树 + 右正文」双栏；移动端按常见阅读 App 习惯改为：
 *   · 顶栏：返回 + 文库名 + 右侧「目录」按钮；
 *   · 正文区：复用桌面版同一套阅读组件（READER_MAP），在 H5DocContainer 内滚动；
 *   · 目录：点「目录」从左侧滑出抽屉，选中文档即切换（抽屉式，不挤占正文）。
 * 这样移动端打开分享链接即为单栏沉浸阅读，且目录树在抽屉内独立滚动，避免桌面双栏
 * 在手机上「划屏不滚动 / 目录树点不动」的问题。
 */
export default function MShare() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [docId, setDocId] = useState(0)
  const [doc, setDoc] = useState<DocDetail | null>(null)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 本页本身就是公开链接，直接分享当前地址（无需再请求后端）
  const share = useShareLink()

  useEffect(() => {
    if (!slug) return
    setInfo(null)
    setInvalid(false)
    setDoc(null)
    getShare(slug)
      .then((res) => {
        setInfo(res)
        setDocId(res.docs[0]?.id ?? 0)
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

  const [expanded, setExpanded] = useState<Set<number>>(new Set())
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

  if (invalid) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Result status="404" title="链接无效" subTitle="该分享链接不存在或知识库已关闭公开访问。" />
      </div>
    )
  }
  if (!info) {
    return <Spin style={{ display: 'block', margin: '140px auto' }} />
  }

  const renderRows = (list: DocNode[], depth: number): React.ReactNode =>
    list.map((n) => {
      const children = childrenMap.get(n.id) || []
      const isOpen = expanded.has(n.id)
      const spec = iconForDocType(n.doc_type)
      const isFolder = children.length > 0 || n.doc_type === 'folder'
      return (
        <div key={n.id}>
          <div
            className={'tree-row' + (docId === n.id ? ' selected' : '')}
            style={{ paddingLeft: depth * 14 + 8 }}
            onClick={() => setDocId(n.id)}
          >
            <span
              style={{ width: 16, textAlign: 'center', color: '#8a919f', flexShrink: 0 }}
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
              {children.length > 0 ? (isOpen ? '▾' : '▸') : ''}
            </span>
            {isFolder ? (
              <FolderOutlined style={{ color: '#faad14', flexShrink: 0 }} />
            ) : (
              <span style={{ color: spec.color, fontSize: 14, flexShrink: 0 }}>{spec.icon}</span>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{n.title}</span>
          </div>
          {isOpen && children.length > 0 && renderRows(children, depth + 1)}
        </div>
      )
    })

  const Reader = doc ? READER_MAP[doc.doc_type] : null
  const h5c = doc ? h5ContainerProps(doc.doc_type) : { zoomable: false, fill: false }

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
          {info.book.name}
        </div>
        <ShareAltOutlined
          data-h5-share-entry="1"
          onClick={() =>
            share.openShare(doc?.title ? `${info.book.name} · ${doc.title}` : info.book.name, {
              kind: 'url',
              url: bookShareUrl(slug || ''),
            })
          }
          style={{ fontSize: 18, color: '#1f2329', cursor: 'pointer', flexShrink: 0 }}
        />
        <MenuOutlined
          onClick={() => setDrawerOpen(true)}
          style={{ fontSize: 18, color: '#1f2329', cursor: 'pointer', flexShrink: 0, marginLeft: 10 }}
        />
      </header>

      {/* 正文区 */}
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {loadingDoc && <Spin style={{ display: 'block', margin: '80px auto' }} />}
        {!loadingDoc && doc && (
          <H5DocContainer
            degradedHint={
              isH5Degraded(doc.doc_type)
                ? '该类型在手机端阅读体验有所下降，建议在桌面版查看'
                : undefined
            }
            zoomable={h5c.zoomable}
            fill={h5c.fill}
          >
            {Reader ? (
              <Reader content={doc.content} docId={doc.id} bookId={doc.book_id} canWrite={false} />
            ) : (
              <div style={{ padding: 16 }}>
                <Alert type="warning" showIcon message="暂不支持的文档类型" />
              </div>
            )}
          </H5DocContainer>
        )}
        {!loadingDoc && !doc && info.docs.length > 0 && (
          <div style={{ padding: 24 }}>
            <Empty description="请选择左侧目录中的文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
      </main>

      {/* 目录抽屉（移动端以左侧抽屉承载原桌面版左栏目录树） */}
      <Drawer
        title="目录"
        placement="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        styles={{ body: { padding: 8 } }}
      >
        {info.docs.length === 0 ? (
          <Empty description="暂无文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          renderRows(childrenMap.get(0) || [], 0)
        )}
      </Drawer>

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
