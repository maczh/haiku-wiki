// 浏览器端 PDF 导出（B2/B3 共用）：渲染后的 HTML → PDF。
//
// 方案：html2canvas（把正文 DOM 画成位图）+ jsPDF（A4 分页合成）。
// 这是纯前端方案里最通用的一条路：不依赖服务端字体与渲染器，
// 所见即所得（用的就是阅读页同一份渲染结果）。
//
// 兜底：位图化失败（跨域图片污染画布、超长文档等）时退化为「打印为 PDF」——
// 打开一个只读的打印视图，由用户在系统打印对话框里选择「另存为 PDF」。

import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import DOMPurify from 'dompurify'

/** A4 纵向（pt）与页边距 */
const A4_W = 595.28
const A4_H = 841.89
const MARGIN = 28

/** 渲染区宽度（px）：约等于 A4 可打印宽度，保证排版与 PDF 一致 */
const RENDER_WIDTH = 794

/**
 * 把 HTML 渲染成 PDF。
 * @param html 正文 HTML（由 lib/export/html.ts 生成，进入 DOM 前已清洗）
 */
export async function htmlToPdf(html: string, title: string): Promise<Blob> {
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.width = `${RENDER_WIDTH}px`
  host.style.background = '#fff'
  host.style.padding = '24px'
  host.style.boxSizing = 'border-box'
  host.style.fontFamily = '-apple-system, "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif'
  host.style.fontSize = '15px'
  host.style.lineHeight = '1.8'
  host.style.color = '#1f2a44'
  host.innerHTML = DOMPurify.sanitize(html, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed'] })
  document.body.appendChild(host)
  try {
    await waitImages(host)
    const canvas = await html2canvas(host, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: RENDER_WIDTH,
    })
    return await canvasToPdf(canvas, title)
  } finally {
    host.remove()
  }
}

/** canvas → A4 多页 PDF（按页高切片，避免单页图片过大导致内存/清晰度问题） */
async function canvasToPdf(canvas: HTMLCanvasElement, title: string): Promise<Blob> {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  pdf.setProperties({ title: title || '文档', creator: '寄海文库' })

  const contentW = A4_W - MARGIN * 2
  const contentH = A4_H - MARGIN * 2
  // canvas 上「一页内容」对应的像素高度
  const pagePx = Math.floor((canvas.width * contentH) / contentW)
  const pages = Math.max(1, Math.ceil(canvas.height / pagePx))

  for (let p = 0; p < pages; p++) {
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = Math.min(pagePx, canvas.height - p * pagePx)
    const ctx = slice.getContext('2d')
    if (!ctx) throw new Error('画布上下文创建失败')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, slice.width, slice.height)
    ctx.drawImage(canvas, 0, -p * pagePx)
    const data = slice.toDataURL('image/jpeg', 0.92)
    if (p > 0) pdf.addPage()
    const h = (slice.height * contentW) / slice.width
    pdf.addImage(data, 'JPEG', MARGIN, MARGIN, contentW, Math.min(h, contentH))
  }
  return pdf.output('blob')
}

/** 等待容器内的图片加载完成（最多 5s，超时不等，避免导出卡死） */
function waitImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'))
  if (imgs.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    let left = imgs.length
    const done = () => {
      left -= 1
      if (left <= 0) resolve()
    }
    const timer = setTimeout(resolve, 5000)
    for (const img of imgs) {
      if (img.complete) {
        done()
        continue
      }
      img.addEventListener('load', done, { once: true })
      img.addEventListener('error', done, { once: true })
    }
    // 全部同步完成时立刻结束计时器
    if (left <= 0) clearTimeout(timer)
  })
}

/**
 * 打印兜底：打开一个只读打印视图并调起系统打印对话框。
 * 用于 html2canvas 失败（如跨域图片污染画布）或目标类型无法位图化的场景。
 */
export function printHtml(html: string, title: string): void {
  const win = window.open('', '_blank', 'noopener,width=900,height=700')
  if (!win) {
    throw new Error('浏览器阻止了弹出窗口，请允许弹出窗口后重试')
  }
  const safe = DOMPurify.sanitize(html, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed'] })
  win.document.write(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>@page{size:A4;margin:16mm}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",Helvetica,Arial,sans-serif;` +
      `font-size:14px;line-height:1.8;color:#1f2a44;max-width:780px;margin:0 auto;padding:16px}img{max-width:100%}</style></head>` +
      `<body><h1>${escapeHtml(title)}</h1>${safe}</body></html>`,
  )
  win.document.close()
  win.focus()
  // 等排版完成再调打印（部分浏览器立即 print 会拿到空白页）
  setTimeout(() => {
    try {
      win.print()
    } catch {
      /* 用户取消或浏览器不支持：视图已打开，可手动 Ctrl/Cmd+P */
    }
  }, 400)
}

function escapeHtml(s: string): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}
