import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Segmented, Space, Spin, Tag, Tooltip, Typography, message } from 'antd'
import {
  CaretRightOutlined,
  ExpandOutlined,
  LeftOutlined,
  PauseOutlined,
  RightOutlined,
  ShrinkOutlined,
} from '@ant-design/icons'

interface Props {
  url: string
  filename: string
}

/** 渲染用的逻辑画布尺寸（16:9）。用 CSS 缩放适配容器，避免为每次尺寸变化重建预览器。 */
const STAGE_W = 1280
const STAGE_H = 720

/** 自动播放可选的翻页间隔（秒） */
const INTERVALS = [3, 5, 10] as const

/**
 * PPTX 预览 / 播放（doc_type=file，ext=pptx）。
 *
 * 渲染由 pptx-preview（纯前端 OOXML 解析 + HTML 渲染）完成：
 *   · 用 `mode: 'slide'` 单页模式，配合 renderNextSlide / renderPreSlide 实现翻页与自动播放；
 *   · 逻辑画布固定 1280×720，外层用 CSS transform 等比缩放，因此改变窗口大小无需重新解析文件；
 *   · 键盘：← → 翻页、空格 播放/暂停、Home/End 首页末页。
 *
 * 保真度说明：该渲染器不覆盖 OOXML 的全部特性（图表/公式/部分艺术字与图案填充会缺失），
 * 因此界面上保留「下载原文件」，并在下方给出明确提示——不假装完整还原。
 */
