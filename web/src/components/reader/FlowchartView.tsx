import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Space, Spin, Tooltip, Typography } from 'antd'
import { CompressOutlined, ColumnWidthOutlined, RedoOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'
import { renderFlowchart } from '../../lib/flowchart'
import { readSvgSize } from '../../lib/svgSize'

interface Props {
  /** mermaid 源码字符串（docs.content 原文，非 JSON） */
  content: string
}

/** 缩放上下限（与绘图文档预览一致） */
const MIN_SCALE = 0.1
const MAX_SCALE = 5

/**
 * mermaid 只读渲染（阅读页 / 流程图编辑器右侧实时预览共用）。
 *
 * 大图（时序图/甘特/长流程）在固定宽度容器里会被压得很小且看不清，
 * 因此与 DrawioSvgView 同策略提供缩放工具条：
 *   缩小 / 百分比 / 放大 / 适应宽度 / 原始尺寸，默认「适应宽度」（不超过 1:1）。
 * parse/渲染失败显示行内 Alert，不崩溃。
 */
export default function FlowchartView({ content }: Props) {
  const [loading, setLoading] = useState(false)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [fit, setFit] = useState(true)

  /** SVG 固有尺寸（mermaid 输出 width="100%"，真实尺寸取 viewBox） */
  const natural = useMemo(() => readSvgSize(svg), [svg])

  /** 适应宽度：按容器可视宽度等比缩放（默认不超过 1:1，避免小图被放大） */
  const applyFit = useCallback(() => {
    const box = boxRef.current
    if (!box || natural.w <= 0) return
    const avail = box.clientWidth - 32
    if (avail <= 0) return
    setScale(Math.min(1, avail / natural.w))
  }, [natural.w])

  // 首次渲染 / 内容变化 / 容器宽度变化时重算「适应宽度」
  useEffect(() => {
    if (!fit || !svg) return
    applyFit()
  }, [applyFit, svg, fit])

  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      if (!fit) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(applyFit)
    })
    ro.observe(box)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [applyFit, fit])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    renderFlowchart(content || '')
      .then((res) => {
        if (cancelled) return
        if (res.svg) {
          setSvg(res.svg)
          setError('')
        } else {
          setError(res.error || '流程图语法有误')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [content])

  if (loading) {
    return <Spin style={{ display: 'block', margin: '40px auto' }} />
  }
  if (error) {
    return (
      <div style={{ padding: 12 }}>
        <Alert
          type="warning"
          showIcon
          message="流程图语法有误"
          description={<pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{error}</pre>}
        />
      </div>
    )
  }
  if (!svg) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 320 }}>
      {/* 缩放工具条（与绘图文档预览一致） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid #ebedf0',
          flexWrap: 'wrap',
        }}
      >
        <Space size={6}>
          <Tooltip title="缩小">
            <Button size="small" icon={<ZoomOutOutlined />} onClick={() => bump(setScale, setFit, scale, -0.2)} />
          </Tooltip>
          <Typography.Text style={{ fontSize: 12, width: 46, textAlign: 'center', display: 'inline-block' }}>
            {Math.round(scale * 100)}%
          </Typography.Text>
          <Tooltip title="放大">
            <Button size="small" icon={<ZoomInOutlined />} onClick={() => bump(setScale, setFit, scale, 0.2)} />
          </Tooltip>
          <Tooltip title="适应宽度">
            <Button
              size="small"
              icon={<ColumnWidthOutlined />}
              type={fit ? 'primary' : 'default'}
              onClick={() => {
                setFit(true)
                applyFit()
              }}
            >
              适应宽度
            </Button>
          </Tooltip>
          <Tooltip title="原始尺寸（1:1）">
            <Button
              size="small"
              icon={fit ? <CompressOutlined /> : <RedoOutlined />}
              onClick={() => {
                setFit(false)
                setScale(1)
              }}
            >
              原始尺寸
            </Button>
          </Tooltip>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          矢量预览 · {Math.round(natural.w)}×{Math.round(natural.h)}
        </Typography.Text>
      </div>

      {/* 画布：外层滚动，内层按缩放后的真实尺寸占位，避免滚动条抖动 */}
      <div ref={boxRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fbfbfc', padding: 16 }}>
        <div style={{ width: natural.w * scale, height: natural.h * scale, margin: '0 auto' }}>
          <div
            style={{
              width: natural.w,
              height: natural.h,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              display: 'flex',
              justifyContent: 'center',
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </div>
  )
}

/** 缩放步进：手动缩放即退出「适应宽度」模式 */
function bump(
  setScale: (v: number) => void,
  setFit: (v: boolean) => void,
  cur: number,
  delta: number,
) {
  setFit(false)
  let next = cur + delta
  if (!Number.isFinite(next)) next = 1
  next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
  setScale(next)
}
