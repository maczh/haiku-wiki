import { useEffect, useRef } from 'react'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'

const transformer = new Transformer()

interface Props {
  /** mindmap 树序列化后的 Markdown（lib/mindmap.treeToMarkdown 产物） */
  markdown: string
}

/** markmap 只读渲染（阅读页与编辑器预览共用） */
export default function MarkmapPreview({ markdown }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const mmRef = useRef<Markmap | null>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    try {
      const { root } = transformer.transform(markdown || '')
      if (mmRef.current) {
        mmRef.current.setData(root)
        mmRef.current.fit()
      } else {
        mmRef.current = Markmap.create(svg, {
          spacingVertical: 10,
          paddingX: 16,
          autoFit: true,
          initialExpandLevel: -1,
        }, root)
      }
    } catch {
      // markmap 解析失败：留空渲染区（markdown 生成器可控，正常不会走到）
    }
  }, [markdown])

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 360, padding: 12 }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
