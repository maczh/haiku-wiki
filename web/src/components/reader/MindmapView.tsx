import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { message } from 'antd'
import 'katex/dist/katex.min.css'
import { MindMap as MindMapCanvas, type MindMapApi } from '../mindmap-vite/src/components/MindMap'
import { parseMindmapJSON } from '../../lib/mindmap'
import { smmLayoutToStructure, smmNodeToMind, smmThemeToBase } from '../../lib/mindmap.smm'
import { useViewMode } from '../../h5/useViewMode'

interface Props {
  content: string
}

/** 缩放上下限（与 H5ZoomStage 保持一致的手感） */
const MIN_SCALE = 0.2
const MAX_SCALE = 6

/** 两指间距 */
function twoPointDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
}

/**
 * H5 原生无级缩放 + 单指全向平移（关键：不用 CSS transform 放大）。
 *
 * 为什么不能套 `H5ZoomStage`：那层是 `transform: scale()` 放大 —— 对位图/PDF 尚可，
 * 对矢量导图渲染器完全是浪费：放大后节点文字会被整层位图化拉伸，虚化严重。
 *
 * 这里直接驱动画布自己的 view scale / translate（等价于 simple-mind-map 时代的
 * `view.scale/x/y + view.transform()`），缩放后 SVG 按新比例重新布局绘制 ——
 * **放大到多少就是多少的真实矢量渲染，永远清晰**，且是无级的。
 *
 * 交互约定：单指始终接管画布平移（上下左右自由划屏，含 1:1 比例）；
 * 双指按下即接管缩放。导图容器自身铺满视口、无需页面纵向滚动，
 * 因此 touch-action 恒为 none，手势全部归本组件处理。
 */
function attachNativeZoom(
  api: { current: MindMapApi | null },
  host: HTMLElement,
  onScale: (s: number) => void,
  onMoved?: () => void
): () => void {
  let pinch: { dist: number; scale: number; tx: number; ty: number; nx: number; ny: number } | null = null
  let pan: { x: number; y: number } | null = null
  /** 取画布实例（未就绪时静默忽略手势） */
  const inst = (): MindMapApi | null => api.current

  /** 容器内的手指坐标（相对 host 左上角，与画布 transform 同一坐标系） */
  const local = (t: Touch) => {
    const r = host.getBoundingClientRect()
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  }
  /** 两指中心（host 内坐标） */
  const midLocal = (ts: TouchList) => {
    const a = local(ts[0])
    const b = local(ts[1])
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  const onStart = (e: TouchEvent) => {
    if (e.touches.length >= 2 && inst()) {
      e.preventDefault()
      const cur = inst()!.getScale()
      const m = midLocal(e.touches)
      // 锚点：手指中心当前对应的「内容坐标」，缩放前后都保持停在这只手指下面
      const t = inst()!.getView()
      pinch = {
        dist:
          twoPointDistance(e.touches[0].clientX, e.touches[0].clientY, e.touches[1].clientX, e.touches[1].clientY) || 1,
        scale: cur,
        tx: t.tx,
        ty: t.ty,
        nx: (m.x - t.tx) / cur,
        ny: (m.y - t.ty) / cur,
      }
      pan = null
      return
    }
    if (e.touches.length === 1 && inst()) {
      pan = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }

  const onMove = (e: TouchEvent) => {
    if (e.touches.length >= 2 && pinch && inst()) {
      e.preventDefault()
      const d = twoPointDistance(e.touches[0].clientX, e.touches[0].clientY, e.touches[1].clientX, e.touches[1].clientY)
      const m = midLocal(e.touches)
      let scale = pinch.scale * (d / pinch.dist)
      // 距离变化小于 10px 视为没动，避免手指微抖引起跳动
      if (Math.abs(d - pinch.dist) <= 10) scale = pinch.scale
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
      // 让锚点内容坐标在新缩放下沉到当前手指中心
      const a = inst()!
      a.setView({ scale, tx: m.x - pinch.nx * scale, ty: m.y - pinch.ny * scale })
      onScale(scale)
      return
    }
    if (e.touches.length === 1 && pan && inst()) {
      e.preventDefault()
      const dx = e.touches[0].clientX - pan.x
      const dy = e.touches[0].clientY - pan.y
      if (dx === 0 && dy === 0) return
      pan = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      const a = inst()!
      const t = a.getView()
      a.setView({ tx: t.tx + dx, ty: t.ty + dy })
      onMoved?.()
    }
  }

  const onEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) pinch = null
    if (e.touches.length === 0) {
      pan = null
      onScale(inst()?.getScale() ?? 1)
    } else if (e.touches.length === 1) {
      // 双指抬起一根：不接着平移，避免画面突然跳动
      pan = null
    }
  }

  host.addEventListener('touchstart', onStart, { passive: false })
  host.addEventListener('touchmove', onMove, { passive: false })
  host.addEventListener('touchend', onEnd, { passive: false })
  host.addEventListener('touchcancel', onEnd, { passive: false })
  return () => {
    host.removeEventListener('touchstart', onStart)
    host.removeEventListener('touchmove', onMove)
    host.removeEventListener('touchend', onEnd)
    host.removeEventListener('touchcancel', onEnd)
  }
}

