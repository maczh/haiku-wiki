import { useEffect, useRef } from 'react'
import Vditor from 'vditor'
import { sanitizePreservingMermaid, waitForMermaidBlocks } from '../../lib/mermaidRender'
import { loadFoldState, toggleFoldState } from '../../lib/headingFold'

// Vditor 样式随本组件一起按需加载：只有渲染 Markdown 才需要，
// 放在 main.tsx 会让 ~40KB CSS 阻塞首屏（本文件已是 React.lazy 组件）。
import 'vditor/dist/index.css'

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
 * 阅读视图标题折叠：在 Vditor.preview 渲染完成后，给每个 h1-h6 注入一枚 hover 折叠箭头，
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

/**
 * Markdown 阅读渲染：Vditor preview + DOMPurify 二次过滤（防 XSS）。
 * 后端只存 Markdown 原文，所有渲染路径统一走这里。
 */
export default function MarkdownView({ content, onRendered, docId }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const cbRef = useRef(onRendered)
  cbRef.current = onRendered

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 组件卸载 / content 变化后，异步的 mermaid 后处理不应再写回已作废的容器
    let cancelled = false
    el.innerHTML = ''
    Vditor.preview(el, content || '', {
      // 自托管 Vditor 静态资源（见 web/scripts/copy-vditor-assets.mjs）：
      // 默认 cdn 指向 unpkg.com，离线/内网环境下 lute 解析器拉取失败会导致正文空白。
      cdn: '/vditor',
      mode: 'light',
      hljs: { style: 'github', lineNumber: false },
      math: { engine: 'KaTeX' },
      after: () => {
        // 清洗（XSS 兜底）必须走「摘出 mermaid 容器 → 清洗其余 → 原位放回」。
        //
        // 🔴 绝不能写成 `el.innerHTML = DOMPurify.sanitize(el.innerHTML)`：那会按序列化
        // 字符串**重建整棵 DOM**，而 Vditor 的 mermaid 渲染器在预览管线里一次性
        // `querySelectorAll('.language-mermaid')` 捕获容器元素，脚本异步加载完成后把
        // `<svg>` 写进**捕获的那个元素对象**——DOM 一旦被重建，这些引用就指向游离节点，
        // SVG 写进了不在文档里的节点，阅读态的图就永远出不来（编辑态正常正是因为它
        // 不走这条路径）。`sanitizePreservingMermaid` 用 `replaceChild` **移动**节点，
        // 节点身份保留，Vditor 闭包里的引用依然有效。
        sanitizePreservingMermaid(el)
        cbRef.current?.(el)

        // mermaid 渲染是 fire-and-forget：Vditor 在 after 之后才异步加载脚本并把
        // `<svg>` 注入容器（见 lib/mermaidRender.ts 文件头）。因此：
        //   1) 先等 SVG 真正注入（超时也放行，不阻塞）；
        //   2) 再做一次「摘出 → 定向清洗 mermaid 节点 → 清洗其余 → 原位放回」——
        //      直接整体 DOMPurify 会连内容删掉 `<foreignObject>`（图变空框且无报错）；
        //      而完全不处理又会让 securityLevel:'loose' 下注入的 SVG 完全未经清洗。
        //   首次加载 mermaid.min.js 约 3.5MB，超时放宽到 10s；命中即返回，不影响正常速度。
        //   第二步清洗会重建非 mermaid 的 DOM（含标题），故标题折叠注入必须放在其后，
        //   否则注入的箭头按钮会被 second-sanitize 一并销毁。
        void (async () => {
          await waitForMermaidBlocks(el, 10000)
          if (cancelled || !el.isConnected) return
          sanitizePreservingMermaid(el)
          injectHeadingFold(el, docId)
        })().catch(() => undefined)
      },
    })
    return () => {
      cancelled = true
      el.innerHTML = ''
    }
  }, [content, docId])

  return <div className="doc-content" ref={ref} />
}
