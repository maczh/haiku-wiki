import { useEffect, useRef, useState } from 'react'
import { message } from 'antd'
import MindMap from 'simple-mind-map'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Export from 'simple-mind-map/src/plugins/Export.js'
import Painter from 'simple-mind-map/src/plugins/Painter.js'
import AssociativeLine from 'simple-mind-map/src/plugins/AssociativeLine.js'
import OuterFrame from 'simple-mind-map/src/plugins/OuterFrame.js'
import Formula from 'simple-mind-map/src/plugins/Formula.js'
import 'katex/dist/katex.min.css'
import { parseMindmapJSON } from '../../lib/mindmap'
import { useViewMode } from '../../h5/useViewMode'

interface Props {
  content: string
}

// 插件静态注册（与 MindmapEditor 保持一致）：用户真实导图常带节点图片 / 关联线 / 公式 / 备注，
// 只读预览若不注册这些插件，simple-mind-map 解析带对应特性的数据时会抛错（#模板预览报错）。
MindMap.usePlugin(Drag)
MindMap.usePlugin(Export)
MindMap.usePlugin(Painter)
MindMap.usePlugin(AssociativeLine)
MindMap.usePlugin(OuterFrame)
MindMap.usePlugin(Formula)

/** 缩放上下限（与 H5ZoomStage 保持一致的手感） */
const MIN_SCALE = 0.2
const MAX_SCALE = 6

/** 两指间距 */
function twoPointDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
}

/**
 * H5 原生无级缩放（关键：不用 CSS transform 放大）。
 *
 * 为什么不能套 `H5ZoomStage`：那层是 `transform: scale()` 放大 —— 对位图/PDF 尚可，
 * 对 simple-mind-map 这种「按当前 scale 重新排布矢量 SVG」的渲染器完全是浪费：
 * 放大后节点文字会被整层位图化拉伸，虚化严重。
 *
 * 这里直接驱动 `mm.view.scale`（simple-mind-map 自己的缩放），缩放后 SVG 按新比例
 * 重新布局绘制 —— **放大到多少就是多少的真实矢量渲染，永远清晰**，且是无级的。
 * 平移同理走 `view.x / view.y`，放大后单指可拖动查看。
 *
 * 交互约定：1:1（未放大）时单指不拦截，纵向划屏仍归浏览器原生滚动；
 * 双指按下即接管缩放；已放大时单指接管平移。
 */