/**
 * 思维导图只读渲染（mindmap-vite，禁止编辑/拖拽，初始 fit 视图）。
 *
 * 画布实例通过 `apiRef` 拿到命令式句柄：适应视图、重置视图、H5 手势缩放都走它，
 * 与编辑态共用同一套组件，仅 `editable={false}`。
 */
export default function MindmapView({ content }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const outerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<MindMapApi | null>(null)
  const { mode: viewMode } = useViewMode()
  const mobile = viewMode === 'h5'
  /** 当前缩放百分比（驱动「重置」按钮） */
  const [scale, setScale] = useState(1)
  /** 视角被平移过（H5 显示「重置」按钮用） */
  const [moved, setMoved] = useState(false)
  /** 桌面（阅读/分享）画布高度：自适应浏览器视口，而非固定值 */
  const [hostH, setHostH] = useState(560)

  const { tree, layout, theme, reset } = useMemo(() => {
    const parsed = parseMindmapJSON(content)
    return {
      tree: smmNodeToMind(parsed.data.root),
      layout: parsed.data.layout,
      theme: parsed.data.theme,
      reset: parsed.reset,
    }
  }, [content])

  useEffect(() => {
    if (reset) message.warning('内容格式异常，已按默认思维导图展示')
  }, [reset])

  // 桌面端：画布高度 = 视口高度 − 画布顶部到文档顶部的距离 − 底部留白。
  // 用「文档坐标」（rect.top + scrollY）计算，与当前滚动位置无关，滚动时高度稳定。
  useEffect(() => {
    if (mobile) return
    const calc = () => {
      const el = outerRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top + (window.scrollY || 0)
      const h = Math.round(window.innerHeight - top - 28)
      // 下限 320：极矮视口（弹窗预览等）时不至于把画布压没
      setHostH(Math.max(320, Math.min(h, window.innerHeight)))
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [mobile])

  useEffect(() => {
    const host = elRef.current
    if (!host) return

    // 自适应缩放：挂载后组件自带 fitOnMount，这里再补两刀延时 fit ——
    // 模板预览弹窗有入场动画，首帧拿到的容器宽度偏小，只 fit 一次会让导图右侧被裁掉
    //（弹窗稳定后不会再有渲染事件，必须补这一刀）。
    const timers = [setTimeout(() => apiRef.current?.fitView(), 320), setTimeout(() => apiRef.current?.fitView(), 760)]
    let raf = 0
    let lastW = host.clientWidth
    let lastH = host.clientHeight
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return
      lastW = w
      lastH = h
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => apiRef.current?.fitView())
    })
    ro.observe(host)

    // H5：原生无级缩放 + 单指全向平移（见 attachNativeZoom 注释）。桌面端不需要（有滚轮 + 拖拽画布）。
    const detach = mobile ? attachNativeZoom(apiRef, host, setScale, () => setMoved(true)) : null

    return () => {
      detach?.()
      ro.disconnect()
      timers.forEach(clearTimeout)
      if (raf) cancelAnimationFrame(raf)
      apiRef.current = null
    }
  }, [mobile, tree])

  /** 回到自适应视图（缩放/平移后可用）：先复位 1:1，再按当前容器 fit */
  const resetView = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    api.resetView()
    api.fitView()
    setScale(api.getScale())
    setMoved(false)
  }, [])

  const zoomed = scale > 1.001

  return (
    <div ref={outerRef} style={{ position: 'relative', width: '100%', height: mobile ? '100%' : hostH }}>
      <div
        ref={elRef}
        data-h5-native-zoom={mobile ? '1' : '0'}
        data-h5-zoom-scale={Math.round(scale * 100)}
        style={{
          width: '100%',
          height: '100%',
          // H5：手势全部由本组件接管（单指平移画布 / 双指缩放），容器自身铺满视口无需页面滚动
          touchAction: mobile ? 'none' : undefined,
        }}
      >
        <MindMapCanvas
          key={content}
          ref={apiRef}
          data={tree}
          editable={false}
          showToolbar={false}
          fitOnMount
          width="100%"
          height="100%"
          defaultConfig={{
            structure: smmLayoutToStructure(layout),
            base: smmThemeToBase(theme),
          }}
          onScaleChange={setScale}
        />
      </div>
      {mobile && (zoomed || moved) && (
        <button
          type="button"
          onClick={resetView}
          style={{
            position: 'absolute',
            right: 12,
            bottom: 12,
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
