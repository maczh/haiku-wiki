import { useRef, type CSSProperties, type ReactNode } from 'react'

// Markdown 文档「编辑区 / 显示区」宽度调节器（百分比，相对父容器宽度）。
//
// 用法：把编辑器或阅读正文包进 <MdWidthResizer width onWidth>，组件会
//   · 以 maxWidth: width% + 水平居中呈现内容；
//   · 在右缘渲染一条可拖拽的竖向手柄，拖动即改 width（沿父容器宽度换算成百分比）；
//   · 双击手柄恢复默认 80%。
//
// 四态（编辑 / 阅读 / 分享 / H5）共用 useMdWidth，因此一处调整、处处同步。

interface Props {
  width: number
  onWidth: (w: number) => void
  children: ReactNode
  /** 编辑态需要撑满可用纵向高度（高度链：父 flex:1 → 本层 100% → .md-editor 100%） */
  fill?: boolean
  className?: string
  style?: CSSProperties
}

const MIN = 40
const MAX = 100

export default function MdWidthResizer({ width, onWidth, children, fill, className, style }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; startW: number; parentW: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el || !el.parentElement) return
    e.preventDefault()
    drag.current = { startX: e.clientX, startW: width, parentW: el.parentElement.clientWidth }
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 某些环境不支持指针捕获，忽略 */
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const { startX, startW, parentW } = drag.current
    if (!parentW) return
    const dx = e.clientX - startX
    const next = startW + (dx / parentW) * 100
    onWidth(Math.min(MAX, Math.max(MIN, Math.round(next))))
  }

  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      ref={ref}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: `${width}%`,
        margin: '0 auto',
        ...(fill ? { height: '100%' } : null),
        ...style,
      }}
    >
      {children}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => onWidth(80)}
        title="拖动调整宽度（双击恢复 80%）"
        style={{
          position: 'absolute',
          top: 0,
          right: -7,
          width: 14,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 5,
          touchAction: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '50%',
            right: 4,
            transform: 'translateY(-50%)',
            width: 4,
            height: 36,
            borderRadius: 4,
            background: 'rgba(0,0,0,0.18)',
          }}
        />
      </div>
    </div>
  )
}
