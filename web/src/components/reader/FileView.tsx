import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Alert, Button, Spin, Tooltip, Typography, message } from 'antd'
import { DownloadOutlined, FileImageOutlined, FileTextOutlined, SwapOutlined } from '@ant-design/icons'
import DOMPurify from 'dompurify'
import { attachmentKind, formatSize, loadPdfjs, parseAttachment } from '../../lib/attachment'
import { useReaderWidth } from '../../lib/readerWidth'
import { createDoc } from '../../api/docs'
import CadView from './CadView'

// draw.io 组件与 echarts（经 pptx-preview 间接引入）都较重，按需加载
const DrawioEditor = lazy(() => import('../editor/DrawioEditor'))
const PptxView = lazy(() => import('./PptxView'))

/** 单个 PDF 最多渲染页数（超出部分提示下载查看，避免超长文档卡死） */
const MAX_PDF_PAGES = 120

interface Props {
  /** 附件型文档正文（FileAttachment JSON 字符串） */
  content: string
  /** 所属知识库 id：Visio 附件「另存为绘图文档」需要 */
  bookId?: number
  /** 新建绘图文档后的回调（页面据此跳转到新文档） */
  onDocCreated?: (docId: number) => void
}

/**
 * 附件型文档只读阅读（doc_type=file）：
 *  导入的各类文件按原文件保存，此处直接就地渲染（不经过任何编辑管线）：
 *   - .pdf            → pdf.js 逐页渲染到 canvas（宽度自适应容器）
 *   - .docx           → mammoth 转 HTML（DOMPurify 清洗）后只读展示
 *   - .pptx           → pptx-preview 分页渲染，支持播放/全屏/翻页
 *   - .dwg / .dxf     → 后端派生出的 SVG/PNG，可缩放拖动（见 CadView）
 *   - .vsd / .vsdx    → 内嵌 draw.io 打开（Visio 格式由 draw.io 内部转换），可导出或另存为绘图文档
 *   - 图片            → 直接展示
 *   - 其它            → 提示下载后本地查看
 *  顶部固定信息条提供"下载原文件"。
 */
