import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Radio, Spin, Typography, message } from 'antd'
import { exportBookBlob, exportDocBlob, getDoc, getExportFormats, saveBlob } from '../../api/docs'
import {
  CLIENT_FORMAT_EXT,
  clientFormatsFor,
  exportClientDoc,
  printClientDoc,
  safeFilename,
  type ClientFormat,
} from '../../lib/export'
import type { DocExportFormats, DocType } from '../../types'

export interface ExportTarget {
  kind: 'doc' | 'book'
  /** doc 模式必填 */
  docId?: number
  /** book 模式必填 */
  bookId?: number
  /** 默认文件名（文档标题/知识库名，不含扩展名） */
  title: string
  /** doc 模式的文档类型（决定可选格式；真实格式清单以服务端返回为准） */
  docType?: DocType
}

/** 浏览器端格式的选项值统一带前缀，与服务端格式值（md/docx/xlsx…）区分 */
const CLIENT_PREFIX = 'client:'

interface Option {
  value: string
  label: string
  ext: string
}

/**
 * 导出对话框。
 *
 * 两条产出路径并存：
 *  · 服务端转换（单一事实来源 GET /api/export/docs/:id/formats）：md / xlsx / csv /
 *    km / smm / xmind / mm / ics / drawio…，前端只负责保存返回的二进制流；
 *  · 浏览器端转换（lib/export）：Word .docx、演示 .pptx/.ppts、PDF .pdf ——
 *    这些要么服务端做不了，要么在浏览器里能拿到更好的排版与图片还原。
 * 附件型（doc_type=file）默认「原样下载原文件」，但若是 docx/pptx 会额外给出
 * 浏览器端可做的格式（docx 转 PDF、pptx 转 .ppts / PDF）。
 *
 * 保存：浏览器支持 File System Access API 时弹系统保存对话框，否则降级浏览器下载。
 */
