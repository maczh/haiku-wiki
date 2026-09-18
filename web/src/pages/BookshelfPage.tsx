import { useEffect, useMemo, useState, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Empty, Form, Input, Modal, Popconfirm, Radio, Select, Spin, message } from 'antd'
import { FileAddOutlined, ImportOutlined, PlusOutlined } from '@ant-design/icons'
import { listBooks, createBook, deleteBook, updateBook } from '../api/books'
import { createDoc, getTree } from '../api/docs'
import KnowledgeTree from '../components/tree/KnowledgeTree'
import CompanyKBWritersModal from '../components/admin/CompanyKBWritersModal'
import { buildChildrenMap } from '../stores/docTreeStore'
import { useAuthStore } from '../stores/authStore'
import type { BookWithCount, Bookshelf, DocNode, DocType, Visibility } from '../types'
import { COVER_COLORS, DOC_TYPES, DOC_TYPE_LABEL, VISIBILITY_LABEL } from '../types'
import LazyBoundary from '../components/common/LazyBoundary'

// ⚠️ 必须懒加载：ImportDialog 会静态拉入 lib/import/parse.ts（SheetJS/turndown/jszip 等）
const ImportDialog = lazy(() => import('../components/import/ImportDialog'))
const UrlImportDialog = lazy(() => import('../components/import/UrlImportDialog'))

interface EditState {
  mode: 'create' | 'edit'
  book?: BookWithCount
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

/** 书架页：树型目录（私人 / 团队 / 公司知识库 → 知识库 → 文档与子目录）。 */
export default function BookshelfPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [data, setData] = useState<Bookshelf | null>(null)
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [edit, setEdit] = useState<EditState | null>(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  // 公司知识库写权限管理
  const [writersBook, setWritersBook] = useState<BookWithCount | null>(null)

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
  // 实际导入对话框（文件 / 网页链接）
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

  async function refresh() {
    setLoading(true)
    try {
      const res = await listBooks()
      setData({ mine: res.mine || [], visible: res.visible || [], teams: res.teams || [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  // ---- 新建知识库（复用原有弹窗逻辑） ----
  function openCreate(cat?: 'private' | 'team' | 'company') {
    const visibility: Visibility = cat === 'team' ? 'members' : 'private'
    setEdit({ mode: 'create' })
    form.setFieldsValue({ name: '', description: '', cover_color: COVER_COLORS[0], visibility })
  }

  function openEdit(book: BookWithCount) {
    setEdit({ mode: 'edit', book })
    form.setFieldsValue({
      name: book.name,
      description: book.description,
      cover_color: book.cover_color || COVER_COLORS[0],
      visibility: book.visibility,
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
      }
      setEdit(null)
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteBook(book: BookWithCount) {
    Modal.confirm({
      title: `删除知识库「${book.name}」？`,
      content: '知识库及其下文档将一并移入回收站，确定删除？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await deleteBook(book.id)
        message.success('知识库已删除')
        await refresh()
      },
    })
  }

  // ---- 新建文档：选择目标 ----
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

  async function onNewDocBookChange(bookId: number) {
    setNewDocBookId(bookId)
    setNewDocParentId(0)
    await loadDirOptions(bookId)
  }

  async function submitNewDoc() {
    if (newDocBookId == null) return
    const name = newDocName.trim()
    try {
      const doc = await createDoc(newDocBookId, newDocParentId, name, newDocType)
      setNewDocStep(0)
      message.success('文档已创建')
      // 打开新文档
      navigate(`/books/${newDocBookId}?docId=${doc.id}`)
    } catch {
      /* 拦截器已提示 */
    }
  }

  // ---- 导入：选择目标 ----
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

  const bookOptions = useMemo(() => {
    const all: BookWithCount[] = [...(data?.mine || []), ...(data?.teams || []), ...(data?.visible || [])]
    return all.map((b) => ({ value: b.id, label: b.name }))
  }, [data])

  const filterFn = (b: BookWithCount) => !keyword || b.name.includes(keyword)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 24px', gap: 12, borderBottom: '1px solid #ebedf0' }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>书架</h2>
        <Input.Search
          placeholder="按名称过滤知识库"
          allowClear
          style={{ width: 220 }}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div style={{ flex: 1 }} />
        <Button icon={<FileAddOutlined />} onClick={() => void openNewDoc()}>
          新建文档
        </Button>
        <Button icon={<ImportOutlined />} onClick={() => void openImport()}>
          导入
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate('private')}>
          新建知识库
        </Button>
      </div>

      {/* 树型目录 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && <Spin style={{ display: 'block', margin: '80px auto' }} />}
        {!loading && data && (
          <KnowledgeTree
            books={{
              mine: (data.mine || []).filter(filterFn),
              teams: (data.teams || []).filter(filterFn),
              visible: (data.visible || []).filter(filterFn),
            }}
            isAdmin={!!isAdmin}
            onOpenBook={(id) => navigate(`/books/${id}`)}
            onOpenDoc={(bid, did) => navigate(`/books/${bid}?docId=${did}`)}
            onNewDoc={(bid, pid) => void openNewDoc(bid, pid)}
            onImport={(bid, pid) => void openImport(bid, pid)}
            onNewBook={(cat) => openCreate(cat)}
            onEditBook={(b) => openEdit(b)}
            onDeleteBook={(b) => void handleDeleteBook(b)}
            onManageWriters={(b) => setWritersBook(b)}
            reloadBookId={reloadBookId}
            reloadNonce={reloadNonce}
          />
        )}
        {!loading && data && (data.mine.length + data.teams.length + data.visible.length) === 0 && (
          <Empty description="还没有知识库，点击右上角新建" style={{ marginTop: 60 }} />
        )}
      </div>

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
        confirmLoading={saving}
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

      {/* 公司知识库写权限管理 */}
      {writersBook && (
        <CompanyKBWritersModal open onClose={() => setWritersBook(null)} bookId={writersBook.id} bookName={writersBook.name} />
      )}
    </div>
  )
}
