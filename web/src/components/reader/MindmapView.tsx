import { useEffect, useRef } from 'react'
import { message } from 'antd'
import MindMap from 'simple-mind-map'
import { parseMindmapJSON } from '../../lib/mindmap'

interface Props {
  content: string
}

/** 思维导图只读渲染（simple-mind-map readonly，禁止编辑/拖拽，初始 fit 视图） */
export default function MindmapView({ content }: Props) {
  const elRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = elRef.current
    if (!host) return

    const { data, reset } = parseMindmapJSON(content)
    if (reset) message.warning('内容格式异常，已按默认思维导图展示')

    const mm = new MindMap({
      el: host,
      data: data.root,
      readonly: true,
      layout: data.layout || 'logicalStructure',
      initRootNodePosition: ['center', 'center'],
    })
    // 只读也还原持久化的主题配置（#31）：保持与编辑态一致的视觉样式。
    // 必须用 setThemeConfig（setTheme 仅接受已注册主题名，传入对象不会生效）。
    if (data.theme && typeof data.theme === 'object') {
      try {
        mm.setThemeConfig(data.theme as never)
      } catch {
        /* 主题格式异常时忽略，按默认渲染 */
      }
    }
    const onRenderEnd = () => mm.view.fit()
    mm.on('node_tree_render_end', onRenderEnd)

    return () => {
      mm.off('node_tree_render_end', onRenderEnd)
      try {
        mm.destroy()
      } catch {
        /* 忽略重复销毁 */
      }
    }
  }, [content])

  return <div ref={elRef} style={{ width: '100%', height: 560 }} />
}
