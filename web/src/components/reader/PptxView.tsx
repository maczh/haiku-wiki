import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Segmented, Space, Spin, Tag, Tooltip, Typography, message } from 'antd'
import type { MenuProps } from 'antd'
import {
  CaretRightOutlined,
  CompressOutlined,
  ExpandOutlined,
  GlobalOutlined,
  LeftOutlined,
  PauseOutlined,
  RightOutlined,
  ShrinkOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons'
import { localizePptx } from '../../api/attachments'

/**
 * 本会话内已补做过外链图片本地化的 URL。
 *
 * 历史导入的 pptx 文档正文里没有 pptx_scanned 标记，每次打开都会走一次补做接口。
 * 接口本身幂等（无外链即时返回），但没必要同一会话里反复请求同一文件。
 */
const localizedOnce = new Set<string>()

interface Props {
  url: string
  filename: string
  /**
   * 该文件是否已做过「外链图片本地化」扫描。
   * 新导入的 pptx 由后端在导入阶段处理并置为 true；历史文件缺该标记，阅读时补做一次。
   */
  pptxScanned?: boolean
}

/** 渲染用的逻辑画布尺寸（16:9）。用 CSS 缩放适配容器，避免为每次尺寸变化重建预览器。 */
const STAGE_W = 1280
const STAGE_H = 720

/** 自动播放可选的翻页间隔（秒） */
const INTERVALS = [3, 5, 10] as const

/** 手动缩放的档位（与工具栏 +/- 对应） */
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const

/** 在字节流里找 ASCII 子串（用于快速判定 zip 内容，避免引第三方解压库） */
function bytesInclude(haystack: Uint8Array, needle: string): boolean {
  const n = needle.length
  if (n === 0 || haystack.length < n) return false
  const first = needle.charCodeAt(0)
  outer: for (let i = 0; i <= haystack.length - n; i++) {
    if (haystack[i] !== first) continue
    for (let j = 1; j < n; j++) {
      if (haystack[i + j] !== needle.charCodeAt(j)) continue outer
    }
    return true
  }
  return false
}

/**
 * 前置嗅探：在交给解析器之前先判断这到底是不是一份标准 .pptx。
 *
 * 这是为了把「部分 pptx 无法解析」从一个模糊的解析异常，变成一句能照着做的提示。
 * zip 的条目名是明文存放的（本地文件头在前、中央目录在后），所以只扫首尾两段就够，
 * 不必完整解压 —— 也就不需要为此引入解压库。
 */
function sniffPptx(buf: ArrayBuffer): { ok: true } | { ok: false; reason: string } {
  const all = new Uint8Array(buf)
  if (all.length < 4) {
    return { ok: false, reason: '文件内容为空或已被截断' }
  }
  const isZip = all[0] === 0x50 && all[1] === 0x4b
  const isCfb = all[0] === 0xd0 && all[1] === 0xcf && all[2] === 0x11 && all[3] === 0xe0
  if (isCfb) {
    return {
      ok: false,
      reason:
        '这是 PowerPoint 97-2003 的 .ppt 旧格式（二进制复合文档），浏览器端解析器只认 .pptx（OOXML）。请在 PowerPoint / WPS 里「另存为 .pptx」后重新导入',
    }
  }
  if (!isZip) {
    return { ok: false, reason: '文件不是有效的 .pptx（OOXML 应为 zip 容器），可能已损坏或扩展名与实际格式不符' }
  }
  const w = 1 << 20
  const head = all.subarray(0, Math.min(all.length, w))
  const tail = all.subarray(Math.max(0, all.length - w))
  const has = (s: string) => bytesInclude(head, s) || bytesInclude(tail, s)
  if (!has('ppt/presentation.xml')) {
    if (has('xl/workbook.xml')) {
      return { ok: false, reason: '这其实是一个 Excel 工作簿（压缩包内是 xl/ 而非 ppt/），请改用「表格」导入' }
    }
    if (has('word/document.xml')) {
      return { ok: false, reason: '这其实是一个 Word 文档（压缩包内是 word/ 而非 ppt/），请改用「Word」导入' }
    }
    return { ok: false, reason: '压缩包内缺少 ppt/presentation.xml，不是标准的 .pptx 演示文稿' }
  }
  return { ok: true }
}

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
export default function PptxView({ url, filename, pptxScanned }: Props) {
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
  /** 补做外链图片本地化之后的结果说明（空串表示无需提示） */
  const [localizeNote, setLocalizeNote] = useState('')
  /**
   * 缩放模式：
   *   fit    —— 适应容器（全屏时同时受宽高约束，即「适应屏幕分辨率」；非全屏按宽度、不超过 1:1）
   *   manual —— 用户显式指定的倍数（工具栏 +/- / 100%）
   * 自动测量只在 fit 模式下生效，否则用户手动缩放会被 ResizeObserver 立刻覆盖掉。
   */
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit')
  const [manualZoom, setManualZoom] = useState(1)

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
    setLocalizeNote('')
    ;(async () => {
      const stage = stageRef.current
      if (!stage) return
      stage.innerHTML = ''
      // 历史文件补做一次外链图片本地化：这一步会把网络图片下载并**写回源文件**，
      // 因此必须在取字节之前完成，否则拿到的还是缺图的那一份。
      let target = url
      if (!pptxScanned && !localizedOnce.has(url)) {
        localizedOnce.add(url)
        try {
          const r = await localizePptx(url)
          if (r.changed) {
            // 文件已改写：带一个一次性参数绕开浏览器对 /uploads 的缓存
            target = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`
            if (alive) setLocalizeNote(r.note)
          }
        } catch {
          // 补做失败不阻塞预览：渲染器仍会把能显示的画出来
        }
      }
      if (!alive) return
      const resp = await fetch(target)
      if (!resp.ok) throw new Error(`无法读取文件（HTTP ${resp.status}）`)
      const buf = await resp.arrayBuffer()
      // 先判定格式再解析：把「打不开」变成一句能照着做的提示
      const sniff = sniffPptx(buf)
      if (!sniff.ok) {
        if (alive) setError(sniff.reason)
        return
      }
      // 按需加载：pptx-preview 会连带引入 echarts，只有打开 PPTX 时才需要
      const { init } = await import('pptx-preview')
      if (!alive) return
      const viewer = init(stage, { width: STAGE_W, height: STAGE_H, mode: 'slide' })
      viewerRef.current = viewer
      try {
        await viewer.preview(buf)
      } catch (pe) {
        // 解析器自身的异常信息通常很含糊，补上「文件可能哪里不标准」的上下文
        const raw = (pe as Error)?.message || String(pe)
        throw new Error(
          `解析失败（${raw}）。这类文件常见于：由第三方工具生成、含加密/受保护内容，或使用了较新的 OOXML 特性。` +
            `可尝试在 PowerPoint 中打开后「另存为 .pptx」再导入`,
        )
      }
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
  }, [url, pptxScanned])

  // 让测量回调读到最新值（避免把它们放进依赖里反复重建 ResizeObserver）
  const zoomModeRef = useRef<'fit' | 'manual'>(zoomMode)
  const fullscreenRef = useRef(fullscreen)

  // 自适应缩放：fit 模式下跟随容器尺寸。
  // 非全屏按宽度适配（不超过 1:1，避免小文件被放大糊掉）；
  // 全屏时同时受高度约束，取宽高比例的较小值 —— 即「最大化后适应屏幕分辨率」，
  // 否则 16:9 的幻灯片在竖向窗口里会被裁掉上下或逼出滚动条。
  useEffect(() => {
    const box = wrapRef.current
    if (!box) return
    const update = () => {
      if (zoomModeRef.current !== 'fit') return
      const byW = box.clientWidth / STAGE_W
      if (fullscreenRef.current && box.clientHeight > 0) {
        setScale(Math.min(4, Math.max(0.1, Math.min(byW, box.clientHeight / STAGE_H))))
      } else {
        setScale(Math.min(1, Math.max(0.2, byW)))
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    zoomModeRef.current = zoomMode
  }, [zoomMode])

  // 进出全屏 / 切回适应模式时立刻重算一次（ResizeObserver 不一定会因全屏而触发）
  useEffect(() => {
    fullscreenRef.current = fullscreen
    if (zoomMode !== 'fit') return
    const box = wrapRef.current
    if (!box) return
    const byW = box.clientWidth / STAGE_W
    if (fullscreen && box.clientHeight > 0) {
      setScale(Math.min(4, Math.max(0.1, Math.min(byW, box.clientHeight / STAGE_H))))
    } else {
      setScale(Math.min(1, Math.max(0.2, byW)))
    }
  }, [fullscreen, zoomMode])

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

  // 手动缩放：直接采用用户指定的倍数
  useEffect(() => {
    if (zoomMode === 'manual') setScale(Math.min(4, Math.max(0.1, manualZoom)))
  }, [zoomMode, manualZoom])

  const zoomTo = useCallback((next: number) => {
    setZoomMode('manual')
    setManualZoom(Math.min(4, Math.max(0.1, next)))
  }, [])

  /** 按档位表缩放：从当前实际比例出发找相邻档，避免步进感受不一致 */
  const zoomStep = useCallback(
    (dir: number) => {
      const cur = zoomMode === 'manual' ? manualZoom : scale
      if (dir > 0) {
        const up = ZOOM_STEPS.find((z) => z > cur + 1e-6)
        zoomTo(up ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
      } else {
        const down = [...ZOOM_STEPS].reverse().find((z) => z < cur - 1e-6)
        zoomTo(down ?? ZOOM_STEPS[0])
      }
    },
    [zoomMode, manualZoom, scale, zoomTo],
  )

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 输入框获得焦点时不拦截
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return
      // Ctrl/⌘ + / − / 0 缩放，与常见看图/办公软件一致
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          zoomStep(1)
          return
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          zoomStep(-1)
          return
        }
        if (e.key === '0') {
          e.preventDefault()
          setZoomMode('fit')
          return
        }
        return
      }
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
  }, [go, jump, total, zoomStep])

  /** 缩放下拉：适应窗口 + 固定档位。用档位而不是任意输入，保证每档都落在像素对齐的整数倍上。 */
  const zoomMenu: MenuProps = {
    selectable: false,
    items: [
      { key: 'fit', label: '适应窗口（全屏时适应屏幕分辨率）' },
      { key: 'one', label: '原始大小 100%' },
      { type: 'divider' },
      ...ZOOM_STEPS.map((z) => ({ key: `z:${z}`, label: `${Math.round(z * 100)}%` })),
    ],
    onClick: ({ key }) => {
      if (key === 'fit') setZoomMode('fit')
      else if (key === 'one') zoomTo(1)
      else if (key.startsWith('z:')) zoomTo(Number(key.slice(2)))
    },
  }

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

        {/* 缩放组：− / 比例 / ＋ 固定档位；「适应」一键回到自适应 */}
        <Space size={2} style={{ marginLeft: 4 }}>
          <Tooltip title="缩小（Ctrl/⌘ −）">
            <Button
              size="small"
              type="text"
              icon={<ZoomOutOutlined />}
              disabled={loading || !!error}
              onClick={() => zoomStep(-1)}
            />
          </Tooltip>
          <Dropdown menu={zoomMenu} trigger={['click']} placement="bottomRight">
            <Button
              size="small"
              type="text"
              disabled={loading || !!error}
              style={{ minWidth: 54, fontVariantNumeric: 'tabular-nums' }}
            >
              {Math.round(scale * 100)}%
            </Button>
          </Dropdown>
          <Tooltip title="放大（Ctrl/⌘ ＋）">
            <Button
              size="small"
              type="text"
              icon={<ZoomInOutlined />}
              disabled={loading || !!error}
              onClick={() => zoomStep(1)}
            />
          </Tooltip>
          <Tooltip title="适应窗口：全屏时按屏幕分辨率等比缩放整页（Ctrl/⌘ 0）">
            <Button
              size="small"
              type={zoomMode === 'fit' ? 'primary' : 'text'}
              icon={<CompressOutlined />}
              disabled={loading || !!error}
              onClick={() => setZoomMode('fit')}
            >
              适应
            </Button>
          </Tooltip>
        </Space>

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
          position: 'relative',
          background: fullscreen ? '#000' : '#1f1f1f',
          border: fullscreen ? 'none' : '1px solid #ebedf0',
          borderRadius: fullscreen ? 0 : '0 0 8px 8px',
          padding: fullscreen ? 0 : 12,
          // 全屏时铺满屏幕，让「适应」能拿到真实可用高度
          height: fullscreen ? '100%' : undefined,
          display: 'flex',
          justifyContent: 'center',
          alignItems: fullscreen ? 'center' : 'flex-start',
          overflow: 'auto',
          minHeight: fullscreen ? 0 : 260,
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

      {localizeNote && (
        <Alert
          type="success"
          showIcon
          icon={<GlobalOutlined />}
          style={{ marginTop: 8 }}
          message={localizeNote}
          description="幻灯片原本以「链接图片」的方式引用网络地址，已下载并嵌入文件本体，现在断网也能完整显示。"
        />
      )}
    </div>
  )
}