export default function FileView({ content, bookId, onDocCreated }: Props) {
  // 正文宽度跟随「宽度」调节器（lib/readerWidth，与阅读页/分享页共享同一份偏好）。
  // ⚠️ 这里不能写死 780：写死之后 PDF / DOCX 会永远卡在 780px，
  //    宽度调节器看起来在动、实际对附件预览毫无影响。
  const { maxWidth } = useReaderWidth()
  const ref = parseAttachment(content)
  if (!ref) {
    return (
      <div style={{ maxWidth: maxWidth ?? undefined, margin: '0 auto', padding: '0 24px 40px' }}>
        <Alert type="warning" showIcon message="附件信息缺失或格式不正确，无法预览" />
      </div>
    )
  }
  const kind = attachmentKind(ref.ext)
  // CAD 需要带缩放/拖动的专用视口，自行处理信息条与导出
  if (kind === 'cad') return <CadView content={content} />

  return (
    <div style={{ maxWidth: maxWidth ?? undefined, margin: '0 auto', padding: '0 24px 40px', width: '100%' }}>
      {/* 附件信息条 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          background: '#f7f8fa',
          border: '1px solid #ebedf0',
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <FileTextOutlined style={{ color: '#2f54eb', fontSize: 18 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {ref.filename}
          </div>
          <div style={{ color: '#8a919f', fontSize: 12 }}>
            {ref.ext ? ref.ext.toUpperCase() : '文件'} · {formatSize(ref.size)} · 按原文件保存，不可编辑
          </div>
        </div>
        <Button size="small" icon={<DownloadOutlined />} href={ref.url} download={ref.filename} target="_blank">
          下载原文件
        </Button>
      </div>

      {kind === 'pdf' && <PdfViewer url={ref.url} filename={ref.filename} />}
      {kind === 'docx' && <DocxViewer url={ref.url} />}
      {kind === 'pptx' && (
        <Suspense fallback={<Loading tip="正在加载演示文稿预览器…" />}>
          <PptxView url={ref.url} filename={ref.filename} pptxScanned={ref.pptx_scanned} />
        </Suspense>
      )}
      {kind === 'drawio' && (
        <Suspense fallback={<Loading tip="正在加载绘图组件…" />}>
          <DrawioAttachmentView ref0={ref} bookId={bookId} onDocCreated={onDocCreated} />
        </Suspense>
      )}
      {kind === 'image' && <ImageViewer url={ref.url} filename={ref.filename} />}
      {kind === 'other' && (
        <Alert
          type="info"
          showIcon
          message="该格式暂不支持在线预览"
          description="请点击上方「下载原文件」按钮，下载后在本地打开查看。"
        />
      )}
    </div>
  )
}

function Loading({ tip }: { tip: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: '#8a919f' }}>
      <Spin size="small" /> {tip}
    </div>
  )
}

// ---------- Visio（.vsd/.vsdx）：交给 draw.io 转换并预览 ----------

function DrawioAttachmentView({
  ref0,
  bookId,
  onDocCreated,
}: {
  ref0: NonNullable<ReturnType<typeof parseAttachment>>
  bookId?: number
  onDocCreated?: (docId: number) => void
}) {
  const [saving, setSaving] = useState(false)
  // 编辑器实例：另存为绘图文档时需要向它索取转换后的 XML
  const frameHolder = useRef<{ requestXml: () => Promise<string> } | null>(null)

  /** 另存为绘图文档：把 draw.io 转换后的 XML 落成一篇新的「绘图」文档 */
  async function saveAsDrawing() {
    if (!bookId) {
      message.warning('缺少知识库信息，无法另存')
      return
    }
    setSaving(true)
    try {
      const xml = await frameHolder.current?.requestXml()
      if (!xml || !xml.trim()) throw new Error('尚未取得转换结果')
      const title = ref0.filename.replace(/\.[^.]+$/, '') || '绘图'
      const doc = await createDoc(bookId, 0, title, 'drawing', xml)
      message.success('已另存为绘图文档，可直接编辑')
      onDocCreated?.(doc.id)
    } catch (e) {
      message.error((e as Error)?.message || '另存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Visio 文件由内嵌绘图组件转换后预览"
        description={
          <span>
            转换在浏览器内完成，回写不会覆盖原文件。如需长期编辑，请点击下方「另存为绘图文档」，
            会新建一篇可编辑的绘图文档；也可直接导出 .drawio / .svg / .png。
          </span>
        }
      />
      <div style={{ marginBottom: 12 }}>
        <Tooltip title={bookId ? '' : '缺少知识库信息'}>
          <Button
            type="primary"
            size="small"
            icon={<SwapOutlined />}
            loading={saving}
            disabled={!bookId}
            onClick={() => void saveAsDrawing()}
          >
            另存为绘图文档
          </Button>
        </Tooltip>
      </div>
      <div style={{ height: 'min(66vh, 700px)', minHeight: 400, border: '1px solid #ebedf0', borderRadius: 8, overflow: 'hidden' }}>
        <DrawioEditor
          docId={0}
          initialContent=""
          title={ref0.filename.replace(/\.[^.]+$/, '')}
          mode="import"
          sourceUrl={ref0.url}
          sourceExt={ref0.ext}
          apiRef={frameHolder}
        />
      </div>
    </div>
  )
}

// ---------- 图片：原生展示 ----------

function ImageViewer({ url, filename }: { url: string; filename: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <img
        src={url}
        alt={filename}
        style={{ maxWidth: '100%', borderRadius: 6, boxShadow: '0 1px 8px rgba(0,0,0,.12)' }}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
        <FileImageOutlined /> {filename}
      </Typography.Paragraph>
    </div>
  )
}

// ---------- PDF：pdf.js 逐页渲染 ----------

/** pdf.js 文档实例：跨「宽度变化后的重渲染」复用，避免每次调宽度都重新下载 */
type PdfjsModule = typeof import('pdfjs-dist')
type PdfDoc = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>

function PdfViewer({ url, filename }: { url: string; filename: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  // 已加载的文档实例：跨「宽度变化后的重渲染」复用，避免每次调宽度都重新下载
  const pdfRef = useRef<PdfDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [numPages, setNumPages] = useState(0)
  const [rendered, setRendered] = useState(0)
  // 实际参与渲染的容器宽度（px）。0 = 尚未量到，等 ResizeObserver 报告后再渲染。
  const [renderWidth, setRenderWidth] = useState(0)

  // 监听容器宽度：用户拖「宽度」调节器（standard/wide/full/自定义）或缩放窗口时，
  // 页面要按新宽度重排重绘 —— 否则 PDF 会永远停在首次渲染时的尺寸。
  // ResizeObserver 而不是只依赖 readerWidth：容器宽度还受窗口尺寸/侧栏影响。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      if (w <= 0) return
      // 防抖：拖动条连续变化时不要每像素都重渲染一遍整本 PDF
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setRenderWidth(Math.max(320, w - 4)), 200)
    })
    ro.observe(el)
    // 首次量一次（ResizeObserver 首个回调是异步的，这里先给个即时值）
    const w0 = Math.round(el.clientWidth)
    if (w0 > 0) setRenderWidth(Math.max(320, w0 - 4))
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [])

  // 载入文档：只依赖 url —— 调宽度**不**重新下载 PDF（实例存进 pdfRef 供渲染复用）
  useEffect(() => {
    let alive = true
    let task: { destroy: () => Promise<void> } | null = null
    setLoading(true)
    setError('')
    setNumPages(0)
    setRendered(0)
    pdfRef.current = null
    ;(async () => {
      const pdfjs = await loadPdfjs()
      const loading = pdfjs.getDocument({ url })
      task = loading
      const pdf = await loading.promise
      if (!alive) {
        void pdf.destroy()
        return
      }
      pdfRef.current = pdf
      if (alive) setNumPages(pdf.numPages)
    })()
      .catch((e) => {
        if (alive) setError((e as Error)?.message || 'PDF 加载失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      pdfRef.current = null
      if (task) void task.destroy().catch(() => undefined)
    }
  }, [url])

  // 按当前宽度渲染各页：文档就绪（numPages>0）且量到宽度后执行；
  // 宽度变化时整本重排，**复用已加载的文档实例**（不重新下载）。
  useEffect(() => {
    if (numPages <= 0 || renderWidth <= 0) return
    const pdf = pdfRef.current
    if (!pdf) return
    let alive = true
    setRendered(0)
    ;(async () => {
      const limit = Math.min(pdf.numPages, MAX_PDF_PAGES)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      for (let i = 1; i <= limit; i++) {
        if (!alive) return
        const page = await pdf.getPage(i)
        const canvas = canvasRefs.current[i - 1]
        if (!canvas) continue
        const base = page.getViewport({ scale: 1 })
        // 上限放宽到 6 倍：pdf.js 是矢量渲染，放大不会糊；原先的 2 倍上限会让
        // 「拖宽到 1800px」在 A4 纸（≈595pt 宽）上被截到 1190px，宽度调不上去。
        const scale = Math.max(0.4, Math.min(6, renderWidth / base.width))
        const viewport = page.getViewport({ scale })
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        await page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise
        if (alive) setRendered(i)
      }
      // ⚠️ 不要在这里 destroy 文档实例 —— 它要跨「宽度变化后的重渲染」复用，
      //    销毁交给载入 effect 的清理函数。
    })().catch(() => {
      // 重渲染失败不弹全局错误（原文档还在）；加载阶段的错误已由上面的 effect 负责
    })
    return () => {
      alive = false
    }
  }, [numPages, renderWidth])

  return (
    <div ref={containerRef}>
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: '#8a919f' }}>
          <Spin size="small" />
          {numPages > 0 ? `正在渲染第 ${rendered + 1} / ${numPages} 页…` : '正在加载 PDF…'}
        </div>
      )}
      {error && <Alert type="error" showIcon message="PDF 预览失败" description={error} />}
      {numPages > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: Math.min(numPages, MAX_PDF_PAGES) }, (_, i) => (
            <canvas
              key={i}
              ref={(el) => {
                canvasRefs.current[i] = el
              }}
              style={{ boxShadow: '0 1px 6px rgba(0,0,0,0.12)', borderRadius: 4, background: '#fff' }}
            />
          ))}
        </div>
      )}
      {numPages > MAX_PDF_PAGES && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
          仅预览前 {MAX_PDF_PAGES} 页（共 {numPages} 页），完整内容请下载原文件查看：{filename}
        </Typography.Paragraph>
      )}
    </div>
  )
}

