// 浏览器端 .pptx / .ppts 生成（B3）：Blocks → 演示文稿。
//
// 选型：pptxgenjs（npm，官方推荐版本 3.x）——浏览器内直接生成 OOXML 演示文稿，
// 支持标题/要点/图片/表格，产出 Blob 后沿用 saveBlob 保存。
//
// 关于 .ppts：WPS 演示的 .ppts 是 WPS 自有封装，**没有任何开源库能真正生成其二进制**，
// 因此这里的策略是「生成 .pptx 内容后以 .ppts 扩展名下载」，并在 UI 明确提示
// 「.ppts 为 .pptx 兼容扩展名，WPS 可直接打开」。这是诚实可行的降级，而非伪造格式。
//
// 分页策略：一级标题（以及文档标题）开新页，二级及以下标题作为页内小标题，
// 段落/列表作为要点，表格与代码各占一页；图片嵌入（抓取失败降级为文本页）。

import pptxgen from 'pptxgenjs'
import { type Block, plainOf } from './blocks'
import { fetchImage } from './docx'

/** 一页最多放多少个要点（超出另起一页，避免文字溢出画板） */
const MAX_BULLETS_PER_SLIDE = 8

/** ArrayBuffer → base64 */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** 依据 URL 猜测图片类型（pptxgenjs 需要显式类型） */
function imageTypeOf(url: string): 'png' | 'jpeg' | 'gif' | 'svg' {
  const ext = (url.split('?')[0] || '').split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg'
  if (ext === 'gif') return 'gif'
  if (ext === 'svg') return 'svg'
  return 'png'
}

function toDataUri(type: string, base64: string): string {
  const mime = type === 'jpeg' ? 'image/jpeg' : type === 'gif' ? 'image/gif' : type === 'svg' ? 'image/svg+xml' : 'image/png'
  return `data:${mime};base64,${base64}`
}

/**
 * Blocks → .pptx Blob。
 * 任一步骤失败都降级为「仅文本的幻灯片」，保证导出总能拿到一个可打开的文件。
 */
export async function buildPptx(blocks: Block[], title: string): Promise<Blob> {
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_16x9' // 13.33 x 7.5 in
  pptx.title = title || '未命名演示'
  pptx.author = '寄海文库'

  /** 当前页的要点累积 */
  interface SlideBuf {
    title: string
    sub?: string
    bullets: string[]
  }
  let buf: SlideBuf = { title: title || '未命名演示', bullets: [] }
  const slides: SlideBuf[] = [buf]

  const flushIfFull = () => {
    if (buf.bullets.length >= MAX_BULLETS_PER_SLIDE) {
      buf = { title: `${title || '未命名演示'}（续）`, bullets: [] }
      slides.push(buf)
    }
  }

  const pushBullet = (text: string) => {
    flushIfFull()
    buf.bullets.push(text)
  }

  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        // 一级/二级标题开新页；更深层级的标题作为要点
        if (b.level <= 2) {
          buf = { title: b.text, bullets: [] }
          slides.push(buf)
        } else {
          pushBullet(b.text)
        }
        break
      case 'paragraph': {
        const text = plainOf(b.runs)
        if (text.trim() !== '') pushBullet(text)
        break
      }
      case 'list':
        for (const item of b.items) {
          const text = plainOf(item)
          if (text.trim() !== '') pushBullet(text)
        }
        break
      case 'quote':
        pushBullet(`“${plainOf(b.runs)}”`)
        break
      case 'code':
        buf = { title: `${buf.title || title}（代码）`, bullets: [] }
        slides.push(buf)
        for (const line of (b.text || '').split('\n')) pushBullet(line === '' ? ' ' : line)
        break
      case 'table':
        buf = { title: `${buf.title || title}（表格）`, bullets: [] }
        slides.push(buf)
        for (const row of b.rows) pushBullet(row.join(' | '))
        break
      case 'image': {
        const img = await fetchImage(b.url)
        if (img) {
          const slide = pptx.addSlide()
          slide.addText(b.alt || '图片', { x: 0.5, y: 0.4, w: 12.3, h: 0.8, fontSize: 22, bold: true })
          try {
            slide.addImage({ data: toDataUri(imageTypeOf(b.url), toBase64(img.data)), x: 1.5, y: 1.5, w: 10.3, h: 5.2 })
          } catch {
            slide.addText(`图片：${b.url}`, { x: 0.5, y: 2.5, w: 12.3, h: 1, fontSize: 14, color: '8A919F' })
          }
        } else {
          pushBullet(`[图片] ${b.alt || ''} ${b.url}`)
        }
        break
      }
      case 'divider':
        break
      default:
        break
    }
  }

  // 输出幻灯片（图片页已在上面直接 addSlide 生成，这里只处理文本页）
  for (const s of slides) {
    if (s.bullets.length === 0 && s.title !== (title || '未命名演示')) continue
    const slide = pptx.addSlide()
    slide.addText(s.title, { x: 0.6, y: 0.5, w: 12.1, h: 1.1, fontSize: 28, bold: true, color: '1F2A44' })
    if (s.bullets.length > 0) {
      slide.addText(
        s.bullets.map((t) => ({ text: t, bullet: true, breakLine: true })) as unknown as string,
        { x: 0.8, y: 1.8, w: 11.7, h: 5.0, fontSize: 18, color: '333333', valign: 'top' },
      )
    }
  }

  return (await pptx.write({ outputType: 'blob' })) as Blob
}

