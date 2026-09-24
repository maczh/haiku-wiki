import { create } from 'zustand'
import { isMobile } from '../lib/isMobile'

/** 视图模式：'h5' = 手机版，'desktop' = 桌面版 */
export type ViewMode = 'h5' | 'desktop'

/** localStorage 记忆键：手动切换的视图模式优先于 UA 自动判定 */
export const VIEW_MODE_KEY = 'haiku_view_mode'

/** 合法的视图模式取值 */
const VALID_MODES: ReadonlyArray<ViewMode> = ['h5', 'desktop']

/** 读取记忆中的视图模式（无 / 非法 → null） */
function readStoredMode(): ViewMode | null {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY)
    if (raw && (VALID_MODES as string[]).includes(raw)) return raw as ViewMode
  } catch {
    /* localStorage 不可用时（隐私模式等）静默降级为 UA 判定 */
  }
  return null
}

/** 按「记忆优先、否则 UA」计算初始视图模式 */
function resolveInitialMode(): ViewMode {
  return readStoredMode() ?? (isMobile() ? 'h5' : 'desktop')
}

export interface ViewModeApi {
  /** 当前视图模式 */
  mode: ViewMode
  /** 切换视图模式：写入 localStorage 记忆并广播到全局 */
  setMode: (m: ViewMode) => void
}

/**
 * 视图模式全局 store（zustand）。
 *
 * ⚠️ 必须是**全局共享状态**而非组件内 useState：
 *   `App`（顶层选渲染 H5Router / 桌面路由）、`AppLayout`（切手机版）、`MMine`（切桌面版）
 *   分处不同组件，若各自 useState 持有副本，切换只会改到调用方，`App` 顶层不会重渲染，
 *   切换即失效（需手动刷新）。用 store 广播，切换即时生效。
 *
 * 初始化顺序：
 *   1. 读 localStorage['haiku_view_mode']，合法值（'h5'|'desktop'）直接采用；
 *   2. 否则按 UA 自动判定（手机 → 'h5'，其余 → 'desktop'）。
 *
 * 清除该键即可恢复「按 UA 自动」行为（见 MMine 的「恢复自动」）。
 */
const useViewModeStore = create<ViewModeApi>((set) => ({
  mode: resolveInitialMode(),
  setMode: (m) => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, m)
    } catch {
      /* 记忆写入失败不影响本次切换 */
    }
    set({ mode: m })
  },
}))

/**
 * 视图模式 hook（全站唯一来源）。
 *
 * @returns `{ mode, setMode }`
 */
export function useViewMode(): ViewModeApi {
  return useViewModeStore()
}