// ---------- DOCX：mammoth 转 HTML 后只读渲染 ----------

function DocxViewer({ url }: { url: string }) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    ;(async () => {
      const mammoth = (await import('mammoth')).default
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`无法读取文件（HTTP ${resp.status}）`)
      const arrayBuffer = await resp.arrayBuffer()
      const result = await mammoth.convertToHtml(
        { arrayBuffer },
        // 图片内联为 data URI，避免相对路径失效
        {
          convertImage: mammoth.images.imgElement(async (image) => ({
            src: `data:${image.contentType};base64,${await image.read('base64')}`,
          })),
        },
      )
      if (!alive) return
      setHtml(
        DOMPurify.sanitize(result.value, {
          FORBID_TAGS: ['style', 'script', 'noscript', 'iframe', 'object', 'embed', 'form', 'input'],
        }),
      )
    })()
      .catch((e) => {
        if (alive) setError((e as Error)?.message || 'Word 文档解析失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [url])

  if (loading) return <Loading tip="正在解析 Word 文档…" />
  if (error) return <Alert type="error" showIcon message="Word 文档预览失败" description={error} />
  if (!html.trim()) return <Alert type="info" showIcon message="文档内容为空" />
  return <div className="docx-preview" dangerouslySetInnerHTML={{ __html: html }} />
}
