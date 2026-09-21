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
    // 自适应缩放：
    //   1) 渲染结束后 fit 一次；
    //   2) 再补一次延时 fit —— 模板预览弹窗有入场动画，首帧拿到的容器宽度偏小，
    //      只 fit 一次会让导图右侧被裁掉（弹窗稳定后不会再有渲染事件，必须补这一刀）；
    //   3) 容器尺寸变化（窗口缩放 / 侧栏收起 / 弹窗尺寸变化）时重新 fit。
    const fit = () => {
      try {
        mm.view.fit()
      } catch {
        /* 实例已销毁或尚未就绪时忽略 */
      }
    }
    const onRenderEnd = () => fit()
    mm.on('node_tree_render_end', onRenderEnd)
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

    return () => {
      ro.disconnect()
      timers.forEach(clearTimeout)
      if (raf) cancelAnimationFrame(raf)
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
