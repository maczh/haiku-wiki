import type { CSSProperties } from 'react'
import type { DocType } from '../types'

/** 移动端顶栏高度（与 MobileLayout 保持一致） */
export const M_HEADER_HEIGHT = 52

/** 移动端底部 Tab 栏高度（与 BottomTabs 保持一致） */
export const M_TABBAR_HEIGHT = 56

/** 内容区通用内边距 */
export const M_CONTENT_PADDING: CSSProperties = { padding: 12 }

/**
 * 移动端「体验降级」的文档类型：复杂画布 / 表格 / 甘特等在大屏才好操作，
 * 手机端阅读或编辑时给出提示，引导用户到桌面版处理。
 */
export const H5_DEGRADED_TYPES: ReadonlyArray<DocType> = [
  'whiteboard',
  'sheet',
  'gantt',
  'drawing',
  'flowchart',
  'mindmap',
  'api',
  'prototype',
]

/** 判断某类型在移动端是否体验降级 */
export function isH5Degraded(t: DocType): boolean {
  return (H5_DEGRADED_TYPES as ReadonlyArray<DocType>).includes(t)
}
