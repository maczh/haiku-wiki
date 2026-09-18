import { useCallback, useEffect, useState } from 'react'

// 阅读区正文宽度（I：阅读体验）。
//
// 需求：文档阅读页与分享预览页都要能让读者自己决定正文宽度 ——
//   · 三档快捷：标准（780px）/ 宽屏（1100px）/ 全宽（不限制）；
//   · 另给连续拖动条，可在 600~1800px 之间自由调节；
//   · 选择写入 localStorage，刷新后保持；分享页访客未登录，同样在本地生效。
//
// 之所以放在 lib 而不是页面里：阅读页、书级分享页、文档级分享页三处都要共用同一份状态，
// 且分享页是免登录场景，不能依赖服务端用户配置。

export type ReaderWidthMode = 'standard' | 'wide' | 'full' | 'custom'

export interface ReaderWidthState {
  mode: ReaderWidthMode
  /** 自定义宽度（px）；mode=full 时为 null，表示不限制宽度 */
  width: number | null
}

/** localStorage 键：阅读区宽度偏好 */
export const READER_WIDTH_KEY = 'hk-reader-width'

/** 同一标签页内宽度变更广播事件（localStorage 的 storage 事件不触发于当前页） */
const READER_WIDTH_CHANGE_EVENT = 'hk-reader-width-change'

/** 拖动条范围 */
export const READER_WIDTH_MIN = 600
export const READER_WIDTH_MAX = 1800
export const READER_WIDTH_STEP = 20

/** 三档预设：width 为 null 表示全宽（不设 max-width） */
export const READER_WIDTH_PRESETS: { key: Exclude<ReaderWidthMode, 'custom'>; label: string; width: number | null }[] = [
  { key: 'standard', label: '标准', width: 780 },
  { key: 'wide', label: '宽屏', width: 1100 },
  { key: 'full', label: '全宽', width: null },
]

export const DEFAULT_READER_WIDTH: ReaderWidthState = { mode: 'standard', width: 780 }

/** 三档 → 实际宽度（custom 时返回当前自定义值） */
export function resolveWidth(s: ReaderWidthState): number | null {
  if (s.mode === 'full') return null
  if (s.mode === 'custom') return clampWidth(s.width ?? DEFAULT_READER_WIDTH.width ?? 780)
  const preset = READER_WIDTH_PRESETS.find((p) => p.key === s.mode)
  return preset?.width ?? DEFAULT_READER_WIDTH.width
}

export function clampWidth(v: number): number {
  if (!Number.isFinite(v)) return READER_WIDTH_MIN
  return Math.min(READER_WIDTH_MAX, Math.max(READER_WIDTH_MIN, Math.round(v)))
}

/** 读取本地偏好；损坏数据（手改 localStorage / 旧版本结构）回退默认值，不让页面崩 */
export function readReaderWidth(): ReaderWidthState {
  try {
    const raw = localStorage.getItem(READER_WIDTH_KEY)
    if (!raw) return DEFAULT_READER_WIDTH
    const o = JSON.parse(raw) as Partial<ReaderWidthState>
    const mode = o.mode
    if (mode === 'full') return { mode: 'full', width: null }
    if (mode === 'standard' || mode === 'wide') return { mode, width: resolveWidth({ mode, width: null }) }
    if (mode === 'custom') {
      const w = clampWidth(Number(o.width))
      return { mode: 'custom', width: w }
    }
    return DEFAULT_READER_WIDTH
  } catch {
    return DEFAULT_READER_WIDTH
  }
}

/** 用户是否显式调整过宽度（用于「未调整时沿用页面自带分档」的场景） */
export function hasReaderWidthPreference(): boolean {
  try {
    return localStorage.getItem(READER_WIDTH_KEY) != null
  } catch {
    return false
  }
}

export function saveReaderWidth(s: ReaderWidthState): void {
  try {
    localStorage.setItem(READER_WIDTH_KEY, JSON.stringify(s))
  } catch {
    /* 隐私模式下 localStorage 可能不可写：功能降级为「本次会话有效」 */
  }
}

/**
 * 阅读宽度状态 hook（跨页面/跨刷新共享同一份 localStorage 偏好）。
 * 返回 maxWidth：可直接作为正文容器的 maxWidth（null 表示不限制）。
 */
export function useReaderWidth(): {
  state: ReaderWidthState
  maxWidth: number | null
  /** 用户是否显式调整过（未调整时页面可沿用自己的默认分档） */
  customized: boolean
  setMode: (m: Exclude<ReaderWidthMode, 'custom'>) => void
  setWidth: (w: number) => void
} {
  const [state, setState] = useState<ReaderWidthState>(() => readReaderWidth())

  // 多标签页 / 三处页面同时打开时保持一致（storage 事件只在「其它」标签页触发）
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== READER_WIDTH_KEY) return
      setState(readReaderWidth())
    }
    function onSameTabChange() {
      setState(readReaderWidth())
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(READER_WIDTH_CHANGE_EVENT, onSameTabChange)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(READER_WIDTH_CHANGE_EVENT, onSameTabChange)
    }
  }, [])

  const setMode = useCallback((m: Exclude<ReaderWidthMode, 'custom'>) => {
    setState((prev) => {
      const next: ReaderWidthState = m === 'full' ? { mode: 'full', width: null } : { mode: m, width: resolveWidth({ mode: m, width: null }) }
      if (prev.mode === next.mode && prev.width === next.width) return prev
      saveReaderWidth(next)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(READER_WIDTH_CHANGE_EVENT))
      }
      return next
    })
  }, [])

  const setWidth = useCallback((w: number) => {
    setState((prev) => {
      const next: ReaderWidthState = { mode: 'custom', width: clampWidth(w) }
      if (prev.mode === next.mode && prev.width === next.width) return prev
      saveReaderWidth(next)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(READER_WIDTH_CHANGE_EVENT))
      }
      return next
    })
  }, [])

  // customized 只在 mount 与调整动作后变化：setMode/setWidth 里用 ref 同步翻转，
  // 避免每次 render 都读一次 localStorage。
  const [customized, setCustomized] = useState(() => hasReaderWidthPreference())
  const markCustomized = useCallback(() => setCustomized(true), [])

  return {
    state,
    maxWidth: resolveWidth(state),
    customized,
    setMode: useCallback(
      (m: Exclude<ReaderWidthMode, 'custom'>) => {
        markCustomized()
        setMode(m)
      },
      [markCustomized, setMode],
    ),
    setWidth: useCallback(
      (w: number) => {
        markCustomized()
        setWidth(w)
      },
      [markCustomized, setWidth],
    ),
  }
}
