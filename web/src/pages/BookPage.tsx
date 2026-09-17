import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Dropdown, Empty, Input, Modal, Select, Space, Spin, Tag, Tooltip, message } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileAddOutlined,
  GlobalOutlined,
  LockOutlined,
  ReadOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import DocTree from '../components/tree/DocTree'
import VditorEditor from '../components/editor/VditorEditor'
import SheetEditor from '../components/editor/SheetEditor'
import MindmapEditor from '../components/editor/MindmapEditor'
import FlowchartEditor from '../components/editor/FlowchartEditor'
import DocContent from '../components/reader/DocContent'
import TocAnchor from '../components/reader/TocAnchor'
import DocShareDrawer from '../components/share/DocShareDrawer'
import ExportDialog, { type ExportTarget } from '../components/export/ExportDialog'
import { getBook, setBookVisibility, updateBook, deleteBook } from '../api/books'
import { getDoc } from '../api/docs'
import { useDocTreeStore } from '../stores/docTreeStore'
import { useAuthStore } from '../stores/authStore'
import { VISIBILITY_LABEL, type Book, type DocDetail, type DocNode } from '../types'

const visIcon = { private: <LockOutlined />, members: <TeamOutlined />, public: <GlobalOutlined /> }

/**
 * 知识库页（三栏布局，高仿语雀）：
 *  顶栏（书名/可见性 + 编辑/阅读切换；第四轮 R7：分享/导出入口迁移至右键菜单，顶栏移除）
 *  ├ 左：可拖拽目录树（书头支持知识库右键菜单：新建/重命名/可见性/导出/删除）
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
  // R4/R5：右键分享 → DocShareDrawer（记录被分享的文档节点）
  const [shareNodeId, setShareNodeId] = useState<number | null>(null)
  const [shareDrawerOpen, setShareDrawerOpen] = useState(false)
  // R4/R6：右键导出 → ExportDialog（doc / book 两种目标）
  const [exportTarget, setExportTarget] = useState<ExportTarget | null>(null)
  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [renameBookValue, setRenameBookValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  // 知识库右键"新建文档"→ DocTree（信号计数器）
  const [createSignal, setCreateSignal] = useState(0)
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

  // 选中或切换文档（R1 修复：依赖加入 tab——编辑保存后切到阅读/编辑都重取最新内容，
  // 避免用陈旧 doc.content 重建编辑器导致二次保存覆盖真实正文，mermaid 丢失即此根因）
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
  }, [docIdParam, tab])

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

  // ---------- 知识库右键菜单（R4） ----------

  async function submitRenameBook() {
    if (!book) return
    const name = renameBookValue.trim()
    if (!name) {
      message.warning('知识库名称不能为空')
      return
    }
    setRenameSaving(true)
    try {
      const b = await updateBook(book.id, { name })
      setBook(b)
      setRenameModalOpen(false)
      message.success('已重命名')
    } finally {
      setRenameSaving(false)
    }
  }

  function confirmDeleteBook() {
    if (!book) return
    Modal.confirm({
      title: `删除知识库「${book.name}」？`,
      content: '库内全部文档将一并删除（进回收站），此操作仅知识库所有者可执行。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await deleteBook(book.id)
        message.success('知识库已删除')
        navigate('/')
      },
    })
  }

  /** 知识库节点右键菜单：新建文档 / 重命名 / 修改可见性 / 导出 / 删除 */
  const bookMenu = {
    items: [
      { key: 'create', icon: <FileAddOutlined />, label: '新建文档', disabled: !canWrite },
      { key: 'rename', icon: <EditOutlined />, label: '重命名', disabled: !isOwner },
      { key: 'visibility', icon: <GlobalOutlined />, label: '修改可见性', disabled: !isOwner },
      { key: 'export', icon: <DownloadOutlined />, label: '导出' },
      { key: 'delete', icon: <DeleteOutlined />, label: '删除知识库', danger: true, disabled: !isOwner },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'create') setCreateSignal((n) => n + 1)
      if (key === 'rename') {
        setRenameBookValue(book?.name ?? '')
        setRenameModalOpen(true)
      }
      if (key === 'visibility') setVisModalOpen(true)
      if (key === 'export' && book) {
        setExportTarget({ kind: 'book', bookId: book.id, title: book.name })
      }
      if (key === 'delete') confirmDeleteBook()
    },
  }

  /** 文档右键"分享"：打开 DocShareDrawer（默认永久有效，R5） */
  function openShare(node: DocNode) {
    setShareNodeId(node.id)
    setShareDrawerOpen(true)
  }

  /** 文档右键"导出"：打开 ExportDialog（doc 模式，R6） */
  function openExportDoc(node: DocNode) {
    setExportTarget({ kind: 'doc', docId: node.id, title: node.title, docType: node.doc_type })
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
        {/* 书头：知识库节点（右键菜单 R4） */}
        <Dropdown menu={bookMenu} trigger={['contextMenu']}>
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
        </Dropdown>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <DocTree
            bookId={bookID}
            selectedId={docIdParam || null}
            onSelect={(id) => setParams({ docId: id })}
            onOpenInEdit={(id) => setParams({ docId: id, tab: 'edit' })}
            onShare={openShare}
            onExportDoc={openExportDoc}
            canWrite={canWrite}
            createSignal={createSignal}
          />
        </div>
      </aside>

      {/* 中栏 + 右栏 */}
      <section style={{ flex: 1, display: 'flex', minWidth: 0, background: '#fff' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* 顶栏工具条（R7：分享/导出按钮已迁移至右键菜单） */}
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
                icon={<ReadOutlined />}
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
                        或 <a onClick={() => setCreateSignal((n) => n + 1)}>新建文档</a>
                      </>
                    )}
                  </span>
                }
              />
            )}
            {docIdParam && docLoading && <Spin style={{ display: 'block', margin: '80px auto' }} />}
            {docIdParam && !docLoading && doc && tab === 'edit' && canWrite && (
              <>
                {(doc.doc_type ?? 'markdown') === 'markdown' && (
                  <VditorEditor key={doc.id} docId={doc.id} initialContent={doc.content} title={doc.title} />
                )}
                {doc.doc_type === 'sheet' && (
                  <SheetEditor key={doc.id} docId={doc.id} initialContent={doc.content} title={doc.title} docType="sheet" />
                )}
                {doc.doc_type === 'mindmap' && (
                  <MindmapEditor key={doc.id} docId={doc.id} initialContent={doc.content} title={doc.title} />
                )}
                {doc.doc_type === 'flowchart' && (
                  <FlowchartEditor key={doc.id} docId={doc.id} initialContent={doc.content} title={doc.title} />
                )}
              </>
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
                  {/* 阅读分发：doc_type → 各类型只读渲染；仅 markdown 提供大纲提取 */}
                  <DocContent
                    docType={doc.doc_type ?? 'markdown'}
                    content={doc.content}
                    onRendered={doc.doc_type === 'markdown' ? (el) => setTocContainer(el) : undefined}
                  />
                </div>
                {/* 右侧大纲锚点（仅 markdown 类型显示；非 markdown 隐藏） */}
                {(doc.doc_type ?? 'markdown') === 'markdown' && (
                  <aside style={{ width: 200, flexShrink: 0, borderLeft: '1px solid #f0f2f5', overflow: 'auto' }}>
                    <TocAnchor container={tocContainer} />
                  </aside>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 文档级分享管理抽屉（R4/R5：右键分享入口；默认永久有效） */}
      <DocShareDrawer
        open={shareDrawerOpen}
        onClose={() => setShareDrawerOpen(false)}
        docId={shareNodeId ?? docIdParam}
        docTitle={doc?.title ?? ''}
      />

      {/* 导出对话框（R6：右键导出；md/md.zip 走导出 API，json 前端生成） */}
      <ExportDialog open={!!exportTarget} onClose={() => setExportTarget(null)} target={exportTarget} />

      {/* 可见性 / 分享弹窗（知识库右键"修改可见性"入口） */}
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

      {/* 知识库重命名弹窗（R4） */}
      <Modal
        title="重命名知识库"
        open={renameModalOpen}
        onOk={() => void submitRenameBook()}
        confirmLoading={renameSaving}
        onCancel={() => setRenameModalOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          value={renameBookValue}
          autoFocus
          onChange={(e) => setRenameBookValue(e.target.value)}
          onPressEnter={() => void submitRenameBook()}
          placeholder="知识库名称"
        />
      </Modal>
    </div>
  )
}
