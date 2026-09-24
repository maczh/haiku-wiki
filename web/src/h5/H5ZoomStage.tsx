import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

/**
 * H5 画布型预览的「双指缩放 + 单指拖动」手势层。
 *
 * 适用范围：思维导图 / PDF / DOCX（以及其它以「画布 / 长文档」形式渲染的阅读态）。
 *
 * 设计要点（也是修 bug 的关键）：
 *   1. **默认零侵入**：scale=1 时内容保持正常文档流，页面纵向划屏完全交给浏览器原生滚动
 *      （容器 touch-action=pan-y），不拦截任何单指事件 —— 不会出现「预览区吞掉划屏」。
 *   2. **双指缩放**：仅在 2 指按下时接管（touchstart 即 preventDefault，避免浏览器把
 *      双指手势当成滚动而中途 touchcancel 掉我们的事件），以双指中点为锚点缩放。
 *   3. **单指拖动**：仅当 scale>1 时接管（此时容器 touch-action 切到 none），用于平移
 *      放大后的画布。
 *   4. **缩放结束后不粘手势**：touchend/cancel 只要落到 ≤1 指就清空手势状态，
 *      并在 scale 回落到 1 时把 touch-action 复位为 pan-y —— 这就是「双指缩放后
 *      划屏滚动失效」的修法（旧实现残留了手势状态 / 覆盖住的 touch-action）。
 *
 * 用原生 addEventListener({passive:false}) 绑定而不是 React onTouchXxx：
 * React 在根容器上以 passive 方式注册 touch 事件，其中 preventDefault() 无效。
 */

const MIN_SCALE = 1
const MAX_SCALE = 6

/** 双指起始状态 */
interface PinchState {
  dist: number
  cx: number
  cy: number
  scale: number
  tx: number
  ty: number
}
/** 单指平移起始状态 */
interface PanState {
  x: number
  y: number
  tx: number
  ty: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 两指间距与中点（相对视口） */
function pinchMetrics(touches: TouchList): { dist: number; cx: number; cy: number } {
  const a = touches[0]
  const b = touches[1]
  const dx = b.clientX - a.clientX
  const dy = b.clientY - a.clientY
  return {
    dist: Math.hypot(dx, dy),
    cx: (a.clientX + b.clientX) / 2,
    cy: (a.clientY + b.clientY) / 2,
  }
}

interface Props {
  children: ReactNode
  /** 额外样式（通常交给外层控制高度 / 边框） */
  style?: CSSProperties
  /** 是否显示悬浮「重置」按钮（默认显示） */
  showReset?: boolean
}

export default function H5ZoomStage({ children, style, showReset = true }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  // 手势状态放 ref：原生监听器只需绑定一次，避免频繁解绑/重绑丢失事件
  const scaleRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const pinchRef = useRef<PinchState | null>(null)
  const panRef = useRef<PanState | null>(null)

  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  /** 把 ref 里的实时视图状态同步到 React（驱动 transform 与 touch-action） */
  const commit = useCallback(() => {
    setScale(scaleRef.current)
    setOffset({ x: offsetRef.current.x, y: offsetRef.current.y })
  }, [])

  /** 复位到 1:1（清空缩放与平移，touch-action 也随之回到 pan-y） */
  const reset = useCallback(() => {
    scaleRef.current = 1
    offsetRef.current = { x: 0, y: 0 }
    pinchRef.current = null
    panRef.current = null
    commit()
  }, [commit])

  /** 清空一切进行中的手势（不动缩放结果） */
  const clearGestures = useCallback(() => {
    pinchRef.current = null
    panRef.current = null
  }, [])

  useEffect(() => {
    const host = hostRef.current
    const inner = innerRef.current
    if (!host || !inner) return

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        // 双指：立刻接管，阻止浏览器把该手势当滚动/页面缩放
        e.preventDefault()
        const { dist, cx, cy } = pinchMetrics(e.touches)
        pinchRef.current = {
          dist: dist || 1,
          cx,
          cy,
          scale: scaleRef.current,
          tx: offsetRef.current.x,
          ty: offsetRef.current.y,
        }
        panRef.current = null
        return
      }
      if (e.touches.length === 1 && scaleRef.current > 1) {
        // 已放大：单指拖动平移画布
        e.preventDefault()
        panRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          tx: offsetRef.current.x,
          ty: offsetRef.current.y,
        }
      }
      // scale === 1：单指不拦截 → 浏览器原生划屏滚动
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 && pinchRef.current) {
        e.preventDefault()
        const start = pinchRef.current
        const { dist, cx, cy } = pinchMetrics(e.touches)
        const next = clamp(start.scale * (dist / start.dist), MIN_SCALE, MAX_SCALE)
        // 以双指中点为锚：中点在内容坐标系中的位置保持不变
        const rect = host.getBoundingClientRect()
        const px = (start.cx - rect.left - start.tx) / start.scale
        const py = (start.cy - rect.top - start.ty) / start.scale
        scaleRef.current = next
        offsetRef.current = {
          x: cx - rect.left - px * next,
          y: cy - rect.top - py * next,
        }
        commit()
        return
      }
      if (e.touches.length === 1 && panRef.current && scaleRef.current > 1) {
        e.preventDefault()
        const p = panRef.current
        offsetRef.current = {
          x: p.tx + (e.touches[0].clientX - p.x),
          y: p.ty + (e.touches[0].clientY - p.y),
        }
        commit()
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      // 关键：手指落到 ≤1 根就清空手势状态，绝不留残余 ——
      // 否则后续单指划屏会被当成「继续缩放/平移」而失效。
      if (e.touches.length < 2) pinchRef.current = null
      if (e.touches.length === 0) {
        panRef.current = null
        // 缩回 1 或更小时顺带把平移归零，避免内容停在画面外
        if (scaleRef.current <= MIN_SCALE + 1e-3) {
          scaleRef.current = MIN_SCALE
          offsetRef.current = { x: 0, y: 0 }
        }
        commit()
      } else if (e.touches.length === 1) {
        // 双指抬起一根：不接着平移（避免画面突然跳动），等用户重新落指
        panRef.current = null
      }
    }

