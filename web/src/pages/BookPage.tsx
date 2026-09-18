import { lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Dropdown, Empty, Input, Modal, Select, Space, Spin, Tag, Tooltip, message } from 'antd'
import {
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileAddOutlined,
  GlobalOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReadOutlined,
  SafetyOutlined,
  ShareAltOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import DocTree from '../components/tree/DocTree'
import LazyBoundary from '../components/common/LazyBoundary'
import DocContent from '../components/reader/DocContent'
import TocAnchor from '../components/reader/TocAnchor'
import DocShareDrawer from '../components/share/DocShareDrawer'
import WeChatShareModal from '../components/share/WeChatShareModal'
import ExportDialog, { type ExportTarget } from '../components/export/ExportDialog'
import CollaboratorModal from '../components/collab/CollaboratorModal'
import CompanyKBWritersModal from '../components/admin/CompanyKBWritersModal'
import { getBook, setBookVisibility, updateBook, deleteBook } from '../api/books'
import { getDoc } from '../api/docs'
import { useDocTreeStore } from '../stores/docTreeStore'
import { useAuthStore } from '../stores/authStore'
import { VISIBILITY_LABEL, type Book, type DocDetail, type DocNode } from '../types'
import { useReaderWidth } from '../lib/readerWidth'

// 编辑器按需加载：Vditor / simple-mind-map（含 katex）/ Luckysheet / mermaid 体积大，
// 且每次只会用到其中一种，静态 import 会让首屏 chunk 无谓膨胀（详见 components/common/LazyBoundary.tsx）
const VditorEditor = lazy(() => import('../components/editor/VditorEditor'))
const SheetEditor = lazy(() => import('../components/editor/SheetEditor'))
const MindmapEditor = lazy(() => import('../components/editor/MindmapEditor'))
const FlowchartEditor = lazy(() => import('../components/editor/FlowchartEditor'))
const DrawioEditor = lazy(() => import('../components/editor/DrawioEditor'))
const TodoEditor = lazy(() => import('../components/editor/TodoEditor'))
const CalendarEditor = lazy(() => import('../components/editor/CalendarEditor'))
const ApiEditor = lazy(() => import('../components/editor/ApiEditor'))

const visIcon = { private: <LockOutlined />, members: <TeamOutlined />, public: <GlobalOutlined /> }

// 左栏宽度 / 折叠态、大纲浮动层开关均持久化到 localStorage（本地偏好）
const LS_SIDEBAR_W = 'hk.sidebar.width'
const LS_SIDEBAR_COLLAPSED = 'hk.sidebar.collapsed'
const LS_TOC_OPEN = 'hk.toc.open'
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 480

function readLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLS(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* 隐私模式下忽略 */
  }
}

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
  // 阅读区正文宽度（与 DocContent 内的调节器共享同一份本地偏好）
  const { maxWidth, customized } = useReaderWidth()

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
  // R5：文档协作邀请（右键菜单 / 顶栏按钮 → 协作者管理弹窗）
  const [collabOpen, setCollabOpen] = useState(false)
  const [collabNode, setCollabNode] = useState<DocNode | null>(null)
  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [renameBookValue, setRenameBookValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  // 知识库右键"新建文档"→ DocTree（信号计数器）
  const [createSignal, setCreateSignal] = useState(0)
  /** 「分享到微信」弹窗（所有文档通用入口） */
  const [weChatOpen, setWeChatOpen] = useState(false)
  const contentKeyRef = useRef(0)
  // 公司知识库写权限管理（仅管理员可见）
  const isAdmin = user?.role === 'admin'
  const [writersOpen, setWritersOpen] = useState(false)

  // 左栏（文档库）：可折叠 + 可拖拽调宽（持久化）
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readLS(LS_SIDEBAR_COLLAPSED) === '1')
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const v = Number(readLS(LS_SIDEBAR_W) ?? '')
    return Number.isFinite(v) && v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : 260
  })
  // 右栏大纲：浮动层 + 可折叠（不随正文滚动）
  const [tocOpen, setTocOpen] = useState(() => readLS(LS_TOC_OPEN) !== '0')
  const [tocCount, setTocCount] = useState(0)

  useEffect(() => {
    writeLS(LS_SIDEBAR_W, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    writeLS(LS_SIDEBAR_COLLAPSED, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  useEffect(() => {
    writeLS(LS_TOC_OPEN, tocOpen ? '1' : '0')
  }, [tocOpen])

  /** 拖拽左栏右边缘调整宽度（拖拽期间禁用文本选择） */
  const startSidebarResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = sidebarWidth
      const onMove = (ev: MouseEvent) => {
        setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + ev.clientX - startX)))
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [sidebarWidth],
  )

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
        setTocCount(0) // 切换文档需重置大纲，避免上一文档的条目残留
      })
      .catch(() => setParams({ docId: 0 }))
      .finally(() => setDocLoading(false))
  }, [docIdParam, tab])

  /**
   * markdown 正文渲染完成回调：记录大纲提取容器，并统计标题数量。
   *
   * 注意：标题数量必须在这里统计，不能只依赖浮层内 TocAnchor 的 onItemsChange——
   * 浮层本身以 tocCount > 0 为渲染条件，若只靠它上报会形成死锁（浮层不渲染 → 无人上报 → 浮层永不渲染）。
   */
  const handleMarkdownRendered = useCallback((el: HTMLElement) => {
    setTocContainer(el)
    setTocCount(el.querySelectorAll('h1, h2, h3, h4').length)
  }, [])

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
  // 写权限：owner 恒可写；members 库所有登录用户可写；公司知识库以后端实时计算的
  // can_write 为准（管理员 + 被授权用户可写，其余全员只读）；普通库 can_write 同样可信，
  // 此处以 OR 兜底，兼容旧服务端未下发该字段的情况。
  const canWrite = !!user && (book?.can_write === true || isOwner || book?.visibility === 'members')
  // 附件型文档（导入的 docx/pdf/pptx/dwg 等）：按原文件保存，正文不可编辑，仅提供阅读与下载
  const docTypeNow = doc?.doc_type ?? 'markdown'
  const isAttachmentDoc = docTypeNow === 'file'
  const isMarkdownDoc = docTypeNow === 'markdown'
  // 绘图文档（内嵌 draw.io）在编辑态由 iframe 撑满，不需要页面再给内边距
  const isDrawingDoc = docTypeNow === 'drawing'
  // 需要更宽阅读栏的类型：绘图要横向空间，工作日历是 7 列网格，780 宽会挤成两行
  const isWideDoc = isDrawingDoc || docTypeNow === 'calendar'
  // 大纲浮动层：仅 markdown 且确实提取到标题、用户未收起时显示
  const showTocFloat = isMarkdownDoc && tocOpen && tocCount > 0 && !docLoading
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

  /** 文档右键 / 顶栏"邀请协作"：打开协作者管理（R5） */
  function openCollaborators(node: DocNode) {
    setCollabNode(node)
    setCollabOpen(true)
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 左栏：文档库目录树（可折叠 + 可拖拽调宽，偏好本地持久化） */}
      {!sidebarCollapsed && (
        <div style={{ position: 'relative', width: sidebarWidth, flexShrink: 0, display: 'flex' }}>
          <aside
            style={{
              flex: 1,
              minWidth: 0,
              borderRight: '1px solid #ebedf0',
              background: '#fff',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* 书头：知识库节点（右键菜单 R4） */}
            <Dropdown menu={bookMenu} trigger={['contextMenu']}>
              <div style={{ padding: '12px 12px 8px 16px', borderBottom: '1px solid #f0f2f5' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 15,
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {book?.name ?? '加载中…'}
                  </div>
                  <Tooltip title="收起文档库">
                    <Button
                      type="text"
                      size="small"
                      icon={<MenuFoldOutlined />}
                      onClick={() => setSidebarCollapsed(true)}
                    />
                  </Tooltip>
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
                onCollaborators={openCollaborators}
                canWrite={canWrite}
                createSignal={createSignal}
              />
            </div>
          </aside>
          {/* 右边缘拖拽把手：调整左栏宽度 */}
          <div className="hk-side-resizer" onMouseDown={startSidebarResize} />
        </div>
      )}

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
            <Tooltip title={sidebarCollapsed ? '展开文档库' : '收起文档库'}>
              <Button
                type="text"
                size="small"
                icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setSidebarCollapsed((v) => !v)}
              />
            </Tooltip>

            <Space.Compact>
              <Button
                size="small"
                type={tab === 'read' ? 'primary' : 'default'}
                icon={<ReadOutlined />}
                onClick={() => setParams({ tab: 'read' })}
              >
                阅读
              </Button>
              <Tooltip title={isAttachmentDoc ? '附件型文档按原文件保存，不可编辑' : ''}>
                <Button
                  size="small"
                  type={tab === 'edit' ? 'primary' : 'default'}
                  icon={<EditOutlined />}
                  disabled={!canWrite || isAttachmentDoc}
                  onClick={() => setParams({ tab: 'edit' })}
                >
                  编辑
                </Button>
              </Tooltip>
            </Space.Compact>

            <div style={{ flex: 1, textAlign: 'center', color: '#5f6672', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doc?.title ?? ''}
            </div>

            {docIdParam && doc && !docLoading && canWrite && (
              <Tooltip title="邀请其他用户共同编辑这篇文档">
                <Button size="small" icon={<UserAddOutlined />} onClick={() => openCollaborators(doc)}>
                  协作
                </Button>
              </Tooltip>
            )}
            {book?.is_company_kb && isAdmin && (
              <Tooltip title="管理公司知识库的写权限授权">
                <Button size="small" icon={<SafetyOutlined />} onClick={() => setWritersOpen(true)}>
                  管理写权限
                </Button>
              </Tooltip>
            )}
            {docIdParam && doc && !docLoading && (
              <Tooltip title="分享到微信 / 生成免登录阅读链接">
                <Button size="small" icon={<ShareAltOutlined />} onClick={() => setWeChatOpen(true)}>
                  分享
                </Button>
              </Tooltip>
            )}
          </div>

          {/* 内容区：滚动容器 + 大纲浮动层（浮动层在滚动容器之外，故不随正文滚动） */}
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <div className="toc-scroll-root" style={{ height: '100%', overflow: 'auto' }}>
              {/* height:100% 不可省：编辑器（如思维导图画布）依赖它拿到确定高度，否则画布高度塌陷为 0 */}
              <div style={{ height: '100%', paddingRight: showTocFloat ? 264 : 0 }}>
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
                    {isAttachmentDoc ? (
                      <Empty
                        description="附件型文档按原文件保存、不可编辑，请切换到阅读模式查看"
                        style={{ marginTop: 80 }}
                      >
                        <Button type="primary" onClick={() => setParams({ tab: 'read' })}>
                          前往阅读
                        </Button>
                      </Empty>
                    ) : (
                      <LazyBoundary tip="正在加载编辑器…">
                        {docTypeNow === 'markdown' && (
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
                        {doc.doc_type === 'drawing' && (
                          <DrawioEditor key={doc.id} docId={doc.id} initialContent={doc.content} title={doc.title} />
                        )}
                        {doc.doc_type === 'todo' && (
                          <TodoEditor key={doc.id} docId={doc.id} initialContent={doc.content} title={doc.title} />
                        )}
                        {doc.doc_type === 'calendar' && (
                          <CalendarEditor key={doc.id} docId={doc.id} initialContent={doc.content} title={doc.title} />
                        )}
                        {doc.doc_type === 'api' && (
                          <ApiEditor key={doc.id} docId={doc.id} initialContent={doc.content} title={doc.title} />
                        )}
                      </LazyBoundary>
                    )}
                  </>
                )}
                {docIdParam && !docLoading && doc && tab === 'edit' && !canWrite && (
                  <Empty description="没有编辑权限，已切换为阅读模式" style={{ marginTop: 80 }} />
                )}
                {docIdParam && !docLoading && doc && tab === 'read' && (
                  <div>
                    {/* 绘图/附件类预览需要横向空间，正文类保持 780 的阅读宽度 */}
                    <div
                      style={{
                        // 未手动调宽时沿用原有分档（宽类 1100 / 正文类 780）；
                        // 用户一旦调过宽度，标题块与正文一起跟随其选择
                        maxWidth: customized ? (maxWidth ?? undefined) : isWideDoc ? 1100 : 780,
                        margin: '0 auto',
                        paddingTop: 28,
                        paddingLeft: 24,
                        paddingRight: 24,
                      }}
                    >
                      <h1 style={{ fontSize: 26, marginBottom: 8 }}>{doc.title}</h1>
                      <div style={{ color: '#8a919f', fontSize: 12, marginBottom: 20 }}>
                        更新于 {new Date(doc.updated_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    {/* 阅读分发：doc_type → 各类型只读渲染；仅 markdown 提供大纲提取 */}
                    <DocContent
                      docType={docTypeNow}
                      content={doc.content}
                      onRendered={isMarkdownDoc ? handleMarkdownRendered : undefined}
                      bookId={bookID}
                      onDocCreated={(id) => setParams({ docId: id, tab: 'edit' })}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* 大纲浮动层（可折叠；不随正文滚动） */}
            {docIdParam && !docLoading && doc && tab === 'read' && showTocFloat && (
              <div className="hk-toc-float">
                <Tooltip title="收起大纲">
                  <Button
                    className="hk-toc-float-close"
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => setTocOpen(false)}
                  />
                </Tooltip>
                <div className="hk-toc-float-body">
                  <TocAnchor container={tocContainer} onItemsChange={setTocCount} />
                </div>
              </div>
            )}
            {/* 收起后的入口按钮 */}
            {docIdParam && !docLoading && doc && tab === 'read' && isMarkdownDoc && !showTocFloat && tocCount > 0 && (
              <Tooltip title="显示大纲">
                <Button
                  size="small"
                  icon={<UnorderedListOutlined />}
                  onClick={() => setTocOpen(true)}
                  style={{ position: 'absolute', top: 16, right: 16, zIndex: 3, boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}
                />
              </Tooltip>
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

      {/* 文档协作者管理（R5：右键「邀请协作」/ 顶栏「协作」按钮） */}
      <CollaboratorModal
        open={collabOpen}
        onClose={() => setCollabOpen(false)}
        docId={collabNode?.id ?? (docIdParam || null)}
        docTitle={collabNode?.title ?? doc?.title ?? ''}
      />

      {/* 「分享到微信」弹窗（所有文档通用入口） */}
      <WeChatShareModal
        open={weChatOpen}
        onClose={() => setWeChatOpen(false)}
        docId={docIdParam}
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

      {/* 公司知识库写权限管理（仅管理员）：授权后刷新本库 can_write，使编辑按钮即时生效 */}
      <CompanyKBWritersModal
        open={writersOpen}
        onClose={() => {
          setWritersOpen(false)
          void getBook(bookID)
            .then(setBook)
            .catch(() => undefined)
        }}
        bookId={bookID}
        bookName={book?.name}
      />
    </div>
  )
}
