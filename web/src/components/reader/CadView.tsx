import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Space, Tag, Tooltip, Typography } from 'antd'
import {
  AimOutlined,
  DownloadOutlined,
  FileImageOutlined,
  FileTextOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons'
import { formatSize, parseAttachment } from '../../lib/attachment'

const MIN_SCALE = 0.02
const MAX_SCALE = 60
/** 以光标为中心缩放时每档的倍率（滚轮一格） */
const WHEEL_STEP = 1.15

interface Props {
  /** 附件型文档正文（FileAttachment JSON 字符串） */
  content: string
}

/**
 * CAD（.dwg/.dxf）只读预览。
 *
 * 预览用后端派生出的矢量 SVG（退化时用 PNG），配合 CSS transform 实现：
 *   · 滚轮缩放 —— 以光标位置为锚点（不是以容器中心），放大后光标下的图元保持不动；
 *   · 按住拖动 —— 上下左右平移，越界不限制（CAD 图纸拖动本就应自由）；
 *   · 双击 / 「适应窗口」按钮复位；「1:1」恢复原始像素比例；
 *   · 键盘 +、-、0、方向键。
 * 导出提供原图（.dwg/.dxf）与派生产物（.svg/.png），均为同源直链下载。
 */
export default function CadView({ content }: Props) {
  const ref = useMemo(() => parseAttachment(content), [content])
  if (!ref) {
    return <Alert type="warning" showIcon message="图纸信息缺失或格式不正确，无法预览" />
  }

  const svgUrl = ref.derived?.svg
  const pngUrl = ref.derived?.png
  // 矢量优先：SVG 放大不失真，PNG 仅作退化兜底
  const imageUrl = svgUrl || pngUrl
  // 注意：**降级**结果的 SVG 只是「把内嵌位图包进 <image>」，并不是真矢量。
  // 因此 degraded 时不能按矢量对待 —— 否则信息条会打出「矢量预览」（与实际不符），
  // 且放大超过 3 倍时不会切 pixelated（低分辨率位图会被插值糊掉）。
  const isVector = !!svgUrl && !ref.degraded

  return (
    <div>
      {/* 图纸信息条 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          background: '#f7f8fa',
          border: '1px solid #ebedf0',
          borderRadius: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <FileImageOutlined style={{ color: '#2f54eb', fontSize: 18 }} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ref.filename}
          </div>
          <div style={{ color: '#8a919f', fontSize: 12 }}>
            {ref.ext.toUpperCase()} 图纸 · {formatSize(ref.size)}
            {ref.degraded
              ? ' · 降级预览（内嵌位图）'
              : isVector
                ? ' · 矢量预览'
                : pngUrl
                  ? ' · 位图预览'
                  : ''}
          </div>
        </div>
        <Space size={6} wrap>
          <ExportLinks ref0={ref} />
        </Space>
      </div>

      {ref.degraded && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="图纸为降级预览"
          description={ref.note || '当前仅能展示文件内嵌的预览图，缩放/拖动仍可用，但矢量精度与图层信息不完整。'}
        />
      )}

      {imageUrl ? (
        <PanZoomImage
          url={imageUrl}
          filename={ref.filename}
          vector={isVector}
          // SVG 加载不到时退到 PNG（若存在）
          fallbackUrl={svgUrl && pngUrl ? pngUrl : undefined}
        />
      ) : (
        <Alert
          type="info"
          showIcon
          message="暂无法在线预览该图纸"
          description={
            ref.note ||
            '后端未生成可预览的 SVG/PNG。请点击上方按钮下载原文件后，用 AutoCAD 等专业软件查看。'
          }
        />
      )}
    </div>
  )
}

/** 导出按钮组：原图 + 后端已派生的格式（均为同源直链下载，不占内存） */
function ExportLinks({ ref0 }: { ref0: NonNullable<ReturnType<typeof parseAttachment>> }) {
  const items: { key: string; label: string; url: string; icon: React.ReactNode; title: string }[] = [
    {
      key: ref0.ext,
      label: `.${ref0.ext}`,
      url: ref0.url,
      icon: <DownloadOutlined />,
      title: '下载图纸原文件',
    },
  ]
  for (const [fmt, url] of Object.entries(ref0.derived ?? {})) {
    items.push({
      key: fmt,
      label: `.${fmt}`,
      url,
      icon: <DownloadOutlined />,
      title: `下载后端转换生成的 .${fmt} 文件`,
    })
  }
  return (
    <>
      {items.map((it) => (
        <Tooltip key={it.key} title={it.title}>
          <Button size="small" icon={it.icon} href={it.url} download target="_blank">
            {it.label}
          </Button>
        </Tooltip>
      ))}
    </>
  )
}

/**
 * 可缩放/平移的图片视口（CAD 图纸预览核心交互）。
 *
 * fallbackUrl：首选地址加载失败时的退化地址（SVG → PNG）。
 * 后端转换产物可能因转换器缺失/清理而不可读，此时不应把「无法读取后端生成的预览文件」
 * 这类内部措辞直接抛给用户，而是先尝试退化地址，仍失败则给出可操作提示（下载原文件）。
 */
function PanZoomImage({
  url,
  filename,
  vector,
  fallbackUrl,
}: {
  url: string
  filename: string
  vector: boolean
  fallbackUrl?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const view = useRef({ scale: 1, tx: 0, ty: 0 })
  const nat = useRef({ w: 0, h: 0 })
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  const [src, setSrc] = useState(url)
  const [triedFallback, setTriedFallback] = useState(false)

  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState('')
  const [dragging, setDragging] = useState(false)

  /** 把内部 ref 的视图状态同步到 React（渲染用） */
  const commit = useCallback(() => {
    setScale(view.current.scale)
    setOffset({ x: view.current.tx, y: view.current.ty })
  }, [])

  /** 适应窗口：等比缩放并居中 */
  const fit = useCallback(() => {
    const box = boxRef.current
    const { w, h } = nat.current
    if (!box || !w || !h) return
    const s = Math.min(box.clientWidth / w, box.clientHeight / h) * 0.94
    const k = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))
    view.current.scale = k
    view.current.tx = (box.clientWidth - w * k) / 2
    view.current.ty = (box.clientHeight - h * k) / 2
    commit()
  }, [commit])

  /** 以视口内某点为锚点缩放（锚点在内容坐标系中的位置保持不动） */
  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const v = view.current
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor))
      if (next === v.scale) return
      const px = (cx - v.tx) / v.scale
      const py = (cy - v.ty) / v.scale
      v.scale = next
      v.tx = cx - px * next
      v.ty = cy - py * next
      commit()
    },
    [commit],
  )

  /** 以视口中心为锚点缩放（按钮 / 快捷键用） */
  const zoomCenter = useCallback(
    (factor: number) => {
      const box = boxRef.current
      if (!box) return
      zoomAt(factor, box.clientWidth / 2, box.clientHeight / 2)
    },
    [zoomAt],
  )

  const reset = useCallback(() => {
    fit()
  }, [fit])

  const oneToOne = useCallback(() => {
    const box = boxRef.current
    const { w, h } = nat.current
    if (!box || !w || !h) return
    view.current.scale = 1
    view.current.tx = (box.clientWidth - w) / 2
    view.current.ty = (box.clientHeight - h) / 2
    commit()
  }, [commit])

  // 图片载入完成 → 记录原始尺寸并适应窗口
  useEffect(() => {
    setLoaded(false)
    setFailed('')
    setSrc(url)
    setTriedFallback(false)
    nat.current = { w: 0, h: 0 }
  }, [url])

  useEffect(() => {
    if (loaded) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, size.w, size.h])

  // 滚轮缩放：必须 passive:false 才能 preventDefault 阻止页面滚动
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = box.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      // deltaY < 0 为向上滚（放大）；同时兼顾触控板的横向滚动
      const d = e.deltaY !== 0 ? e.deltaY : e.deltaX
      if (d === 0) return
      zoomAt(d < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, cx, cy)
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // 窗口尺寸变化：保持当前缩放比例，但保证图纸不被挤出视野
  useEffect(() => {
    const onResize = () => {
      const box = boxRef.current
      const { w } = nat.current
      if (!box || !w) return
      void box.clientWidth
      commit()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [commit])

  // 键盘：+/- 缩放、0 适应、方向键平移
  const onKeyDown = (e: React.KeyboardEvent) => {
    const PAN = 60
    const v = view.current
    switch (e.key) {
      case '+':
      case '=':
        zoomCenter(WHEEL_STEP)
        break
      case '-':
      case '_':
        zoomCenter(1 / WHEEL_STEP)
        break
      case '0':
        reset()
        break
      case 'ArrowLeft':
        v.tx += PAN
        break
      case 'ArrowRight':
        v.tx -= PAN
        break
      case 'ArrowUp':
        v.ty += PAN
        break
      case 'ArrowDown':
        v.ty -= PAN
        break
      default:
        return
    }
    e.preventDefault()
    if (e.key.startsWith('Arrow')) commit()
  }

  const onPointerDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const v = view.current
    drag.current = { x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty, moved: false }
    setDragging(true)
  }

  const onPointerMove = (e: React.MouseEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    view.current.tx = d.tx + dx
    view.current.ty = d.ty + dy
    commit()
  }

  const endDrag = () => {
    drag.current = null
    setDragging(false)
  }

  const pct = Math.round(scale * 100)

  return (
    <div>
      {/* 缩放工具条 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          border: '1px solid #ebedf0',
          borderBottom: 'none',
          borderRadius: '8px 8px 0 0',
          background: '#fafafa',
        }}
      >
        <Tooltip title="缩小">
          <Button size="small" type="text" icon={<ZoomOutOutlined />} onClick={() => zoomCenter(1 / WHEEL_STEP)} />
        </Tooltip>
        <Tooltip title="放大">
          <Button size="small" type="text" icon={<ZoomInOutlined />} onClick={() => zoomCenter(WHEEL_STEP)} />
        </Tooltip>
        <Tooltip title="适应窗口">
          <Button size="small" type="text" icon={<AimOutlined />} onClick={reset} />
        </Tooltip>
        <Button size="small" type="text" onClick={oneToOne} style={{ fontSize: 12, paddingInline: 6 }}>
          1:1
        </Button>
        <Tag style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{pct}%</Tag>
        <div style={{ flex: 1 }} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          滚轮缩放 · 按住拖动 · 双击复位
        </Typography.Text>
      </div>

      {/* 视口 */}
      <div
        ref={boxRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onDoubleClick={reset}
        style={{
          position: 'relative',
          height: 'min(72vh, 720px)',
          minHeight: 360,
          overflow: 'hidden',
          border: '1px solid #ebedf0',
          borderRadius: '0 0 8px 8px',
          background: '#f0f2f5',
          cursor: dragging ? 'grabbing' : 'grab',
          outline: 'none',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        {failed && (
          <Alert
            type="warning"
            showIcon
            style={{ margin: 16 }}
            message="该图纸暂无法在线预览"
            description={`${failed}（文件：${filename}）原文件已保留，可点击上方按钮下载后用 AutoCAD 等专业软件打开。`}
          />
        )}
        {!failed && (
          <img
            src={src}
            alt={filename}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget
              // SVG 无 intrinsic 尺寸时回退到容器尺寸，避免 0 尺寸导致无法适应
              const w = img.naturalWidth || img.width
              const h = img.naturalHeight || img.height
              nat.current = { w, h }
              setSize({ w, h })
              setLoaded(true)
            }}
            onError={() => {
              // 先退化到备选产物（SVG → PNG）；仍失败才提示，避免直接抛出内部措辞
              if (fallbackUrl && !triedFallback && fallbackUrl !== src) {
                setTriedFallback(true)
                setSrc(fallbackUrl)
                return
              }
              setFailed('预览文件不可读或已被清理')
            }}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transformOrigin: '0 0',
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              // 高倍放大时保持矢量清晰；低倍缩小时避免摩尔纹
              imageRendering: vector ? 'auto' : scale > 3 ? 'pixelated' : 'auto',
              display: size.w ? 'block' : 'none',
              boxShadow: '0 1px 10px rgba(0,0,0,.14)',
              pointerEvents: 'none',
            }}
          />
        )}
        {!failed && !size.w && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#8a919f' }}>
            <Space>
              <FileTextOutlined /> 正在加载图纸…
            </Space>
          </div>
        )}
      </div>
    </div>
  )
}
