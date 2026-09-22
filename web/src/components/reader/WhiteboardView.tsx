import { useEffect, useRef, useState } from 'react'
import { Alert, Spin } from 'antd'
import DrawioSvgView from './DrawioSvgView'
import { isUsableWhiteboardSvg, parseWhiteboardContent } from '../../lib/whiteboardDoc'
import { exportWhiteboardSvg } from '../../lib/whiteboardExport'

interface Props {
  /** 白板文档正文：{version, elements, appState, files, svg} JSON */
  content: string
  /** 是否显示「在编辑器中打开」提示（书级分享页等只读场景隐藏） */
  showEditHint?: boolean
}

/**
 * 白板文档只读预览（doc_type=whiteboard）。
 *
 * 与绘图文档同一策略：**阅读/分享页不加载 Excalidraw 编辑组件**，直接渲染
 * 保存时生成的 SVG 预览（矢量、可缩放、零编辑器依赖）——
 *   · 正文里已带 svg（正常保存过）→ 直接渲染；
 *   · 正文只有场景 JSON（模板预览、导入后未编辑）→ 用 Excalidraw 导出器现场渲染一次；
 *   · 场景为空 → 引导去编辑模式开画。
 */
export default function WhiteboardView({ content, showEditHint = true }: Props) {
  const { elements, appState, files, svg } = parseWhiteboardContent(content)
  /** 现场渲染产物（仅在正文没带 svg 时生成一次） */
  const [rendered, setRendered] = useState('')
  const [renderError, setRenderError] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    if (isUsableWhiteboardSvg(svg) || elements.length === 0) return
    const n = ++seq.current
    setRenderError('')
    exportWhiteboardSvg(elements, appState, files, 24)
      .then((s) => {
        if (seq.current === n) setRendered(s)
      })
      .catch((e: unknown) => {
        if (seq.current === n) setRenderError((e as Error)?.message || '渲染失败')
      })
  }, [content])

  if (!content || !content.trim() || elements.length === 0) {
    return (
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px 40px' }}>
        <Alert type="info" showIcon message="白板内容为空" description="切换到「编辑」模式即可开始绘制。" />
      </div>
    )
  }

  const usable = isUsableWhiteboardSvg(svg) || isUsableWhiteboardSvg(rendered)
  const svgText = isUsableWhiteboardSvg(svg) ? svg : rendered

  if (!usable) {
    if (renderError) {
      return (
        <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px 40px' }}>
          <Alert type="warning" showIcon message="白板预览渲染失败" description={renderError} />
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '80px 0', color: '#8a919f' }}>
        <Spin /> <span>正在渲染白板预览…</span>
      </div>
    )
  }

  return (
    <div
      style={{
        height: 'min(78vh, 820px)',
        minHeight: 420,
        margin: '0 24px 40px',
        border: '1px solid #ebedf0',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <DrawioSvgView svg={svgText} xml="" />
    </div>
  )
}