export default function PptxView({ url, filename }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // 预览器实例（类型来自库，避免直接依赖其 d.ts 路径）
  const viewerRef = useRef<{ destroy: () => void } | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [interval, setIntervalSec] = useState<number>(5)
  const [scale, setScale] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)

  /** 当前页（优先读预览器内部状态，保证与其自带按钮同步） */
  const readIndex = useCallback((): number => {
    const v = viewerRef.current as unknown as { currentIndex?: number } | null
    return typeof v?.currentIndex === 'number' ? v.currentIndex : 0
  }, [])

  // 加载并首次渲染
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    setTotal(0)
    setIndex(0)
    setPlaying(false)
    ;(async () => {
      const stage = stageRef.current
      if (!stage) return
      stage.innerHTML = ''
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`无法读取文件（HTTP ${resp.status}）`)
      const buf = await resp.arrayBuffer()
      // 按需加载：pptx-preview 会连带引入 echarts，只有打开 PPTX 时才需要
      const { init } = await import('pptx-preview')
      if (!alive) return
      const viewer = init(stage, { width: STAGE_W, height: STAGE_H, mode: 'slide' })
      viewerRef.current = viewer
      await viewer.preview(buf)
      if (!alive) return
      // 单页模式预览完成后定位到第 1 页
      viewer.renderSingleSlide(0)
      setTotal(viewer.slideCount ?? 0)
      setIndex(0)
    })()
      .catch((e) => {
        if (alive) setError((e as Error)?.message || 'PPTX 解析失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      try {
        viewerRef.current?.destroy()
      } catch {
        /* 忽略销毁异常 */
      }
      viewerRef.current = null
    }
  }, [url])

  // 自适应缩放：跟随容器宽度，最大不超过 1:1
  useEffect(() => {
    const box = wrapRef.current
    if (!box) return
    const update = () => {
      const w = box.clientWidth
      setScale(Math.min(1, Math.max(0.2, w / STAGE_W)))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  // 与预览器内部状态同步页码（其自带按钮/分页会各自更新 currentIndex）
  useEffect(() => {
    if (total <= 0) return
    const t = window.setInterval(() => setIndex(readIndex()), 400)
    return () => window.clearInterval(t)
  }, [total, readIndex])

  const go = useCallback(
    (delta: number) => {
      const v = viewerRef.current as unknown as
        | { renderNextSlide: () => void; renderPreSlide: () => void; currentIndex: number; slideCount: number }
        | null
      if (!v || total <= 0) return
      const next = v.currentIndex + delta
      // 越界不循环：播放到底自动停，翻页则原地不动（与常见演示软件一致）
      if (next < 0 || next >= v.slideCount) return
      if (delta > 0) v.renderNextSlide()
      else v.renderPreSlide()
      setIndex(v.currentIndex)
    },
    [total],
  )

  const jump = useCallback(
    (i: number) => {
      const v = viewerRef.current as unknown as { renderSingleSlide: (i: number) => void; currentIndex: number } | null
      if (!v) return
      v.renderSingleSlide(i)
      setIndex(v.currentIndex)
    },
    [],
  )

  // 自动播放
  useEffect(() => {
    if (!playing || total <= 0) return
    const t = window.setInterval(() => {
      const v = viewerRef.current as unknown as { currentIndex: number; slideCount: number; renderNextSlide: () => void } | null
      if (!v) return
      if (v.currentIndex >= v.slideCount - 1) {
        setPlaying(false)
        return
      }
      v.renderNextSlide()
      setIndex(v.currentIndex)
    }, interval * 1000)
    return () => window.clearInterval(t)
  }, [playing, interval, total])

  // 全屏状态跟随
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const el = wrapRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await el.requestFullscreen()
    } catch {
      message.warning('当前浏览器不允许进入全屏')
    }
  }, [])

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 输入框获得焦点时不拦截
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        go(-1)
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'Home') {
        e.preventDefault()
        jump(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        jump(Math.max(0, total - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, jump, total])

  return (
    <div>
      {/* 播放控制条 */}
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
          flexWrap: 'wrap',
        }}
      >
        <Tooltip title="上一页（←）">
          <Button size="small" type="text" icon={<LeftOutlined />} disabled={loading || index <= 0} onClick={() => go(-1)} />
        </Tooltip>
        <Tooltip title={playing ? '暂停（空格）' : '自动播放（空格）'}>
          <Button
            size="small"
            type={playing ? 'primary' : 'default'}
            icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
            disabled={loading || total <= 0}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? '暂停' : '播放'}
          </Button>
        </Tooltip>
        <Tooltip title="下一页（→）">
          <Button
            size="small"
            type="text"
            icon={<RightOutlined />}
            disabled={loading || index >= total - 1}
            onClick={() => go(1)}
          />
        </Tooltip>

        <Tag style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>
          {total > 0 ? `${index + 1} / ${total}` : '—'}
        </Tag>

        <Segmented
          size="small"
          value={interval}
          onChange={(v) => setIntervalSec(Number(v))}
          options={INTERVALS.map((s) => ({ label: `${s}s`, value: s }))}
          disabled={loading || total <= 0}
        />

        <div style={{ flex: 1 }} />
        <Tooltip title={fullscreen ? '退出全屏' : '全屏播放'}>
          <Button
            size="small"
            type="text"
            icon={fullscreen ? <ShrinkOutlined /> : <ExpandOutlined />}
            disabled={loading || total <= 0}
            onClick={() => void toggleFullscreen()}
          />
        </Tooltip>
      </div>

      {/* 舞台 */}
      <div
        ref={wrapRef}
        style={{
          background: '#1f1f1f',
          border: '1px solid #ebedf0',
          borderRadius: '0 0 8px 8px',
          padding: fullscreen ? 0 : 12,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          overflow: 'auto',
          minHeight: 260,
        }}
      >
        {(loading || error) && (
          <div style={{ position: 'absolute', padding: 16, color: '#fff' }}>
            {loading ? (
              <Space>
                <Spin size="small" /> 正在解析幻灯片…
              </Space>
            ) : (
              <Alert
                type="error"
                showIcon
                style={{ maxWidth: 520 }}
                message="演示文稿预览失败"
                description={`${error}（文件：${filename}）。可下载原文件后用 PowerPoint 打开。`}
              />
            )}
          </div>
        )}
        <div
          style={{
            width: STAGE_W * scale,
            height: STAGE_H * scale,
            overflow: 'hidden',
            flexShrink: 0,
            // 解析完成前不显示空白舞台，避免闪烁
            visibility: loading || error ? 'hidden' : 'visible',
          }}
        >
          <div
            ref={stageRef}
            className="hk-pptx-stage"
            style={{
              width: STAGE_W,
              height: STAGE_H,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
      </div>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
        浏览器内预览为近似渲染：表格、图片、文本与基本形状可正常显示，图表、公式与部分艺术字效果可能缺失。
        若需完全一致的版式，请下载原文件查看。
      </Typography.Paragraph>
    </div>
  )
}
