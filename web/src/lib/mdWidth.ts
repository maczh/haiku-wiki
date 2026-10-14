import { useCallback, useState } from 'react'

// Markdown 文档「编辑区 / 显示区」宽度（百分比，相对父容器/窗体宽度）。
//
// 需求（来自替换 typo-md-editor 为 v1-react 分支的任务）：
//   · 默认占窗体宽度的 80%，且随窗体大小自适应（百分比，非固定 px）；
//   · 可手动调整 —— 编辑/阅读/分享/H5 四态共用同一份偏好，互相同步。
//
// 与 lib/readerWidth.ts（其它文档类型用的 px 三档 + 拖动条）区分：markdown 单独走
// 百分比模型，恰好满足「80% 自适应 + 手动调整」的诉求。

/** localStorage 键：markdown 内容宽度偏好（百分比） */
export const MD_WIDTH_KEY = 'hk-md-width'

/** 默认宽度（占窗体宽度的百分比） */
export const DEFAULT_MD_WIDTH = 80

/** 可调范围 */
export const MD_WIDTH_MIN = 40
export const MD_WIDTH_MAX = 100

function clamp(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_MD_WIDTH
  return Math.min(MD_WIDTH_MAX, Math.max(MD_WIDTH_MIN, Math.round(v)))
}

export function readMdWidth(): number {
  try {
    const raw = localStorage.getItem(MD_WIDTH_KEY)
    if (!raw) return DEFAULT_MD_WIDTH
    return clamp(Number(raw))
  } catch {
    return DEFAULT_MD_WIDTH
  }
}

export function saveMdWidth(w: number): void {
  try {
    localStorage.setItem(MD_WIDTH_KEY, String(clamp(w)))
  } catch {
    /* 隐私模式下不可写：降级为本次会话有效 */
  }
}

/** markdown 内容宽度状态 hook：编辑/阅读/分享/H5 共用同一份 localStorage 偏好。 */
export function useMdWidth(): { width: number; setWidth: (w: number) => void } {
  const [width, setWidthState] = useState<number>(() => readMdWidth())

  const setWidth = useCallback((w: number) => {
    const next = clamp(w)
    setWidthState(next)
    saveMdWidth(next)
  }, [])

  return { width, setWidth }
}
