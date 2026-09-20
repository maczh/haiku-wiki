import { useEffect, useRef } from 'react'
import Vditor from 'vditor'
import DOMPurify from 'dompurify'
import { sanitizePreservingMermaid, waitForMermaidBlocks } from '../../lib/mermaidRender'

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
        // 第一段：先洗 Vditor 的原始产物（XSS 兜底：默认移除 script/事件属性）。
        const clean = DOMPurify.sanitize(el.innerHTML, {
          USE_PROFILES: { html: true, svg: true, svgFilters: true },
          FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
          FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
        })
        el.innerHTML = clean
        cbRef.current?.(el)

        // 第二段：mermaid 渲染是 fire-and-forget —— Vditor 在 after 之后才异步加载脚本并
        // 把 <svg> 注入 .language-mermaid 容器（见 lib/mermaidRender.ts 文件头）。因此：
        //   1) 先等 SVG 真正注入（否则此时 DOM 里根本没有图形可处理）；
        //   2) 再做「摘出 mermaid 节点 → 清洗其余 → 原位放回」——
        //      直接整体 DOMPurify 会连内容删掉 <foreignObject>（图变空框且无报错）；
        //      而完全不处理又会让 securityLevel:'loose' 下注入的 SVG 完全未经清洗。
        void (async () => {
          await waitForMermaidBlocks(el)
          if (cancelled || !el.isConnected) return
          sanitizePreservingMermaid(el)
        })().catch(() => undefined)
      },
    })
    return () => {
      cancelled = true
      el.innerHTML = ''
    }
  }, [content])

  return <div className="doc-content" ref={ref} />
}