    host.addEventListener('touchstart', onTouchStart, { passive: false })
    host.addEventListener('touchmove', onTouchMove, { passive: false })
    host.addEventListener('touchend', onTouchEnd, { passive: false })
    host.addEventListener('touchcancel', onTouchEnd, { passive: false })
    return () => {
      host.removeEventListener('touchstart', onTouchStart)
      host.removeEventListener('touchmove', onTouchMove)
      host.removeEventListener('touchend', onTouchEnd)
      host.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [commit])

  const zoomed = scale > 1 + 1e-3

  return (
    <div
      ref={hostRef}
      data-h5-zoom={zoomed ? 'zoomed' : '1'}
      data-h5-zoom-scale={Math.round(scale * 100)}
      style={{
        position: 'relative',
        // ⚠️ 本层自己就是滚动视口（不能只给 minHeight 让外层滚）：
        // PDF / DOCX 这类长文档若靠祖先容器滚动，个别移动内核（尤其 iOS Safari 的
        // 嵌套 -webkit-overflow-scrolling 容器）会出现「默认大小下划不动、双指放大后反而能拖」——
        // 因为祖先既滚动又带 touch-action 限制。把滚动下沉到手势层自身后，
        // 手势归属唯一，纵向划屏在 1:1 时就由浏览器原生接管。
        height: '100%',
        overflow: zoomed ? 'hidden' : 'auto',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
        // 未放大：允许原生滚动（不吞划屏），但禁掉浏览器自身的双指页面缩放（由本组件接管）；
        // 已放大：完全交给本组件的单指拖动
        touchAction: zoomed ? 'none' : 'pan-x pan-y',
        ...style,
      }}
    >
      <div
        ref={innerRef}
        style={{
          transformOrigin: '0 0',
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          // ⚠️ 不能用 will-change: transform：它会把这一层提升为合成层并**按 1:1 位图栅格化**，
          // 之后 CSS scale 只是把这张位图放大 —— 文字/矢量边缘直接糊掉。去掉后浏览器会在
          // 每次缩放结束时按新比例重新栅格化，放大依然清晰（配合下面「不放大时不挂 transform」）。
        }}
      >
        {children}
      </div>

      {showReset && zoomed && (
        <button
          type="button"
          onClick={reset}
          style={{
            position: 'fixed',
            right: 16,
            bottom: 76,
            zIndex: 30,
            height: 34,
            padding: '0 14px',
            borderRadius: 17,
            border: '1px solid #d9d9d9',
            background: 'rgba(255,255,255,.96)',
            boxShadow: '0 2px 10px rgba(0,0,0,.14)',
            fontSize: 13,
            color: '#1f2329',
          }}
        >
          {Math.round(scale * 100)}% · 重置
        </button>
      )}
    </div>
  )
}
