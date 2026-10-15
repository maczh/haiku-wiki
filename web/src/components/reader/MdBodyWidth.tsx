import type { CSSProperties, ReactNode } from 'react'
import MdWidthResizer from './MdWidthResizer'
import { useMdWidth } from '../../lib/mdWidth'

// Markdown 文档「正文显示区」宽度外壳：默认占窗体/父容器宽度的 80%，可拖拽右缘手柄调整，
// 双击恢复 80%。编辑/阅读/分享/H5 四态共用同一份 localStorage 偏好，一处调整、处处同步。
//
// 单独抽出本组件是为了让四种模式在「模式层」统一包一层，而不是把宽度逻辑塞进 MarkdownView
// （MarkdownView 还被点评区、版本预览、流程图等场景复用，那些场景不应出现文档宽度的拖拽手柄）。

interface Props {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export default function MdBodyWidth({ children, className, style }: Props) {
  const { width, setWidth } = useMdWidth()
  return (
    <MdWidthResizer width={width} onWidth={setWidth} className={className} style={style}>
      {children}
    </MdWidthResizer>
  )
}
