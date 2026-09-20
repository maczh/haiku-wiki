import { useEffect, useRef } from 'react'
import Vditor from 'vditor'
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
        void (async () => {
          await waitForMermaidBlocks(el, 10000)
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
