// 文档正文 → 可打印/可位图化的 HTML（PDF 导出与打印兜底的共同输入）。
//
// markdown：复用 Vditor 的 md2html（与阅读页同一渲染内核，排版一致，含代码高亮与数学公式）；
// 其余类型：按 Blocks 生成一份朴素 HTML（够打印、够分页即可）。
// docx 附件：用 mammoth 把 .docx 转成 HTML（阅读页已有同样的能力）。

import Vditor from 'vditor'
import mammoth from 'mammoth'
import DOMPurify from 'dompurify'
import { contentToBlocks, plainOf, type Block } from './blocks'
import type { DocType } from '../../types'

/** Vditor 渲染选项：与阅读页保持一致（自托管资源，避免外网 CDN） */
const VDITOR_OPTS = {
  cdn: '/vditor',
  mode: 'light' as const,
  hljs: { style: 'github', lineNumber: false },
  math: { engine: 'KaTeX' as const },
}

/** 任意文档类型 → HTML */
export async function contentToHtml(docType: DocType, content: string, title: string): Promise<string> {
  const head = `<h1>${escapeHtml(title)}</h1>`
  if (docType === 'markdown') {
    let body = ''
    try {
      body = await Vditor.md2html(content ?? '', VDITOR_OPTS)
    } catch {
      // 渲染器异常时退化为 blocks → HTML，保证还有东西可导出
      body = blocksToHtml(contentToBlocks(docType, content))
    }
    return sanitize(head + body)
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
