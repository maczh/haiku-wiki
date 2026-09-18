import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Dropdown, Empty, Form, Input, Modal, Popconfirm, Radio, Select, Space, Spin, Tag, Tooltip, message } from 'antd'
import {
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileAddOutlined,
  GlobalOutlined,
  ImportOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ReadOutlined,
  SafetyOutlined,
  ShareAltOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import KnowledgeTree from '../components/tree/KnowledgeTree'
import LazyBoundary from '../components/common/LazyBoundary'
import DocContent from '../components/reader/DocContent'
import TocAnchor from '../components/reader/TocAnchor'
import DocShareDrawer from '../components/share/DocShareDrawer'
import WeChatShareModal from '../components/share/WeChatShareModal'
import ExportDialog, { type ExportTarget } from '../components/export/ExportDialog'
import CollaboratorModal from '../components/collab/CollaboratorModal'
import CompanyKBWritersModal from '../components/admin/CompanyKBWritersModal'
import { getBook, setBookVisibility, updateBook, deleteBook, listBooks, createBook } from '../api/books'
import { getDoc, createDoc, getTree, duplicateDoc, moveDoc, moveDocToBook, pinDoc } from '../api/docs'
import { buildChildrenMap, useDocTreeStore } from '../stores/docTreeStore'
import { useAuthStore } from '../stores/authStore'
import { VISIBILITY_LABEL, type Book, type Bookshelf, type DocDetail, type DocNode, type DocType, type Visibility } from '../types'
import { COVER_COLORS, DOC_TYPES, DOC_TYPE_LABEL } from '../types'
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
// ⚠️ 必须懒加载：ImportDialog 会静态拉入 lib/import/parse.ts（SheetJS/turndown/jszip 等）
const ImportDialog = lazy(() => import('../components/import/ImportDialog'))
const UrlImportDialog = lazy(() => import('../components/import/UrlImportDialog'))

const visIcon = { private: <LockOutlined />, members: <TeamOutlined />, public: <GlobalOutlined /> }

interface BookEditState {
  mode: 'create' | 'edit'
  book?: Book
}

/** 把知识库文档平铺成"目录"下拉选项（含层级缩进） */
function flattenDocs(docs: DocNode[]): { id: number; label: string }[] {
  const map = buildChildrenMap(docs)
  const out: { id: number; label: string }[] = []
  const walk = (parentId: number, depth: number) => {
    for (const d of map.get(parentId) || []) {
      out.push({ id: d.id, label: '　'.repeat(depth) + (d.title || '未命名') })
      walk(d.id, depth + 1)
    }
  }
  walk(0, 0)
  return out
}

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
  /** 「分享到微信」弹窗（所有文档通用入口） */
  const [weChatOpen, setWeChatOpen] = useState(false)
  const contentKeyRef = useRef(0)
  // 公司知识库写权限管理（仅管理员可见）
  const isAdmin = user?.role === 'admin'
  const [writersBook, setWritersBook] = useState<Book | null>(null)

  // ---------- 多文库目录树状态 ----------
  const [books, setBooks] = useState<Bookshelf | null>(null)
  const [booksLoading, setBooksLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [edit, setEdit] = useState<BookEditState | null>(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  // 新建文档：两步（先选知识库+目录，再填类型与名称）
  const [newDocStep, setNewDocStep] = useState(0)
  const [newDocBookId, setNewDocBookId] = useState<number | null>(null)
  const [newDocParentId, setNewDocParentId] = useState(0)
  const [newDocType, setNewDocType] = useState<DocType>('markdown')
  const [newDocName, setNewDocName] = useState('')
  const [dirOptions, setDirOptions] = useState<{ id: number; label: string }[]>([])
  const [dirLoading, setDirLoading] = useState(false)

  // 导入：两步（先选知识库+目录，再选方式）
  const [importStep, setImportStep] = useState(0)
  const [importBookId, setImportBookId] = useState<number | null>(null)
  const [importParentId, setImportParentId] = useState(0)
  const [importMode, setImportMode] = useState<'file' | 'url'>('file')
  const [fileImport, setFileImport] = useState<{ open: boolean; bookId: number; parentId: number }>({
    open: false,
    bookId: 0,
    parentId: 0,
  })
  const [urlImport, setUrlImport] = useState<{ open: boolean; bookId: number; parentId: number }>({
    open: false,
    bookId: 0,
    parentId: 0,
  })
  // 导入/新建后刷新指定库的文档树
  const [reloadBookId, setReloadBookId] = useState<number | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // 文档移动到其他知识库
  const [moveNode, setMoveNode] = useState<DocNode | null>(null)
  const [moveTargetId, setMoveTargetId] = useState<number | null>(null)
  const [moveBooks, setMoveBooks] = useState<Book[] | null>(null)
  const [moveLoading, setMoveLoading] = useState(false)
  const [moveSaving, setMoveSaving] = useState(false)

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

  // ---------- 多文库目录树：数据与操作 ----------

  async function refreshBooks() {
    setBooksLoading(true)
    try {
      const res = await listBooks()
      setBooks({ mine: res.mine || [], visible: res.visible || [], teams: res.teams || [] })
    } finally {
      setBooksLoading(false)
    }
  }

  useEffect(() => {
    void refreshBooks()
  }, [])

  // 当前书变化时刷新左侧树中该书的数据（保持选中状态与计数最新）
  useEffect(() => {
    if (bookID) {
      setReloadBookId(bookID)
      setReloadNonce((n) => n + 1)
    }
  }, [bookID])

  function openCreateBook(cat?: 'private' | 'team' | 'company') {
    const visibility: Visibility = cat === 'team' ? 'members' : 'private'
    setEdit({ mode: 'create' })
    form.setFieldsValue({ name: '', description: '', cover_color: COVER_COLORS[0], visibility })
  }

  function openEditBook(b: Book) {
    setEdit({ mode: 'edit', book: b })
    form.setFieldsValue({
      name: b.name,
      description: b.description,
      cover_color: b.cover_color || COVER_COLORS[0],
      visibility: b.visibility,
    })
  }

  async function submitBook() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (edit?.mode === 'create') {
        await createBook(values)
        message.success('知识库已创建')
      } else if (edit?.book) {
        await updateBook(edit.book.id, {
          name: values.name,
          description: values.description,
          cover_color: values.cover_color,
        })
        message.success('知识库已更新')
        if (book?.id === edit.book.id) {
          const b = await getBook(edit.book.id)
          setBook(b)
        }
      }
      setEdit(null)
      await refreshBooks()
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteBook(b: Book) {
    await deleteBook(b.id)
    message.success('知识库已删除')
    await refreshBooks()
    if (b.id === bookID) navigate('/')
  }

  async function loadDirOptions(bookId: number) {
    setDirLoading(true)
    try {
      const docs = await getTree(bookId)
      setDirOptions([{ id: 0, label: '根目录（知识库顶层）' }, ...flattenDocs(docs)])
    } catch {
      setDirOptions([{ id: 0, label: '根目录（知识库顶层）' }])
    } finally {
      setDirLoading(false)
    }
  }

  async function openNewDoc(bookId?: number, parentId?: number) {
    setNewDocStep(1)
    setNewDocBookId(bookId ?? null)
    setNewDocParentId(parentId ?? 0)
    setNewDocType('markdown')
    setNewDocName('')
    if (bookId != null) {
      await loadDirOptions(bookId)
    } else {
      setDirOptions([])
    }
  }

  async function onNewDocBookChange(bookId: number) {
    setNewDocBookId(bookId)
    setNewDocParentId(0)
    await loadDirOptions(bookId)
  }

  async function submitNewDoc() {
    if (newDocBookId == null) return
    const name = newDocName.trim()
    try {
      const d = await createDoc(newDocBookId, newDocParentId, name, newDocType)
      setNewDocStep(0)
      message.success('文档已创建')
      setReloadBookId(newDocBookId)
      setReloadNonce((n) => n + 1)
      navigate(`/books/${newDocBookId}?docId=${d.id}&tab=edit`)
    } catch {
      /* 拦截器已提示 */
    }
  }

  async function openImport(bookId?: number, parentId?: number) {
    setImportStep(1)
    setImportBookId(bookId ?? null)
    setImportParentId(parentId ?? 0)
    setImportMode('file')
    if (bookId != null) {
      await loadDirOptions(bookId)
    } else {
      setDirOptions([])
    }
  }

  async function onImportBookChange(bookId: number) {
    setImportBookId(bookId)
    setImportParentId(0)
    await loadDirOptions(bookId)
  }

  function confirmImport() {
    if (importBookId == null) return
    setImportStep(0)
    if (importMode === 'file') {
      setFileImport({ open: true, bookId: importBookId, parentId: importParentId })
    } else {
      setUrlImport({ open: true, bookId: importBookId, parentId: importParentId })
    }
  }

  function afterImport(bookId: number) {
    setReloadBookId(bookId)
    setReloadNonce((n) => n + 1)
  }

  async function handleDuplicateDoc(_bookId: number, node: DocNode) {
    try {
      const cp = await duplicateDoc(node.id)
      message.success(`已复制为「${cp.title}」`)
      afterImport(node.book_id)
    } catch {
      /* 拦截器已提示 */
    }
  }

  async function handlePinDoc(_bookId: number, node: DocNode) {
    try {
      await pinDoc(node.id, !node.pinned_at)
      message.success(node.pinned_at ? '已取消置顶' : '已置顶')
      afterImport(node.book_id)
    } catch {
      /* 拦截器已提示 */
    }
  }

  async function openMoveDoc(_bookId: number, node: DocNode) {
    setMoveNode(node)
    setMoveTargetId(null)
    setMoveBooks(null)
    setMoveLoading(true)
    try {
      const shelf = await listBooks()
      const writable = [...shelf.mine, ...shelf.visible.filter((b) => b.visibility === 'members')]
      setMoveBooks(writable.filter((b) => b.id !== node.book_id))
    } catch {
      setMoveBooks([])
    } finally {
      setMoveLoading(false)
    }
  }

  async function submitMoveDoc() {
    if (!moveNode || !moveTargetId) return
    setMoveSaving(true)
    try {
      await moveDocToBook(moveNode.id, moveTargetId)
      const target = moveBooks?.find((b) => b.id === moveTargetId)
      message.success(`已移动到「${target?.name ?? '目标知识库'}」根目录`)
      setMoveNode(null)
      afterImport(moveNode.book_id)
      if (docIdParam === moveNode.id) setParams({ docId: 0 })
    } catch {
      /* 拦截器已提示 */
    } finally {
      setMoveSaving(false)
    }
  }

  const bookOptions = useMemo(() => {
    const all: Book[] = [...(books?.mine || []), ...(books?.teams || []), ...(books?.visible || [])]
    return all.map((b) => ({ value: b.id, label: b.name }))
  }, [books])

  const filterFn = (b: Book) => !keyword || b.name.includes(keyword)

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
        await handleDeleteBook(book)
      },
    })
  }

  /** 顶栏书头右键菜单：新建文档 / 重命名 / 修改可见性 / 导出 / 删除 */
  const bookMenu = {
    items: [
      { key: 'create', icon: <FileAddOutlined />, label: '新建文档', disabled: !canWrite },
      { key: 'rename', icon: <EditOutlined />, label: '重命名', disabled: !isOwner },
      { key: 'visibility', icon: <GlobalOutlined />, label: '修改可见性', disabled: !isOwner },
      { key: 'export', icon: <DownloadOutlined />, label: '导出' },
      { key: 'delete', icon: <DeleteOutlined />, label: '删除知识库', danger: true, disabled: !isOwner },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'create') openNewDoc(bookID, 0)
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
            {/* 书头：当前知识库概览 + 全局操作入口 */}
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
                    寄海文档
                  </div>
                  <Tooltip title="新建知识库">
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        openCreateBook('private')
                      }}
                    />
                  </Tooltip>
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
                  <span style={{ color: '#8a919f', fontSize: 12 }}>{book?.name ?? '加载中…'} · {docs.length} 篇</span>
                </div>
              </div>
            </Dropdown>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {booksLoading && <Spin style={{ display: 'block', margin: '24px auto' }} />}
              {!booksLoading && books && (
                <KnowledgeTree
                  books={{
                    mine: (books.mine || []).filter(filterFn),
                    teams: (books.teams || []).filter(filterFn),
                    visible: (books.visible || []).filter(filterFn),
                  }}
                  selectedBookId={bookID}
                  selectedDocId={docIdParam || undefined}
                  isAdmin={!!isAdmin}
                  onOpenBook={(id) => navigate(`/books/${id}`)}
                  onOpenDoc={(bid, did) => navigate(`/books/${bid}?docId=${did}`)}
                  onNewDoc={(bid, pid) => void openNewDoc(bid, pid)}
                  onImport={(bid, pid) => void openImport(bid, pid)}
                  onNewBook={(cat) => openCreateBook(cat)}
                  onEditBook={(b) => openEditBook(b)}
                  onDeleteBook={(b) => void handleDeleteBook(b)}
                  onManageWriters={(b) => setWritersBook(b)}
                  canWriteDoc={(bid) => {
                    const b = [...(books?.mine || []), ...(books?.teams || []), ...(books?.visible || [])].find((x) => x.id === bid)
                    return !!user && (b?.can_write === true || b?.owner_id === user.id || b?.visibility === 'members')
                  }}
                  onEditDoc={(_bid, d) => setParams({ docId: d.id, tab: 'edit' })}
                  onDuplicateDoc={(_bid, d) => void handleDuplicateDoc(_bid, d)}
                  onMoveDoc={(_bid, d) => void openMoveDoc(_bid, d)}
                  onPinDoc={(_bid, d) => void handlePinDoc(_bid, d)}
                  onShareDoc={(_bid, d) => openShare(d)}
                  onExportDoc={(_bid, d) => openExportDoc(d)}
                  onCollaborators={(_bid, d) => openCollaborators(d)}
                  reloadBookId={reloadBookId}
                  reloadNonce={reloadNonce}
                />
              )}
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
                <Button size="small" icon={<SafetyOutlined />} onClick={() => setWritersBook(book)}>
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
                            或 <a onClick={() => void openNewDoc(bookID, 0)}>新建文档</a>
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
        open={!!writersBook}
        onClose={() => {
          setWritersBook(null)
          if (writersBook?.id === bookID) {
            void getBook(bookID)
              .then(setBook)
              .catch(() => undefined)
          }
          void refreshBooks()
        }}
        bookId={writersBook?.id ?? bookID}
        bookName={writersBook?.name ?? book?.name}
      />

      {/* 新建 / 编辑知识库弹窗 */}
      <Modal
        title={edit?.mode === 'create' ? '新建知识库' : '编辑知识库'}
        open={!!edit}
        onOk={() => void submitBook()}
        onCancel={() => setEdit(null)}
        confirmLoading={saving}
        okText={edit?.mode === 'create' ? '创建' : '保存'}
        cancelText="取消"
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="封面色" name="cover_color">
            <Select
              options={COVER_COLORS.map((c) => ({ value: c, label: c }))}
              optionRender={(opt) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 4, background: opt.value as string }} />
                  {opt.value}
                </div>
              )}
            />
          </Form.Item>
          <Form.Item
            label="知识库名称"
            name="name"
            rules={[{ required: true, message: '请输入名称' }, { max: 128, message: '名称过长' }]}
          >
            <Input placeholder="例如：产品技术文档" />
          </Form.Item>
          <Form.Item label="简介" name="description">
            <Input.TextArea rows={2} placeholder="一句话介绍这个知识库（可选）" maxLength={512} />
          </Form.Item>
          {edit?.mode === 'create' && (
            <Form.Item label="可见性" name="visibility">
              <Select
                options={(['private', 'members', 'public'] as Visibility[]).map((v) => ({
                  value: v,
                  label: VISIBILITY_LABEL[v],
                }))}
              />
            </Form.Item>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {edit?.mode === 'edit' && edit.book ? (
              <Popconfirm
                title="删除后其下文档一并移入回收站，确定删除？"
                okText="删除"
                okType="danger"
                cancelText="取消"
                onConfirm={() => void handleDeleteBook(edit.book!)}
              >
                <Button danger>删除知识库</Button>
              </Popconfirm>
            ) : (
              <span />
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => setEdit(null)}>取消</Button>
              <Button type="primary" loading={saving} onClick={() => void submitBook()}>
                {edit?.mode === 'create' ? '创建' : '保存'}
              </Button>
            </div>
          </div>
        </Form>
      </Modal>

      {/* 新建文档：第一步 选择知识库 + 目录 */}
      <Modal
        title="新建文档 · 选择位置"
        open={newDocStep === 1}
        onCancel={() => setNewDocStep(0)}
        okText="下一步"
        cancelText="取消"
        okButtonProps={{ disabled: newDocBookId == null }}
        onOk={() => setNewDocStep(2)}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, color: '#5f6672' }}>知识库 *</div>
          <Select
            style={{ width: '100%' }}
            placeholder="选择知识库"
            value={newDocBookId ?? undefined}
            onChange={(v) => void onNewDocBookChange(v)}
            options={bookOptions}
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, color: '#5f6672' }}>目录（存放位置）</div>
          {dirLoading ? (
            <Spin size="small" />
          ) : (
            <Select
              style={{ width: '100%' }}
              placeholder="选择目录"
              value={newDocParentId}
              onChange={setNewDocParentId}
              options={dirOptions}
            />
          )}
        </div>
        <div style={{ marginTop: 12, color: '#8a919f', fontSize: 12 }}>未选择子目录时，文档将创建在知识库根目录。</div>
      </Modal>

      {/* 新建文档：第二步 类型与名称 */}
      <Modal
        title="新建文档 · 填写信息"
        open={newDocStep === 2}
        onCancel={() => setNewDocStep(0)}
        okText="创建"
        cancelText="取消"
        onOk={() => void submitNewDoc()}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, color: '#5f6672' }}>文档类型</div>
          <Select
            style={{ width: '100%' }}
            value={newDocType}
            onChange={setNewDocType}
            options={DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABEL[t] }))}
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, color: '#5f6672' }}>文档名称</div>
          <Input
            autoFocus
            placeholder="请输入文档名称"
            value={newDocName}
            onChange={(e) => setNewDocName(e.target.value)}
            onPressEnter={() => void submitNewDoc()}
          />
        </div>
      </Modal>

      {/* 导入：第一步 选择知识库 + 目录 */}
      <Modal
        title="导入 · 选择位置"
        open={importStep === 1}
        onCancel={() => setImportStep(0)}
        okText="下一步"
        cancelText="取消"
        okButtonProps={{ disabled: importBookId == null }}
        onOk={() => setImportStep(2)}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, color: '#5f6672' }}>知识库 *</div>
          <Select
            style={{ width: '100%' }}
            placeholder="选择知识库"
            value={importBookId ?? undefined}
            onChange={(v) => void onImportBookChange(v)}
            options={bookOptions}
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, color: '#5f6672' }}>目录（存放位置）</div>
          {dirLoading ? (
            <Spin size="small" />
          ) : (
            <Select
              style={{ width: '100%' }}
              placeholder="选择目录"
              value={importParentId}
              onChange={setImportParentId}
              options={dirOptions}
            />
          )}
        </div>
        <div style={{ marginTop: 12, color: '#8a919f', fontSize: 12 }}>导入的文档将落入所选知识库的该目录。</div>
      </Modal>

      {/* 导入：第二步 选择方式 */}
      <Modal
        title="导入 · 选择方式"
        open={importStep === 2}
        onCancel={() => setImportStep(0)}
        okText="确定"
        cancelText="取消"
        onOk={confirmImport}
        destroyOnClose
      >
        <Radio.Group value={importMode} onChange={(e) => setImportMode(e.target.value)}>
          <Radio value="file">从文件导入（Word / Excel / Markdown / 图片型文档等）</Radio>
          <br />
          <Radio value="url">从网页链接（URL）导入</Radio>
        </Radio.Group>
      </Modal>

      {/* 移动文档到其他知识库 */}
      <Modal
        title={`移动「${moveNode?.title ?? ''}」`}
        open={!!moveNode}
        onOk={() => void submitMoveDoc()}
        onCancel={() => setMoveNode(null)}
        okText="移动"
        okButtonProps={{ disabled: !moveTargetId }}
        confirmLoading={moveSaving}
        cancelText="取消"
        destroyOnClose
      >
        {moveLoading && <Spin style={{ display: 'block', margin: '16px auto' }} />}
        {!moveLoading && moveBooks && moveBooks.length === 0 && (
          <Empty description="没有可写入的其他知识库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        {!moveLoading && moveBooks && moveBooks.length > 0 && (
          <Select
            style={{ width: '100%' }}
            placeholder="选择目标知识库（我有编辑权限）"
            value={moveTargetId}
            onChange={setMoveTargetId}
            options={moveBooks.map((b) => ({ value: b.id, label: b.name }))}
          />
        )}
        <div style={{ marginTop: 12, color: '#8a919f', fontSize: 12 }}>
          移动后该文档及其子文档将整体迁移到目标知识库根目录末尾。
        </div>
      </Modal>

      {/* 文件导入对话框（指定目录） */}
      {fileImport.open && (
        <LazyBoundary tip="正在加载导入组件…">
          <ImportDialog
            open={fileImport.open}
            onClose={() => setFileImport((s) => ({ ...s, open: false }))}
            bookId={fileImport.bookId}
            parentId={fileImport.parentId}
            onImported={() => afterImport(fileImport.bookId)}
          />
        </LazyBoundary>
      )}

      {/* 网页链接导入对话框（指定目录） */}
      {urlImport.open && (
        <LazyBoundary tip="正在加载导入组件…">
          <UrlImportDialog
            open={urlImport.open}
            onClose={() => setUrlImport((s) => ({ ...s, open: false }))}
            defaultBookId={urlImport.bookId}
            parentId={urlImport.parentId}
            onImported={() => afterImport(urlImport.bookId)}
          />
        </LazyBoundary>
      )}
    </div>
  )
}
