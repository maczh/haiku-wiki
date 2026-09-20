// 文档正文 → 可打印/可位图化的 HTML（PDF 导出与打印兜底的共同输入）。
//
// markdown：离屏容器 + Vditor.preview（与阅读页同一渲染内核，排版一致，含代码高亮、数学公式
//   与真实 mermaid 图形）→ 等 mermaid 注入 → 保真清洗；
// 其余类型：按 Blocks 生成一份朴素 HTML（够打印、够分页即可）。
// docx 附件：用 mammoth 把 .docx 转成 HTML（阅读页已有同样的能力）。

import Vditor from 'vditor'
import mammoth from 'mammoth'
import DOMPurify from 'dompurify'
import { sanitizePreservingMermaid, waitForMermaidBlocks } from '../mermaidRender'
import { contentToBlocks, plainOf, type Block } from './blocks'
import type { DocType } from '../../types'

/** Vditor 渲染选项：与阅读页保持一致（自托管资源，避免外网 CDN） */
const VDITOR_OPTS = {
  cdn: '/vditor',
  mode: 'light' as const,
  hljs: { style: 'github', lineNumber: false },
  math: { engine: 'KaTeX' as const },
}

/** 离屏渲染区宽度（px）：约等于 A4 可打印宽度，与 pdf.ts 的 RENDER_WIDTH 对齐 */
const OFFSCREEN_WIDTH = 794

/**
 * markdown → HTML（含真实 mermaid 图形）。
 *
 * 原实现用 `Vditor.md2html`，它**不触发任何渲染器**，因此导出的 HTML/PDF 里 mermaid 只会是
 * 一段代码块。这里改为「离屏容器 + `Vditor.preview` + 等 mermaid + 保真清洗」的等价实现：
 * `Vditor.preview` 与阅读页同一条渲染链路（会调用 mermaidRender 生成 `<svg>`），
 * 产出的 HTML 可直接进 html2canvas（pdf.ts）或打印视图。
 */
async function markdownToHtml(markdown: string): Promise<string> {
  const host = document.createElement('div')
  host.className = 'vditor-reset'
  // 离屏但仍在文档内：`Vditor.preview` 会向容器注入 DOM 并依据容器做渲染定位，
  // 放到视口外（left:-10000px）既保证定位正确，又不影响用户可见页面。
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.width = `${OFFSCREEN_WIDTH}px`
  host.style.background = '#ffffff'
  document.body.appendChild(host)
  try {
    // 注意：`Vditor.preview` 返回的 Promise 虽在 `after` 之后才 resolve，但 mermaid 渲染是
    // fire-and-forget（见 lib/mermaidRender.ts 文件头「事实 1」），故必须显式再等一次 SVG 注入。
    await Vditor.preview(host, markdown, VDITOR_OPTS)
    await waitForMermaidBlocks(host)
    sanitizePreservingMermaid(host)
    return host.innerHTML
  } finally {
    // 清理离屏容器与副作用，避免残留 DOM
    host.remove()
  }
}

/** 任意文档类型 → HTML */
export async function contentToHtml(docType: DocType, content: string, title: string): Promise<string> {
  const head = `<h1>${escapeHtml(title)}</h1>`
  if (docType === 'markdown') {
    try {
      // 离屏 preview 的产物已经过 sanitizePreservingMermaid 清洗，**不能**再整体跑一次
      // `DOMPurify.sanitize` —— 那会删掉 mermaid 的 <foreignObject>（图变空框，见
      // lib/mermaidRender.ts 文件头「事实 2」）。head 本身是转义后的纯文本，直接拼接即可。
      return head + (await markdownToHtml(content ?? ''))
    } catch {
      // 渲染器异常（或非浏览器环境）时退化为 blocks → HTML，保证还有东西可导出
      return sanitize(head + blocksToHtml(contentToBlocks(docType, content)))
    }
  }
  return sanitize(head + blocksToHtml(contentToBlocks(docType, content)))
}

/** Blocks → 朴素 HTML */
export function blocksToHtml(blocks: Block[]): string {
  const out: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(`<h${Math.min(6, Math.max(1, b.level))}>${escapeHtml(b.text)}</h${Math.min(6, Math.max(1, b.level))}>`)
        break
      case 'paragraph':
        out.push(`<p>${escapeHtml(plainOf(b.runs))}</p>`)
        break
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul'
        out.push(`<${tag}>${b.items.map((it) => `<li>${escapeHtml(plainOf(it))}</li>`).join('')}</${tag}>`)
        break
      }
      case 'code':
        out.push(`<pre><code>${escapeHtml(b.text ?? '')}</code></pre>`)
        break
      case 'quote':
        out.push(`<blockquote>${escapeHtml(plainOf(b.runs))}</blockquote>`)
        break
      case 'table': {
        if (b.rows.length === 0) break
        const body = b.rows
          .map(
            (row, ri) =>
              `<tr>${row.map((c) => (ri === 0 ? `<th>${escapeHtml(c)}</th>` : `<td>${escapeHtml(c)}</td>`)).join('')}</tr>`,
          )
          .join('')
        out.push(`<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">${body}</table>`)
        break
      }
      case 'image':
        out.push(`<p><img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt)}" style="max-width:100%" /></p>`)
        break
      case 'divider':
        out.push('<hr />')
        break
      default:
        break
    }
  }
  return out.join('\n')
}

/** .docx 附件 → HTML（mammoth；失败抛错由调用方降级为打印兜底） */
export async function docxUrlToHtml(url: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`无法读取附件（HTTP ${resp.status}）`)
  const res = await mammoth.convertToHtml({ arrayBuffer: await resp.arrayBuffer() })
  return sanitize(res.value || '<p>（文档内容为空）</p>')
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
  })
}

function escapeHtml(s: string): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}