export default function ExportDialog({
  open,
  onClose,
  target,
}: {
  open: boolean
  onClose: () => void
  target: ExportTarget | null
}) {
  const [format, setFormat] = useState<string>('')
  const [filename, setFilename] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fallbackTip, setFallbackTip] = useState(false)
  const [meta, setMeta] = useState<DocExportFormats | null>(null)
  const [loadError, setLoadError] = useState('')
  /** 浏览器端 PDF 位图化失败时，提供「打印为 PDF」兜底入口 */
  const [pdfFallback, setPdfFallback] = useState('')
  /** 已取回的文档正文（浏览器端导出需要；按需拉取，同一目标只取一次） */
  const contentRef = useRef<{ docId: number; content: string } | null>(null)

  const isBook = target?.kind === 'book'
  const isAttachment = !isBook && !!meta?.is_file
  /**
   * 附件里只有 CAD（.dwg/.dxf）有服务端派生出的可选格式（svg/png），
   * 其余附件（docx/pdf/pptx…）只有"原文件"一种，无需让用户选。
   */
  const allFormats = meta?.formats ?? []
  const isCadAttachment = isAttachment && allFormats.length > 1
  /**
   * 绘图文档（doc_type=drawing）的 .svg/.png/.vsdx 需要浏览器侧 mxGraph 渲染，
   * 服务端无法生成，因此这里只暴露 .drawio，并引导用户去编辑器里导出其余格式。
   */
  const isDrawing = !isBook && meta?.doc_type === 'drawing'
  const serverFormats = isDrawing ? allFormats.filter((f) => f.value === 'drawio') : allFormats

  const fileExt = extOf(meta?.filename ?? '')
  const docType: DocType = (meta?.doc_type ?? target?.docType ?? 'markdown') as DocType
  /** 浏览器端可额外提供的格式（附件型按扩展名给，其余类型全给） */
  const clientOpts: Option[] = isBook
    ? []
    : clientFormatsFor(docType, fileExt).map((o) => ({
        value: CLIENT_PREFIX + o.value,
        label: o.label,
        ext: CLIENT_FORMAT_EXT[o.value],
      }))

  const options: Option[] = [
    ...serverFormats.map((f) => ({ value: f.value, label: f.label, ext: f.ext })),
    ...clientOpts,
  ]
  /** 有得选才展示单选列表：普通附件只有「原文件」一种，不需要 */
  const pickable = !isBook && (serverFormats.length > 0 || clientOpts.length > 0)
  const isClientFormat = format.startsWith(CLIENT_PREFIX)
  const clientFormat = (isClientFormat ? format.slice(CLIENT_PREFIX.length) : '') as ClientFormat | ''
  const spec = options.find((o) => o.value === format)
  const ext = isBook
    ? 'md.zip'
    : isAttachment && !isCadAttachment && clientOpts.length === 0
      ? fileExt || 'bin'
      : spec?.ext || 'md'

  // 每次打开时按目标重置，并向服务端拉取该文档的可用格式
  useEffect(() => {
    if (!open || !target) return
    setFallbackTip(typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker !== 'function')
    setFilename(target.title)
    setLoadError('')
    setPdfFallback('')
    setMeta(null)
    setFormat('')
    contentRef.current = null
    if (target.kind === 'book') return

    let alive = true
    setLoading(true)
    getExportFormats(target.docId!)
      .then((m) => {
        if (!alive) return
        setMeta(m)
        setFormat(m.default || m.formats?.[0]?.value || '')
      })
      .catch((e) => {
        if (alive) setLoadError((e as Error)?.message || '获取导出格式失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, target])

  /** 取正文（浏览器端导出用），按 docId 缓存 */
  async function contentOf(docId: number): Promise<string> {
    if (contentRef.current?.docId === docId) return contentRef.current.content
    const d = await getDoc(docId)
    const content = (d as { content?: string }).content ?? ''
    contentRef.current = { docId, content }
    return content
  }

  /** 执行导出：服务端转换或浏览器端转换 → saveBlob（picker 优先，降级下载） */
  async function doExport() {
    if (!target) return
    setSaving(true)
    setPdfFallback('')
    try {
      let blob: Blob
      let name: string
      if (target.kind === 'book') {
        const r = await exportBookBlob(target.bookId!, target.title)
        blob = r.blob
        name = r.filename
      } else if (isClientFormat && clientFormat) {
        const docId = target.docId!
        const content = await contentOf(docId)
        const r = await exportClientDoc(clientFormat, {
          docType,
          content,
          title: filename.trim() || target.title,
          fileUrl: attachmentUrl(content),
          fileExt,
        })
        blob = r.blob
        name = safeFilename(filename.trim() || target.title, r.ext)
        if (r.note) message.info(r.note)
      } else {
        const r = await exportDocBlob(target.docId!, target.title, pickable ? format : undefined)
        blob = r.blob
        const typed = filename.trim()
        // 用户改过文件名 → 以自己的命名为准；否则沿用服务端命名（扩展名与去重更可靠）
        name = typed && typed !== target.title ? `${typed}.${ext}` : r.filename
      }
      const how = await saveBlob(blob, name)
      if (how === 'picker') message.success(`已导出：${name}`)
      else message.info(`文件将保存到浏览器下载目录：${name}`)
      onClose()
    } catch (e) {
      const msg = (e as Error)?.message || '导出失败'
      if (isClientFormat && clientFormat === 'pdf') {
        // 位图化失败（跨域图片污染画布、超长文档等）→ 给出打印兜底而不是就此失败
        setPdfFallback(msg)
        message.warning('直接生成 PDF 失败，可改用「打印为 PDF」')
      } else {
        message.error(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  /** 打印兜底：打开只读打印视图，由用户在系统对话框里「另存为 PDF」 */
  async function doPrint() {
    if (!target) return
    setSaving(true)
    try {
      const content = await contentOf(target.docId!)
      await printClientDoc({
        docType,
        content,
        title: filename.trim() || target.title,
        fileUrl: attachmentUrl(content),
        fileExt,
      })
      message.info('已打开打印视图，请在打印对话框中选择「另存为 PDF」')
    } catch (e) {
      message.error((e as Error)?.message || '打开打印视图失败')
    } finally {
      setSaving(false)
    }
  }

  const okDisabled = isBook ? false : loading || !!loadError || (pickable && !format)

  return (
    <Modal
      title="导出"
      open={open && !!target}
      onCancel={onClose}
      onOk={() => void doExport()}
      confirmLoading={saving}
      okButtonProps={{ disabled: okDisabled }}
      okText={
        isAttachment && !isCadAttachment && clientOpts.length === 0 ? '下载原文件' : clientFormat === 'pdf' ? '生成 PDF' : '导出'
      }
      cancelText="取消"
      destroyOnClose
      width={500}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {isBook
          ? '知识库将按目录结构导出为 Markdown 压缩包（附件型文档按原文件打包）'
          : isCadAttachment
            ? '图纸原文件与后端转换出的矢量图/位图均可导出'
            : isAttachment
              ? '该文档为导入的原始文件；下面可选的格式里，「原文件」与上传时完全一致，其余由浏览器转换生成'
              : '选择导出格式：标注「服务端」的由服务端转换，标注「浏览器」的在浏览器内转换（排版与图片还原更好）'}
      </Typography.Paragraph>

      {loading && (
        <div style={{ padding: '12px 0' }}>
          <Spin size="small" /> <span style={{ marginLeft: 8, color: '#8a919f' }}>正在获取可用格式…</span>
        </div>
      )}

      {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 12 }} />}

      {!isBook && !loading && !loadError && isAttachment && !isCadAttachment && clientOpts.length === 0 && (
        <Alert
          type="info"
          showIcon
          message={meta?.filename || '原始文件'}
          description="导出的文件名与内容与上传时完全一致。"
        />
      )}

      {isDrawing && !loading && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="绘图文档这里仅支持导出 .drawio"
          description=".svg / .png / .vsdx 需要在浏览器里由绘图内核渲染，服务端无法生成。请在绘图编辑器内点击顶部「导出」按钮获取这些格式。"
        />
      )}

      {clientFormat === 'ppts' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="关于 .ppts"
          description=".ppts 是 WPS 演示的自有封装，开源库无法生成真正的 .ppts 二进制；这里以「标准 .pptx 内容 + .ppts 扩展名」保存，WPS 可直接打开，PowerPoint 请把扩展名改回 .pptx。"
        />
      )}

      {pdfFallback && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="直接生成 PDF 失败"
          description={pdfFallback}
          action={
            <Button size="small" onClick={() => void doPrint()}>
              打印为 PDF
            </Button>
          }
        />
      )}

      {!isBook && !loading && !loadError && pickable && (
        <Radio.Group
          value={format}
          onChange={(e) => {
            setFormat(e.target.value)
            setPdfFallback('')
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {options.map((o) => (
            <Radio key={o.value} value={o.value}>
              {o.label}
            </Radio>
          ))}
        </Radio.Group>
      )}

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          onPressEnter={() => !okDisabled && void doExport()}
          placeholder="文件名"
          addonAfter={'.' + ext}
        />
      </div>
      {fallbackTip && (
        <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
          当前浏览器不支持系统保存对话框，文件将保存到浏览器下载目录。
        </Typography.Text>
      )}
    </Modal>
  )
}

/** 从文件名取扩展名（小写，不含点）；无扩展名返回空串 */
function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** 附件型正文是 FileAttachment JSON，取其文件 URL（非 JSON 时返回 undefined） */
function attachmentUrl(content: string): string | undefined {
  if (!content) return undefined
  try {
    const v: unknown = JSON.parse(content)
    if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') {
      return (v as { url: string }).url
    }
  } catch {
    /* 非 JSON 正文：不是附件 */
  }
  return undefined
}