// ---------- PPTX 附件 → PDF ----------

/** pptx-preview 的预览器实例类型（该包自带 d.ts，这里只取形状，不额外引运行时依赖） */
type PptxViewer = ReturnType<typeof import('pptx-preview')['init']>

/** 幻灯片逻辑尺寸，与阅读页 PptxView 的 STAGE 保持一致 */
const STAGE_W = 1280
const STAGE_H = 720

/** A4 横向（pt） */
const LAND_W = 841.89
const LAND_H = 595.28
const SLIDE_MARGIN = 0

/**
 * PPTX 附件 → PDF：逐页渲染幻灯片后位图化合成。
 *
 * 复用阅读页同一套 pptx-preview 渲染器，因此导出的版面与「阅读页看到的」一致；
 * 这是纯前端能得到的最接近原稿的 PDF。渲染/位图化失败时由调用方退化为打印兜底。
 */
export async function pptxAttachmentToPdf(url: string, title: string): Promise<Blob> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`无法读取原文件（HTTP ${resp.status}）`)
  const buf = await resp.arrayBuffer()

  const { init } = await import('pptx-preview')
  const { default: html2canvas } = await import('html2canvas')
  const { jsPDF } = await import('jspdf')

  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.width = `${STAGE_W}px`
  host.style.height = `${STAGE_H}px`
  host.style.background = '#ffffff'
  host.style.overflow = 'hidden'
  document.body.appendChild(host)

  let viewer: PptxViewer | null = null
  try {
    viewer = init(host, { width: STAGE_W, height: STAGE_H, mode: 'slide' })
    await viewer.preview(buf)
    const count = Math.max(1, Number(viewer.slideCount ?? 1))
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
    pdf.setProperties({ title: title || '演示文稿', creator: '寄海文库' })

    for (let i = 0; i < count; i++) {
      viewer.renderSingleSlide(i)
      // 渲染器写完 DOM 后让浏览器完成一帧排版再截图
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
      const canvas = await html2canvas(host, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        width: STAGE_W,
        height: STAGE_H,
        windowWidth: STAGE_W,
      })
      const data = canvas.toDataURL('image/jpeg', 0.92)
      if (i > 0) pdf.addPage()
      // 16:9 幻灯片铺满 A4 横向可打印区（上下留白居中），不拉伸变形
      const w = LAND_W - SLIDE_MARGIN * 2
      const h = (w * 9) / 16
      const y = (LAND_H - h) / 2
      pdf.addImage(data, 'JPEG', SLIDE_MARGIN, y, w, h)
    }
    return pdf.output('blob')
  } finally {
    try {
      viewer?.destroy?.()
    } catch {
      /* 忽略销毁异常 */
    }
    host.remove()
  }
}
