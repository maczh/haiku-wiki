import { useEffect, useRef } from 'react'
import Vditor from 'vditor'
import DOMPurify from 'dompurify'

// Vditor 样式随本组件一起按需加载：只有渲染 Markdown 才需要，
// 放在 main.tsx 会让 ~40KB CSS 阻塞首屏（本文件已是 React.lazy 组件）。
import 'vditor/dist/index.css'

interface Props {
  content: string
  /** 渲染完成回调（用于提取标题生成大纲） */
  onRendered?: (container: HTMLElement) => void
}

/**
 * Markdown 阅读渲染：Vditor preview + DOMPurify 二次过滤（防 XSS）。
 * 后端只存 Markdown 原文，所有渲染路径统一走这里。
 */
export default function MarkdownView({ content, onRendered }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const cbRef = useRef(onRendered)
  cbRef.current = onRendered

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    Vditor.preview(el, content || '', {
      // 自托管 Vditor 静态资源（见 web/scripts/copy-vditor-assets.mjs）：
      // 默认 cdn 指向 unpkg.com，离线/内网环境下 lute 解析器拉取失败会导致正文空白。
      cdn: '/vditor',
      mode: 'light',
      hljs: { style: 'github', lineNumber: false },
      math: { engine: 'KaTeX' },
      after: () => {
        // XSS 兜底：对渲染产物做 DOMPurify 清洗（默认移除 script/事件属性）
        const clean = DOMPurify.sanitize(el.innerHTML, {
          USE_PROFILES: { html: true, svg: true, svgFilters: true },
          FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
          FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
        })
        el.innerHTML = clean
        cbRef.current?.(el)
      },
    })
    return () => {
      el.innerHTML = ''
    }
  }, [content])

  return <div className="doc-content" ref={ref} />
}
