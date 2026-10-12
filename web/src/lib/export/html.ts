// 文档正文 → 可打印/可位图化的 HTML（PDF 导出与打印兜底的共同输入）。
//
// markdown：typo-md-editor 的 `toHtml` 渲染管线（remark→rehype→highlight→KaTeX 预渲染），
//   与阅读页 MarkdownView 完全一致（同一份 bundle / 同一份导出工具），排版与代码高亮、数学公式
//   与 mermaid 图形都保持一致；mermaid 走全站统一运行时渲染 `<svg>` 后保真清洗。
// 其余类型：按 Blocks 生成一份朴素 HTML（够打印、够分页即可）。
// docx 附件：用 mammoth 把 .docx 转成 HTML（阅读页已有同样的能力）。

import mammoth from 'mammoth'
import DOMPurify from 'dompurify'
import { sanitizePreservingMermaid } from '../mermaidRender'
import { renderFlowchart } from '../flowchart'
import { toHtml } from '../../vendor/typo-md-editor/typo-md-editor.js'
import 'katex/dist/katex.min.css'
import { contentToBlocks, plainOf, type Block } from './blocks'
import type { DocType } from '../../types'

/** 离屏渲染区宽度（px）：约等于 A4 可打印宽度，与 pdf.ts 的 RENDER_WIDTH 对齐 */
const OFFSCREEN_WIDTH = 794

/** 渲染 mermaid 围栏代码块（全站统一 mermaid 运行时，securityLevel:'strict'）。 */
async function renderMermaidBlocks(root: HTMLElement): Promise<void> {
  const codes = Array.from(root.querySelectorAll<HTMLElement>('pre > code.language-mermaid'))
  for (const code of codes) {
    const src = (code.textContent ?? '').trim()
    const pre = code.parentElement as HTMLElement | null
    if (!pre || !src) continue
    const res = await renderFlowchart(src)
    if (res.svg) {
      const wrap = document.createElement('div')
      wrap.className = 'hk-mermaid'
      wrap.innerHTML = res.svg
      pre.replaceWith(wrap)
    } else if (res.error) {
      pre.setAttribute('data-mermaid-error', res.error)
    }
  }
}

/**
 * markdown → HTML（含真实 mermaid 图形），与阅读页 MarkdownView 同源。
 *
 * 返回 `<div class="vditor-reset hk-md-body">…</div>` 形式：外层 `.hk-md-body` 是
 * markdown-body.css 的挂载点 —— 阅读态由 reader.css 在其上叠加增强排版，导出/打印时宿主不在
 * `.doc-content` 内、reader.css 不命中，此时 markdown-body.css 即唯一排版来源，保证保真。
 */
async function markdownToHtml(markdown: string): Promise<string> {
  const wrapper = document.createElement('div')
  wrapper.className = 'vditor-reset hk-md-body'
  try {
    // 1) markdown → 自包含 HTML 文档（含 KaTeX 预渲染、代码高亮）
    let body = ''
    try {
      const full = await toHtml(markdown || '', 'Document')
      const doc = new DOMParser().parseFromString(full, 'text/html')
      body = doc.body ? doc.body.innerHTML : markdown || ''
    } catch {
      body = `<pre>${(markdown || '').replace(/</g, '&lt;')}</pre>`
    }

    // 2) 注入容器（离屏但仍在文档内，保证 mermaid 等依赖布局的渲染能正确执行）
    wrapper.style.position = 'fixed'
    wrapper.style.left = '-10000px'
    wrapper.style.top = '0'
    wrapper.style.width = `${OFFSCREEN_WIDTH}px`
    wrapper.style.background = '#ffffff'
    wrapper.innerHTML = body
    document.body.appendChild(wrapper)

    // 3) XSS 兜底：摘出 mermaid 节点 → 其余 DOMPurify → 放回
    sanitizePreservingMermaid(wrapper)
    // 4) mermaid 渲染（统一运行时，securityLevel:'strict'）
    await renderMermaidBlocks(wrapper)

    return wrapper.outerHTML
  } finally {
    // 清理离屏容器与副作用，避免残留 DOM
    wrapper.remove()
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
