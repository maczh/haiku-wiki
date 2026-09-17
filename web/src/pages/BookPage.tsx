import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Dropdown, Empty, Input, Modal, Select, Space, Spin, Tag, Tooltip, message } from 'antd'
import {
  CopyOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  GlobalOutlined,
  LockOutlined,
  ReadOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import DocTree from '../components/tree/DocTree'
import VditorEditor from '../components/editor/VditorEditor'
import MarkdownView from '../components/reader/MarkdownView'
import TocAnchor from '../components/reader/TocAnchor'
import { getBook, setBookVisibility } from '../api/books'
import { exportBook, getDoc } from '../api/docs'
import { useDocTreeStore } from '../stores/docTreeStore'
import { useAuthStore } from '../stores/authStore'
import { VISIBILITY_LABEL, type Book, type DocDetail } from '../types'

const visIcon = { private: <LockOutlined />, members: <TeamOutlined />, public: <GlobalOutlined /> }

/**
 * 知识库页（三栏布局，高仿语雀）：
 *  顶栏（书名/可见性/分享/导出 + 编辑/阅读切换）
 *  ├ 左：可拖拽目录树
 *  ├ 中：编辑（Vditor IR）/ 阅读（Markdown 渲染）
 *  └ 右：大纲锚点
 * 选中文档与 tab 通过 URL 查询参数 ?docId=&tab= 持久化。
 */
export default function BookPage() {
  const { bookId } = useParams()
  const bookID = Number(bookId)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { loadTree, reset, docs } = useDocTreeStore()

  const [book, setBook] = useState<Book | null>(null)
  const [doc, setDoc] = useState<DocDetail | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [tocContainer, setTocContainer] = useState<HTMLElement | null>(null)
  const [visModalOpen, setVisModalOpen] = useState(false)
  const [visValue, setVisValue] = useState<string>('private')
  const [visSaving, setVisSaving] = useState(false)
  const contentKeyRef = useRef(0)

  const docIdParam = Number(searchParams.get('docId') || 0)
  const tab = searchParams.get('tab') === 'edit' ? 'edit' : 'read'

  const setParams = useCallback(
    (patch: Record<string, string | number>) => {
      const next = new URLSearchParams(searchParams)
      for (const [k, v] of Object.entries(patch)) {
        if (v === 0 || v === '') next.delete(k)
        else next.set(k, String(v))
      }
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    getBook(bookID)
      .then((b) => {
        setBook(b)
        setVisValue(b.visibility)
      })
      .catch(() => setNotFound(true))
    void loadTree(bookID)
    return () => reset()
  }, [bookID])

  // 选中或切换文档
  useEffect(() => {
    if (!docIdParam) {
      setDoc(null)
      return
    }
    setDocLoading(true)
    getDoc(docIdParam)
      .then((res) => {
        setDoc(res.doc)
        contentKeyRef.current += 1
        setTocContainer(null)
      })
      .catch(() => setParams({ docId: 0 }))
      .finally(() => setDocLoading(false))
  }, [docIdParam])

  if (notFound) {
    return (
      <Empty description="知识库不存在或无权访问" style={{ marginTop: 120 }}>
        <Button type="primary" onClick={() => navigate('/')}>
          返回书架
        </Button>
      </Empty>
    )
  }

  const isOwner = !!user && book?.owner_id === user.id
  // 写权限：owner 恒可写；members 库所有登录用户可写；public 仅 owner
  const canWrite = !!user && (isOwner || book?.visibility === 'members')
  const shareLink = book?.visibility === 'public' && book.share_slug ? `${window.location.origin}/share/${book.share_slug}` : null

  async function handleSetVisibility() {
    if (!book) return
    setVisSaving(true)
    try {
      const b = await setBookVisibility(book.id, visValue as Book['visibility'])
      setBook(b)
      setVisModalOpen(false)
      message.success('可见性已更新')
    } finally {
      setVisSaving(false)
    }
  }

  function handleExport() {
    if (!book) return
    void exportBook(book.id, book.name)
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 左栏：目录树 */}
      <aside
        style={{
          width: 260,
          flexShrink: 0,
          borderRight: '1px solid #ebedf0',
          background: '#fff',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '14px 16px 8px', borderBottom: '1px solid #f0f2f5' }}>
          <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {book?.name ?? '加载中…'}
          </div>
          <div style={{ marginTop: 4 }}>
            <Tag icon={visIcon[book?.visibility ?? 'private']} style={{ fontSize: 11 }}>
              {VISIBILITY_LABEL[book?.visibility ?? 'private']}
            </Tag>
            <span style={{ color: '#8a919f', fontSize: 12 }}>{docs.length} 篇</span>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <DocTree bookId={bookID} selectedId={docIdParam || null} onSelect={(id) => setParams({ docId: id })} canWrite={canWrite} />
        </div>
      </aside>

      {/* 中栏 + 右栏 */}
      <section style={{ flex: 1, display: 'flex', minWidth: 0, background: '#fff' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* 顶栏工具条 */}
          <div
            style={{
              height: 48,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              padding: '0 16px',
              gap: 12,
              borderBottom: '1px solid #ebedf0',
            }}
          >
            <Space.Compact>
              <Button
                size="small"
                type={tab === 'read' ? 'primary' : 'default'}
                icon={<EyeOutlined />}
                onClick={() => setParams({ tab: 'read' })}
              >
                阅读
              </Button>
              <Button
                size="small"
                type={tab === 'edit' ? 'primary' : 'default'}
                icon={<EditOutlined />}
                disabled={!canWrite}
                onClick={() => setParams({ tab: 'edit' })}
              >
                编辑
              </Button>
            </Space.Compact>

            <div style={{ flex: 1, textAlign: 'center', color: '#5f6672', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doc?.title ?? ''}
            </div>

            <Space size={8}>
              {isOwner && (
                <Tooltip title="可见性与分享">
                  <Button size="small" icon={<GlobalOutlined />} onClick={() => setVisModalOpen(true)}>
                    分享
                  </Button>
                </Tooltip>
              )}
              <Tooltip title="导出知识库 .md.zip">
                <Button size="small" icon={<DownloadOutlined />} onClick={handleExport}>
                  导出
                </Button>
              </Tooltip>
            </Space>
          </div>

          {/* 内容区 */}
          <div className="toc-scroll-root" style={{ flex: 1, overflow: 'auto' }}>
            {!docIdParam && (
              <Empty
                style={{ marginTop: 120 }}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span>
                    从左侧选择一篇文档
                    {canWrite && (
                      <>
                        {' '}
                        或 <a onClick={() => document.querySelector<HTMLInputElement>('.tree-row')?.focus()}>新建文档</a>
                      </>
                    )}
                  </span>
                }
              />
            )}
            {docIdParam && docLoading && <Spin style={{ display: 'block', margin: '80px auto' }} />}
            {docIdParam && !docLoading && doc && tab === 'edit' && canWrite && (
              <VditorEditor key={doc.id} docId={doc.id} initialContent={doc.content} title={doc.title} />
            )}
            {docIdParam && !docLoading && doc && tab === 'edit' && !canWrite && (
              <Empty description="没有编辑权限，已切换为阅读模式" style={{ marginTop: 80 }} />
            )}
            {docIdParam && !docLoading && doc && tab === 'read' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ maxWidth: 780, margin: '0 auto', paddingTop: 28, paddingLeft: 24, paddingRight: 24 }}>
                    <h1 style={{ fontSize: 26, marginBottom: 8 }}>{doc.title}</h1>
                    <div style={{ color: '#8a919f', fontSize: 12, marginBottom: 20 }}>
                      更新于 {new Date(doc.updated_at).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <MarkdownView
                    content={doc.content}
                    onRendered={(el) => setTocContainer(el)}
                  />
                </div>
                {/* 右侧大纲锚点 */}
                <aside style={{ width: 200, flexShrink: 0, borderLeft: '1px solid #f0f2f5', overflow: 'auto' }}>
                  <TocAnchor container={tocContainer} />
                </aside>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 可见性 / 分享弹窗 */}
      <Modal
        title="可见性与分享"
        open={visModalOpen}
        onCancel={() => setVisModalOpen(false)}
        onOk={() => void handleSetVisibility()}
        confirmLoading={visSaving}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>当前可见性：</span>
          <Select
            value={visValue}
            style={{ width: 160 }}
            onChange={setVisValue}
            options={(['private', 'members', 'public'] as const).map((v) => ({
              value: v,
              label: (
                <span>
                  {visIcon[v]} {VISIBILITY_LABEL[v]}
                </span>
              ),
            }))}
          />
        </div>
        {visValue === 'public' && (
          <div style={{ marginTop: 16 }}>
            {shareLink ? (
              <div>
                <div style={{ marginBottom: 6, color: '#5f6672' }}>公开分享链接（免登录只读）：</div>
                <Space.Compact style={{ width: '100%' }}>
                  <Input value={shareLink} readOnly />
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => {
                      void navigator.clipboard.writeText(shareLink)
                      message.success('链接已复制')
                    }}
                  />
                </Space.Compact>
              </div>
            ) : (
              <div style={{ color: '#8a919f' }}>保存后自动生成公开分享链接</div>
            )}
          </div>
        )}
        <div style={{ marginTop: 12, color: '#8a919f', fontSize: 12 }}>
          私有：仅你可见 ｜ 成员可见：所有注册用户可读可写 ｜ 公开：任何人凭链接只读
        </div>
      </Modal>
    </div>
  )
}
