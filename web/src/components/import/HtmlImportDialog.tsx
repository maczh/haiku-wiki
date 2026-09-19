import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Upload, message } from 'antd'
import { FileZipOutlined, FolderOpenOutlined, Html5Outlined, InboxOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { importHtml } from '../../api/docs'
import { listBooks } from '../../api/books'

interface Props {
  open: boolean
  onClose: () => void
  defaultBookId: number
  parentId?: number
  onImported: () => void
}

type Mode = 'zip' | 'page' | 'dir'

/** 三种来源说明（界面上直接告诉用户各自适合什么） */
const MODES: { key: Mode; icon: JSX.Element; title: string; desc: string }[] = [
  { key: 'zip', icon: <FileZipOutlined />, title: 'zip 包', desc: '导出好的整站压缩包，服务端解压后原样保存' },
  { key: 'page', icon: <Html5Outlined />, title: '单个页面', desc: '一个 .html 文件（外链资源会失效，建议用 zip）' },
  { key: 'dir', icon: <FolderOpenOutlined />, title: '网页目录', desc: '选中整个文件夹，保留内部相对路径' },
]

/**
 * HTML 导入：单个页面 / zip 包 / 一个网页目录，导入后**原样保存、不做任何转换**，
 * 阅读页用 iframe 加载入口文件，效果与本地打开完全一致。
 *
 * 目录导入用 webkitdirectory（Chrome/Edge 支持）拿到整个文件夹；
 * 因为 multipart 的 filename 不带相对路径，前端要把 webkitRelativePath 通过
 * paths 字段一并交给服务端，否则目录结构会塌成一堆平铺文件。
 */
export default function HtmlImportDialog({ open, onClose, defaultBookId, parentId = 0, onImported }: Props) {
  const [mode, setMode] = useState<Mode>('zip')
  const [files, setFiles] = useState<UploadFile[]>([])
  const [title, setTitle] = useState('')
  const [bookId, setBookId] = useState<number | null>(defaultBookId)
  const [books, setBooks] = useState<{ id: number; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  // 目录模式下 antd Upload 不给 File 列表，需要自己拿 input.files
  const dirInputRef = useRef<HTMLInputElement | null>(null)
  const [dirFiles, setDirFiles] = useState<File[]>([])

  useEffect(() => {
    if (!open) return
    setMode('zip')
    setFiles([])
    setDirFiles([])
    setTitle('')
    setBookId(defaultBookId)
    listBooks()
      .then((shelf) => {
        const all = [...(shelf.mine || []), ...(shelf.teams || [])]
        setBooks(all.map((b) => ({ id: b.id, name: b.name })))
      })
      .catch(() => setBooks([]))
  }, [open, defaultBookId])

  /** 提交前统一整理成 (File[] + 相对路径[]) */
  function collect(): { files: File[]; paths: string[] } {
    if (mode === 'dir') {
      return {
        files: dirFiles,
        paths: dirFiles.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name),
      }
    }
    // originFileObj 是 RcFile（比 File 多 uid 等字段），直接收窄会报类型不兼容，
    // 这里显式构造 File 列表：传给后端的本来就该是纯文件
    const list: File[] = []
    for (const f of files) {
      if (f.originFileObj) list.push(f.originFileObj as unknown as File)
    }
    return { files: list, paths: list.map((f) => f.name) }
  }

  async function submit() {
    const { files: fs, paths } = collect()
    if (fs.length === 0) {
      message.warning('请先选择要导入的文件')
      return
    }
    if (!bookId) {
      message.warning('请选择导入到的知识库')
      return
    }
    setSaving(true)
    try {
      await importHtml({ files: fs, paths, bookId, parentId, title: title.trim() || undefined })
      message.success('已导入为网页文档')
      onImported()
      onClose()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导入失败')
    } finally {
      setSaving(false)
    }
  }

  const accept = mode === 'zip' ? '.zip' : mode === 'page' ? '.html,.htm' : undefined

  return (
    <Modal
      open={open}
      title={
        <span>
          <Html5Outlined /> 导入 HTML 页面
        </span>
      }
      width={640}
      okText="导入"
      cancelText="取消"
      confirmLoading={saving}
      onOk={submit}
      onCancel={onClose}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="原样保存，不做任何转换"
        description="网页包里的样式、脚本与图片会按原结构一起保存，打开后与本地双击 index.html 的效果一致。"
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {MODES.map((m) => (
          <Button
            key={m.key}
            icon={m.icon}
            type={mode === m.key ? 'primary' : 'default'}
            onClick={() => {
              setMode(m.key)
              setFiles([])
              setDirFiles([])
            }}
          >
            {m.title}
          </Button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: '#8a919f', marginBottom: 12 }}>
        {MODES.find((m) => m.key === mode)?.desc}
      </div>

      {mode === 'dir' ? (
        <div>
          {/* 目录选择必须走原生 input：antd Upload 不支持 webkitdirectory */}
          <input
            ref={dirInputRef}
            type="file"
            // @ts-expect-error 非标准属性：Chrome/Edge 用于选择整个目录
            webkitdirectory=""
            directory=""
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const list = Array.from(e.target.files || [])
              // 过滤掉系统垃圾文件，避免把 .DS_Store 之类也传上去
              setDirFiles(list.filter((f) => !f.name.startsWith('.')))
            }}
          />
          <Button icon={<FolderOpenOutlined />} onClick={() => dirInputRef.current?.click()}>
            选择文件夹
          </Button>
          <div style={{ marginTop: 8, fontSize: 12, color: '#6a7280' }}>
            {dirFiles.length > 0 ? `已选 ${dirFiles.length} 个文件` : '未选择'}
          </div>
        </div>
      ) : (
        <Upload.Dragger
          accept={accept}
          multiple={mode === 'page'}
          beforeUpload={() => false} // 不自动上传：等用户点「导入」时统一提交
          fileList={files}
          onChange={({ fileList }) => setFiles(fileList.slice(-1))}
          onRemove={() => {
            setFiles([])
            return true
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽到此处</p>
          <p className="ant-upload-hint">{mode === 'zip' ? '支持 .zip 网页包' : '支持 .html / .htm 页面'}</p>
        </Upload.Dragger>
      )}

      <Input
        placeholder="标题（可选）"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ marginTop: 12 }}
        maxLength={120}
      />
      <Select
        style={{ width: '100%', marginTop: 12 }}
        placeholder="导入到知识库"
        value={bookId ?? undefined}
        onChange={setBookId}
        options={books.map((b) => ({ value: b.id, label: b.name }))}
      />
    </Modal>
  )
}
