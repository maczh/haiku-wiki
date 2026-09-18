import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Space, Tooltip, Typography } from 'antd'
import {
  CompressOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ColumnWidthOutlined,
  RedoOutlined,
} from '@ant-design/icons'
import DOMPurify from 'dompurify'
import { isUsableSvg } from '../../lib/drawioDoc'
import LazyBoundary from '../common/LazyBoundary'

interface Props {
  /** draw.io 导出的 SVG 原文 */
  svg: string
  /** 可选：原始 XML（仅在无 SVG 时用于提示文案判断） */
  xml?: string
}

/** 缩放上下限（避免缩到看不见 / 放到失真） */
const MIN_SCALE = 0.1
const MAX_SCALE = 5

/**
 * 绘图文档的 SVG 矢量展示（阅读页 / 分享页共用）。
 *
 * 与旧实现的本质区别：**完全不加载 draw.io 组件**——
 * 只读渲染保存在文档正文里的 SVG（见 lib/drawioDoc.ts），因此
 * 分享页访客无需下载 37MB 静态资源，首屏也只有一次文档请求。
 *
 * XSS 边界：SVG 来自用户上传/导入的内容，分享页又是免登录渲染，
 * 因此进入 DOM 前统一经 DOMPurify 的 svg 画像清洗（移除脚本与事件属性）。
 */
export default function DrawioSvgView({ svg }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [fit, setFit] = useState(true)

  // 清洗：只保留 SVG 画像允许的标签与属性
  const clean = useMemo(() => {
    if (!isUsableSvg(svg)) return ''
    return DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      // draw.io 的文本用 <switch><foreignObject> 输出富文本，DOMPurify 的 svg 画像默认不含它
      ADD_TAGS: ['foreignObject', 'switch'],
      ADD_ATTR: ['requiredFeatures'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'a'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    })
  }, [svg])

  /** SVG 固有尺寸（优先 width/height，缺失时取 viewBox） */
  const natural = useMemo(() => readSvgSize(clean), [clean])

  /** 适应宽度：按容器可视宽度等比缩放 */
  const applyFit = useCallback(() => {
    const box = boxRef.current
    if (!box || natural.w <= 0) return
    const avail = box.clientWidth - 32
    if (avail <= 0) return
    setScale(clamp(avail / natural.w))
  }, [natural.w])

  // 首次渲染 / 内容变化 / 容器宽度变化时重算「适应宽度」
  useEffect(() => {
    if (!fit || !clean) return
    applyFit()
  }, [applyFit, clean, fit])

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

  if (!clean) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="info"
          showIcon
          message="该绘图文档尚未生成矢量预览"
          description="请在知识库中打开该文档的编辑页，系统会自动生成一次矢量图（SVG）；此后阅读页与分享页即可直接展示，无需加载绘图组件。"
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 320 }}>
      {/* 缩放工具条 */}
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
        <LazyBoundary tip="正在渲染矢量图…">
          <div style={{ width: natural.w * scale, height: natural.h * scale }}>
            <div
              className="hk-drawio-svg"
              style={{
                width: natural.w,
                height: natural.h,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
              dangerouslySetInnerHTML={{ __html: clean }}
            />
          </div>
        </LazyBoundary>
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
  setScale(clamp(cur + delta))
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))
}

/**
 * 读取 SVG 的固有尺寸。
 * 解析失败（脏数据）时给一个安全的默认视口，避免 0 尺寸导致图形不可见。
 */
function readSvgSize(svg: string): { w: number; h: number } {
  const fallback = { w: 800, h: 600 }
  if (!svg) return fallback
  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const root = doc.documentElement
    if (!root || root.nodeName === 'parsererror' || root.nodeName.toLowerCase() !== 'svg') return fallback
    const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    let w = parseFloat(root.getAttribute('width') || '')
    let h = parseFloat(root.getAttribute('height') || '')
    if (!Number.isFinite(w) || w <= 0) w = vb.length === 4 && Number.isFinite(vb[2]) ? vb[2] : fallback.w
    if (!Number.isFinite(h) || h <= 0) h = vb.length === 4 && Number.isFinite(vb[3]) ? vb[3] : fallback.h
    return { w: Math.max(1, w), h: Math.max(1, h) }
  } catch {
    return fallback
  }
}
