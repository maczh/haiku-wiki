import { useEffect, useRef } from 'react'
import { sanitizePreservingMermaid } from '../../lib/mermaidRender'
import { loadFoldState, toggleFoldState } from '../../lib/headingFold'
import { jsonFoldFromText } from '../../lib/jsonFold'
import { injectCodeCopyButtons } from '../../lib/codeCopy'
import { renderFlowchart } from '../../lib/flowchart'
import { toHtml } from '../../vendor/typo-md-editor/typo-md-editor.js'
import 'katex/dist/katex.min.css'
import '../../lib/codeCopy.css'

// 阅读态 CSS 基底（原 Vditor 自带 .vditor-reset 随 vditor 依赖移除，这里补回留白与清单样式）
import './markdown-body.css'

interface Props {
  content: string
  /** 渲染完成回调（用于提取标题生成大纲） */
  onRendered?: (container: HTMLElement) => void
  /**
   * 文档 id：用于按文档隔离「标题折叠」状态（localStorage）。
   * 不传（分享页 / 点评 / 历史版本预览）时仍注入折叠箭头，但不做持久化。
   */
  docId?: number
}

/** 把标题文本转成稳定的 id 片段（去非词符，保留中文） */
function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^\w一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'h'
}

/**
 * 折叠区间：从 heading 开始，向后隐藏其后的兄弟节点，
 * 直到遇到「同级或更高级」的标题（level <= 当前 level）为止。
 */
function hideRange(h: HTMLElement, hide: boolean): void {
  const level = Number(h.tagName.slice(1)) // 1..6
  let el: HTMLElement | null = h.nextElementSibling as HTMLElement | null
  while (el) {
    if (/^H[1-6]$/i.test(el.tagName)) {
      const lv = Number(el.tagName.slice(1))
      if (lv <= level) break
    }
    // 仅在我们自己标记的区间上改 display；mermaid 等节点一并隐藏/恢复（不重渲染）
    el.style.display = hide ? 'none' : ''
    el = el.nextElementSibling as HTMLElement | null
  }
}

/**
 * 阅读视图 JSON 代码块对象折叠：把 `language-json` 代码块换成可折叠的 JSON 树。
 */
function injectJsonFold(container: HTMLElement): void {
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>('pre > code.language-json, pre > code.language-jsonc'),
  )
  if (blocks.length === 0) return
  blocks.forEach((code) => {
    const pre = code.parentElement as HTMLElement | null
    if (!pre) return
    const node = jsonFoldFromText(code.textContent ?? '')
    if (!node) return
    const wrap = document.createElement('div')
    wrap.className = 'hk-jsonfold-scroll'
    wrap.appendChild(node)
    wrap.setAttribute('data-hk-code-text', code.textContent ?? '')
    pre.replaceWith(wrap)
  })
}

/**
 * 阅读视图标题折叠：给每个 h1-h6 注入一枚 hover 折叠箭头，
 * 点击折叠/展开该标题到下一个同级或更高级标题之间的 DOM 区间。
 * 折叠状态按 docId 读 localStorage 恢复（docId 缺省时不持久化）。
 */
function injectHeadingFold(container: HTMLElement, docId?: number): void {
  const heads = Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
  if (heads.length === 0) return
  const folded = docId && docId > 0 ? loadFoldState(docId) : null
  heads.forEach((h, i) => {
    const id = `${slug((h.textContent ?? '').trim())}-${i}`
    h.setAttribute('data-heading-id', id)
    h.classList.add('hk-heading')
    if (folded && folded.has(id)) {
      h.classList.add('hk-fold-collapsed')
      hideRange(h, true)
    }
    const arrow = document.createElement('span')
    arrow.className = 'hk-fold-arrow'
    arrow.setAttribute('data-heading-id', id)
    arrow.setAttribute('role', 'button')
    arrow.setAttribute('aria-label', '折叠/展开章节')
    arrow.textContent = '▾'
    arrow.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      const collapsed = h.classList.toggle('hk-fold-collapsed')
      hideRange(h, collapsed)
      if (docId && docId > 0) toggleFoldState(docId, id)
    })
    h.insertBefore(arrow, h.firstChild)
  })
}

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
 * Markdown 阅读渲染：typo-md-editor 渲染管线（remark→rehype→highlight→KaTeX）
 * 产出自包含 HTML，再套用全站统一的后处理：
 *   - XSS 兜底（sanitizePreservingMermaid：摘出 mermaid 节点 → DOMPurify → 放回，保留 foreignObject）
 *   - mermaid 渲染（全站统一运行时）
 *   - 标题折叠 / JSON 折叠 / 代码块复制按钮
 * 后端只存 Markdown 原文，所有渲染路径统一走这里。
 */
export default function MarkdownView({ content, onRendered, docId }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const cbRef = useRef(onRendered)
  cbRef.current = onRendered

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 组件卸载 / content 变化后，异步后处理不应再写回已作废的容器
    let cancelled = false
    el.innerHTML = ''

    ;(async () => {
      // 1) markdown → 自包含 HTML 文档
      let body = ''
      try {
        const full = await toHtml(content || '', 'Document')
        const doc = new DOMParser().parseFromString(full, 'text/html')
        body = doc.body ? doc.body.innerHTML : content || ''
      } catch {
        body = `<pre>${(content || '').replace(/</g, '&lt;')}</pre>`
      }
      if (cancelled || !el.isConnected) return

      // 2) 包进 .vditor-reset（复用阅读排版主题），注入容器
      el.innerHTML = `<div class="vditor-reset hk-md-body">${body}</div>`
      const root = el.firstElementChild as HTMLElement | null
      if (!root) return

      // 3) XSS 兜底：摘出 mermaid 节点 → 其余 DOMPurify → 放回
      sanitizePreservingMermaid(root)

      // 4) mermaid 渲染（统一运行时，securityLevel:'strict'）
      await renderMermaidBlocks(root)
      if (cancelled || !el.isConnected) return

      // 5) 阅读增强：标题折叠 / JSON 折叠 / 代码块复制
      injectHeadingFold(root, docId)
      injectJsonFold(root)
      injectCodeCopyButtons(root)

      cbRef.current?.(root)
    })().catch(() => undefined)

    return () => {
      cancelled = true
      el.innerHTML = ''
    }
  }, [content, docId])

  return <div className="doc-content" ref={ref} />
}
