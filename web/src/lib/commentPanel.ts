import { useCallback, useEffect, useState } from 'react'

// 点评讨论区面板状态（III：右侧浮动面板）。
//
// 与阅读宽度偏好（readerWidth.ts）同源设计：状态落在 localStorage，跨页面 / 跨刷新共享，
// 分享页免登录也生效。这里只管「面板是否展开」与「面板宽度」两件事，评论数据由各阅读页独立拉取。

export interface CommentPanelState {
  open: boolean
  width: number
}

const COMMENT_PANEL_KEY = 'hk-comment-panel'
const COMMENT_PANEL_CHANGE_EVENT = 'hk-comment-panel-change'

export const COMMENT_PANEL_MIN = 280
export const COMMENT_PANEL_MAX = 560
export const COMMENT_PANEL_DEFAULT_WIDTH = 360

const DEFAULT_STATE: CommentPanelState = { open: false, width: COMMENT_PANEL_DEFAULT_WIDTH }

export function clampPanelWidth(v: number): number {
  if (!Number.isFinite(v)) return COMMENT_PANEL_DEFAULT_WIDTH
  return Math.min(COMMENT_PANEL_MAX, Math.max(COMMENT_PANEL_MIN, Math.round(v)))
}

function readState(): CommentPanelState {
  try {
    const raw = localStorage.getItem(COMMENT_PANEL_KEY)
    if (!raw) return DEFAULT_STATE
    const o = JSON.parse(raw) as Partial<CommentPanelState>
    return {
      open: !!o.open,
      width: clampPanelWidth(o.width ?? COMMENT_PANEL_DEFAULT_WIDTH),
    }
  } catch {
    return DEFAULT_STATE
  }
}

function saveState(s: CommentPanelState): void {
  try {
    localStorage.setItem(COMMENT_PANEL_KEY, JSON.stringify(s))
  } catch {
    /* 隐私模式下降级为本次会话有效 */
  }
}

export function useCommentPanel(): {
  open: boolean
  width: number
  setOpen: (v: boolean) => void
  toggle: () => void
  setWidth: (w: number) => void
} {
  const [state, setState] = useState<CommentPanelState>(() => readState())

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== COMMENT_PANEL_KEY) return
      setState(readState())
    }
    function onSameTab() {
      setState(readState())
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(COMMENT_PANEL_CHANGE_EVENT, onSameTab)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(COMMENT_PANEL_CHANGE_EVENT, onSameTab)
    }
  }, [])

  const commit = useCallback((next: CommentPanelState) => {
    setState(next)
    saveState(next)
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(COMMENT_PANEL_CHANGE_EVENT))
  }, [])

  const setOpen = useCallback((v: boolean) => commit({ ...state, open: v }), [state, commit])
  const toggle = useCallback(() => commit({ ...state, open: !state.open }), [state, commit])
  const setWidth = useCallback((w: number) => commit({ ...state, width: clampPanelWidth(w) }), [state, commit])

  return { open: state.open, width: state.width, setOpen, toggle, setWidth }
}
