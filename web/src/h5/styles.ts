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

/**
 * 移动端「画布型预览」需要双指缩放 + 单指拖动的类型。
 * 这些类型在 H5DocContainer 外层套 H5ZoomStage（见 H5DocContainer 的 zoomable）。
 * 覆盖：附件（PDF/DOCX/PPTX/图片/draw.io/CAD）、绘图。
 *
 * ⚠️ mindmap **刻意不在**这里：它是「按 scale 重新排布矢量 SVG」的渲染器，
 * 用 CSS transform 放大只会把整层位图拉花（放大后文字虚化）。改由 MindmapView
 * 内部驱动 `mm.view.scale` 做原生无级缩放，放大后依然清晰（见该文件的注释）。
 */
export const H5_ZOOMABLE_TYPES: ReadonlySet<DocType> = new Set<DocType>([
  'file', // pdf/docx/pptx/image/drawio/cad 预览统一可缩放
  'drawing',
])

/**
 * 移动端「内容自身占满高度、内部自带滚动」的类型。
 * 这些类型在 H5DocContainer 内不再额外滚动，而是 height:100% 铺满（见 fill 属性）。
 * 当前仅甘特图：其右侧带折叠按钮的甘特面板需要确定高度才能正确布局。
 */
export const H5_FILL_TYPES: ReadonlySet<DocType> = new Set<DocType>(['gantt'])

/**
 * 根据文档类型给出 H5 阅读容器应有的 zoomable / fill 开关，
 * 让 MDoc / MShare / MShareDoc 三处阅读入口保持一致的包裹策略。
 */
export function h5ContainerProps(t: DocType): { zoomable: boolean; fill: boolean } {
  return { zoomable: H5_ZOOMABLE_TYPES.has(t), fill: H5_FILL_TYPES.has(t) }
}