function attachNativeZoom(mm: MindMap, host: HTMLElement, onScale: (s: number) => void): () => void {
  const view = mm.view
  let pinch: { dist: number; scale: number; x: number; y: number; cx: number; cy: number } | null = null
  let pan: { x: number; y: number } | null = null

  // 与 simple-mind-map 自带 TouchEvent 插件同一套算法（以两指中心为锚、按初始距离线性缩放）
  const mid = (t: TouchList) => {
    const a = mm.toPos(t[0].clientX, t[0].clientY) as { x: number; y: number }
    const b = mm.toPos(t[1].clientX, t[1].clientY) as { x: number; y: number }
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  const onStart = (e: TouchEvent) => {
    if (e.touches.length >= 2) {
      e.preventDefault()
      const m = mid(e.touches)
      pinch = {
        dist:
          twoPointDistance(e.touches[0].clientX, e.touches[0].clientY, e.touches[1].clientX, e.touches[1].clientY) || 1,
        scale: view.scale,
        x: view.x,
        y: view.y,
        cx: m.x,
        cy: m.y,
      }
      pan = null
      return
    }
    if (e.touches.length === 1 && view.scale > 1.001) {
      e.preventDefault()
      pan = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }

  const onMove = (e: TouchEvent) => {
    if (e.touches.length >= 2 && pinch) {
      e.preventDefault()
      const d = twoPointDistance(e.touches[0].clientX, e.touches[0].clientY, e.touches[1].clientX, e.touches[1].clientY)
      const m = mid(e.touches)
      let scale = pinch.scale * (d / pinch.dist)
      // 距离变化小于 10px 视为没动，避免手指微抖引起跳动
      if (Math.abs(d - pinch.dist) <= 10) scale = pinch.scale
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
      const ratio = 1 - scale / pinch.scale
      view.x = pinch.x + (m.x - pinch.x) * ratio + (m.x - pinch.cx) * scale
      view.y = pinch.y + (m.y - pinch.y) * ratio + (m.y - pinch.cy) * scale
      view.scale = scale
      view.transform()
      onScale(scale)
      return
    }
    if (e.touches.length === 1 && pan && view.scale > 1.001) {
      e.preventDefault()
      const dx = e.touches[0].clientX - pan.x
      const dy = e.touches[0].clientY - pan.y
      pan = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      view.x += dx
      view.y += dy
      view.transform()
    }
  }

  const onEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) pinch = null
    if (e.touches.length === 0) {
      pan = null
      onScale(view.scale)
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

/** 思维导图只读渲染（simple-mind-map readonly，禁止编辑/拖拽，初始 fit 视图） */
export default function MindmapView({ content }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  /** simple-mind-map 实例（「重置视图」按钮要用） */
  const mmRef = useRef<MindMap | null>(null)
  const { mode: viewMode } = useViewMode()
  const mobile = viewMode === 'h5'
  /** 当前缩放百分比（驱动 touch-action 与「重置」按钮） */
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const host = elRef.current
    if (!host) return

    const { data, reset } = parseMindmapJSON(content)
    if (reset) message.warning('内容格式异常，已按默认思维导图展示')

    const mm = new MindMap({
      el: host,
      data: data.root,
      readonly: true,
      layout: data.layout || 'mindMap',
      initRootNodePosition: ['center', 'center'],
    })
    mmRef.current = mm
    // 只读也还原持久化的主题配置（#31）：保持与编辑态一致的视觉样式。
    // 必须用 setThemeConfig（setTheme 仅接受已注册主题名，传入对象不会生效）。
    if (data.theme && typeof data.theme === 'object') {
      try {
        mm.setThemeConfig(data.theme as never)
      } catch {
        /* 主题格式异常时忽略，按默认渲染 */
      }
    }
    // 自适应缩放：
    //   1) 渲染结束后 fit 一次；
    //   2) 再补一次延时 fit —— 模板预览弹窗有入场动画，首帧拿到的容器宽度偏小，
    //      只 fit 一次会让导图右侧被裁掉（弹窗稳定后不会再有渲染事件，必须补这一刀）；
    //   3) 容器尺寸变化（窗口缩放 / 侧栏收起 / 弹窗尺寸变化）时重新 fit。
    const fit = () => {
      try {
        mm.view.fit()
        setScale(mm.view.scale)
      } catch {
        /* 实例已销毁或尚未就绪时忽略 */
      }
    }
    const onRenderEnd = () => fit()
    mm.on('node_tree_render_end', onRenderEnd)
    // 用户在 H5 上手动缩放后也同步百分比（用于 touch-action 与重置按钮）
    const onScaleEvt = (s: unknown) => {
      if (typeof s === 'number') setScale(s)
    }
    mm.on('scale', onScaleEvt)
    const timers = [setTimeout(fit, 320), setTimeout(fit, 760)]
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
      raf = requestAnimationFrame(fit)
    })
    ro.observe(host)

    // H5：原生无级缩放（见 attachNativeZoom 注释）。桌面端不需要（有滚轮 + 拖拽画布）。
    const detach = mobile ? attachNativeZoom(mm, host, setScale) : null

    return () => {
      detach?.()
      mmRef.current = null
      ro.disconnect()
      timers.forEach(clearTimeout)
      if (raf) cancelAnimationFrame(raf)
      mm.off('node_tree_render_end', onRenderEnd)
      mm.off('scale', onScaleEvt)
      try {
        mm.destroy()
      } catch {
        /* 忽略重复销毁 */
      }
    }
  }, [content, mobile])

  /** 回到自适应视图（缩放/平移后可用）：先复位 1:1，再按当前容器 fit */
  const resetView = () => {
    const mm = mmRef.current
    if (!mm) return
    try {
      mm.view.reset()
      mm.view.fit()
      setScale(mm.view.scale)
    } catch {
      /* 实例已销毁时忽略 */
    }
  }

  const zoomed = scale > 1.001

  return (
    <div style={{ position: 'relative', width: '100%', height: mobile ? '100%' : 560 }}>
      <div
        ref={elRef}
        data-h5-native-zoom={mobile ? '1' : '0'}
        data-h5-zoom-scale={Math.round(scale * 100)}
        style={{
          width: '100%',
          height: '100%',
          // 未放大时放行纵向划屏（阅读容器可滚）；放大后交给本组件单指平移
          touchAction: zoomed ? 'none' : 'pan-y',
        }}
      />
      {mobile && zoomed && (
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
