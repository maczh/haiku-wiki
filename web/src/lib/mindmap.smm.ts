// 存储格式 ⇄ mindmap-vite 组件数据模型的双向适配。
//
// **存储格式不变**：后端 / docs.content 仍写入 simple-mind-map 时代的 v2 契约
//   {"version":2,"root":{"data":{"text","expand",…},"children":[…]},"layout","theme"}
//   兼容旧文档与「未迁移的 data 键（uid / style / hyperlink / note / image…）」原样透传。
//
// 组件内部统一使用嵌套的 MindNode（{id,title,children,collapsed,style,note,link,…}），
// 本文件就是两层之间的唯一转换口；新增补齐项（image/tags/formula/frame/
// generalization/assocLines）也落在 SMM 的 data 里，依旧能被旧客户端读取。

import type { BaseStyle, MindAssocLine, MindNode, MindNodeFrame, MindNodeImage, MindNodeShape, MindNodeStyle, StructureType } from '../components/mindmap-vite/src/components/MindMap'

export interface SmmNodeData {
  text: string
  expand: boolean
  uid?: string
  [key: string]: unknown
}

export interface SmmNode {
  data: SmmNodeData
  children: SmmNode[]
}

export interface MindmapJSON {
  version: 2
  root: SmmNode
  layout?: string
  theme?: Record<string, unknown>
}

/* ------------------------------------------------------------------ *
 * 形状 / 结构 映射表
 * ------------------------------------------------------------------ */

/** simple-mind-map 形状 → 组件形状 */
const SHAPE_MAP: Record<string, MindNodeShape> = {
  rectangle: 'rect',
  rect: 'rect',
  roundedRectangle: 'rounded',
  rounded: 'rounded',
  ellipse: 'capsule',
  circle: 'capsule',
  capsule: 'capsule',
  diamond: 'rounded',
  parallelogram: 'rect',
  octagonalRectangle: 'rounded',
  outerTriangularRectangle: 'rounded',
  innerTriangularRectangle: 'rounded',
  underline: 'underline',
  none: 'none',
}

/** 结构：存储（SMM layout）→ 组件 StructureType */
const LAYOUT_TO_STRUCTURE: Record<string, StructureType> = {
  mindMap: 'mindmap',
  logicalStructure: 'logical-right',
  logicalStructureLeft: 'logical-left',
  organizationStructure: 'org',
  catalogOrganization: 'catalog',
  timeline: 'timeline',
  timeline2: 'timeline',
  verticalTimeline: 'timeline',
  fishbone: 'fishbone',
  rightFishbone: 'fishbone',
}

/** 结构：组件 StructureType → 存储（SMM layout）；缺省回落「思维导图」 */
const STRUCTURE_TO_LAYOUT: Record<StructureType, string> = {
  mindmap: 'mindMap',
  'logical-right': 'logicalStructure',
  'logical-left': 'logicalStructureLeft',
  org: 'organizationStructure',
  catalog: 'catalogOrganization',
  timeline: 'timeline',
  fishbone: 'fishbone',
}

export function smmLayoutToStructure(layout?: string): StructureType {
  if (!layout) return 'mindmap'
  return LAYOUT_TO_STRUCTURE[layout] ?? 'mindmap'
}

export function structureToSmmLayout(s: StructureType): string {
  return STRUCTURE_TO_LAYOUT[s] ?? 'mindMap'
}

/* ------------------------------------------------------------------ *
 * 节点样式 映射
 * ------------------------------------------------------------------ */

/** SMM 节点 style → MindNodeStyle */
function smmStyleToNodeStyle(raw: Record<string, unknown>): MindNodeStyle | undefined {
  const dec = typeof raw.textDecoration === 'string' ? raw.textDecoration : ''
  const style: MindNodeStyle = {}
  if (typeof raw.color === 'string') style.color = raw.color
  if (typeof raw.fillColor === 'string') style.background = raw.fillColor
  if (typeof raw.borderColor === 'string') style.borderColor = raw.borderColor
  if (typeof raw.borderWidth === 'number') style.borderWidth = raw.borderWidth
  if (typeof raw.borderRadius === 'number') style.borderRadius = raw.borderRadius
  if (numberOr(raw.borderRaduis)) style.borderRadius = raw.borderRaduis as number
  if (typeof raw.fontSize === 'number') style.fontSize = raw.fontSize
  if (typeof raw.fontFamily === 'string') style.fontFamily = raw.fontFamily
  if (raw.fontWeight === 'bold' || raw.fontWeight === 700 || raw.fontWeight === '700') style.bold = true
  if (raw.fontStyle === 'italic') style.italic = true
  if (dec === 'underline') style.underline = true
  if (dec === 'line-through') style.strike = true
  if (typeof raw.lineColor === 'string') style.borderColor = raw.lineColor
  if (typeof raw.lineWidth === 'number') style.borderWidth = raw.lineWidth
  const shape = typeof raw.shape === 'string' ? SHAPE_MAP[raw.shape] : undefined
  if (shape) style.shape = shape
  return Object.keys(style).length ? style : undefined
}

/** MindNodeStyle → SMM 节点 style */
function nodeStyleToSmmStyle(style?: MindNodeStyle): Record<string, unknown> | undefined {
  if (!style) return undefined
  const out: Record<string, unknown> = {}
  if (style.color) out.color = style.color
  if (style.background) out.fillColor = style.background
  if (style.borderColor) out.borderColor = style.borderColor
  if (style.borderWidth != null) out.borderWidth = style.borderWidth
  if (style.borderRadius != null) {
    out.borderRadius = style.borderRadius
    out.borderRaduis = style.borderRadius
  }
  if (style.fontSize != null) out.fontSize = style.fontSize
  if (style.fontFamily) out.fontFamily = style.fontFamily
  if (style.bold) out.fontWeight = 'bold'
  if (style.italic) out.fontStyle = 'italic'
  if (style.underline) out.textDecoration = 'underline'
  if (style.strike) out.textDecoration = 'line-through'
  if (style.shape) out.shape = shapeToSmm(style.shape)
  if (style.borderColor) out.lineColor = style.borderColor
  if (style.borderWidth != null) out.lineWidth = style.borderWidth
  return Object.keys(out).length ? out : undefined
}

function shapeToSmm(shape: MindNodeShape): string {
  const rev: Record<string, string> = {
    rect: 'rectangle',
    rounded: 'roundedRectangle',
    capsule: 'capsule',
    underline: 'underline',
    none: 'none',
  }
  return rev[shape] ?? 'roundedRectangle'
}

function numberOr(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/* ------------------------------------------------------------------ *
 * 图片 映射
 * ------------------------------------------------------------------ */

/** SMM 的 image 可能是字符串 URL，也可能是 {url,title}；统一成组件结构 */
function smmImageToModel(image: unknown, imageSize: unknown): MindNodeImage | undefined {
  const url =
    typeof image === 'string'
      ? image
      : image && typeof image === 'object' && typeof (image as { url?: unknown }).url === 'string'
        ? (image as { url: string }).url
        : ''
  if (!url) return undefined
  const size = (imageSize && typeof imageSize === 'object' ? imageSize : {}) as {
    width?: number
    height?: number
    custom?: boolean
  }
  const img: MindNodeImage = { url }
  const title =
    image && typeof image === 'object' && typeof (image as { title?: unknown }).title === 'string'
      ? (image as { title: string }).title
      : undefined
  if (title) img.title = title
  if (numberOr(size.width) && numberOr(size.height)) {
    img.width = size.width
    img.height = size.height
    img.custom = size.custom === true
  }
  return img
}

/** 组件图片 → SMM 的 image / imageSize（沿用 simple-mind-map 的字段口径） */
function modelImageToSmm(img?: MindNodeImage): { image?: unknown; imageSize?: unknown } {
  if (!img?.url) return {}
  const image: Record<string, unknown> = { url: img.url }
  if (img.title) image.title = img.title
  return {
    image,
    imageSize: {
      width: img.width ?? 120,
      height: img.height ?? 120,
      custom: img.custom ?? false,
    },
  }
}

/* ------------------------------------------------------------------ *
 * 主转换
 * ------------------------------------------------------------------ */

/** SMM 节点 → 组件节点（未迁移的可选字段会被丢弃，避免脏数据回流） */
export function smmNodeToMind(raw: SmmNode, index = 0): MindNode {
  const d = raw.data ?? {}
  const children = Array.isArray(raw.children) ? raw.children.map((c, i) => smmNodeToMind(c, i)) : []
  const node: MindNode = {
    id: typeof d.uid === 'string' && d.uid ? d.uid : `n${index}-${Math.random().toString(36).slice(2, 8)}`,
    title: typeof d.text === 'string' ? d.text : '',
    children,
    collapsed: d.expand === false,
  }
  const style = smmStyleToNodeStyle((d.style && typeof d.style === 'object' ? d.style : {}) as Record<string, unknown>)
  if (style) node.style = style
  if (typeof d.note === 'string' && d.note) node.note = d.note
  if (typeof d.hyperlink === 'string' && d.hyperlink) node.link = d.hyperlink
  if (Array.isArray(d.tags) && d.tags.length) node.tags = d.tags.filter((t): t is string => typeof t === 'string')
  else if (typeof d.tag === 'string' && d.tag) node.tags = [d.tag]
  const image = smmImageToModel(d.image, d.imageSize)
  if (image) node.image = image
  // 补齐项（迁移后新增，SMM 客户端读到会忽略，属安全扩展）
  if (typeof d.formula === 'string' && d.formula) node.formula = d.formula
  if (d.frame && typeof d.frame === 'object') {
    node.frame = (d.frame as { color?: string; label?: string }) as MindNodeFrame
  }
  if (d.generalization && typeof d.generalization === 'object') {
    node.generalization = d.generalization as MindNode['generalization']
  }
  return node
}

/** 组件节点 → SMM 节点（写回 uid，保证关联线 / 缩略图 id 稳定） */
export function mindNodeToSmm(node: MindNode): SmmNode {
  const data: SmmNodeData = { text: node.title, expand: !node.collapsed, uid: node.id }
  const style = nodeStyleToSmmStyle(node.style)
  if (style) data.style = style
  if (node.note) data.note = node.note
  if (node.link) data.hyperlink = node.link
  if (node.tags?.length) data.tags = node.tags
  const img = modelImageToSmm(node.image)
  if (img.image) data.image = img.image
  if (img.imageSize) data.imageSize = img.imageSize
  if (node.formula) data.formula = node.formula
  if (node.frame) data.frame = node.frame
  if (node.generalization) data.generalization = node.generalization
  return {
    data,
    children: (node.children ?? []).map((c) => mindNodeToSmm(c)),
  }
}

/** 关联线（组件挂在根节点上）→ 存回 SMM 根节点 data（保持单节点结构不变） */
export function withAssocLines(root: MindNode, lines: MindAssocLine[]): MindNode {
  if (!lines.length) return root
  return { ...root, assocLines: lines }
}

/* ------------------------------------------------------------------ *
 * 主题（SMM themeConfig）⇄ 组件 BaseStyle
 * ------------------------------------------------------------------ */

/**
 * SMM 主题快照 → 组件基础样式。
 * 只搬运「全局」那几个键（背景 / 连线色 / 连线宽 / 字体 / 字号 / 圆角 / 描边宽），
 * 层级配色（root / second / node）仍由组件内置主题决定，避免两套餐色体系打架。
 */
export function smmThemeToBase(theme?: Record<string, unknown>): BaseStyle {
  if (!theme) return {}
  const base: BaseStyle = {}
  const node = (theme.node && typeof theme.node === 'object' ? theme.node : {}) as Record<string, unknown>
  const root = (theme.root && typeof theme.root === 'object' ? theme.root : {}) as Record<string, unknown>
  if (typeof theme.backgroundColor === 'string') base.background = theme.backgroundColor
  if (typeof theme.lineColor === 'string') base.linkColor = theme.lineColor
  if (numberOr(theme.lineWidth)) base.linkWidth = theme.lineWidth as number
  if (typeof theme.radius === 'number') base.radius = theme.radius
  if (typeof theme.strokeWidth === 'number') base.strokeWidth = theme.strokeWidth
  if (typeof theme.fontFamily === 'string') base.fontFamily = theme.fontFamily
  if (numberOr(node.fontSize)) base.fontSize = node.fontSize as number
  else if (numberOr(root.fontSize)) base.fontSize = root.fontSize as number
  return base
}

/** 组件基础样式 → SMM 主题快照（在既有快照上增量覆盖，保留 root/second 的层级配色） */
export function baseToSmmTheme(base: BaseStyle, prev?: Record<string, unknown>): Record<string, unknown> {
  const theme: Record<string, unknown> = { ...(prev ?? {}) }
  if (base.background !== undefined) theme.backgroundColor = base.background
  if (base.linkColor !== undefined) theme.lineColor = base.linkColor
  if (base.linkWidth !== undefined) theme.lineWidth = base.linkWidth
  if (base.radius !== undefined) theme.radius = base.radius
  if (base.strokeWidth !== undefined) theme.strokeWidth = base.strokeWidth
  if (base.fontFamily !== undefined) {
    theme.fontFamily = base.fontFamily
    theme.root = { ...(asObj(theme.root)), fontFamily: base.fontFamily }
    theme.second = { ...(asObj(theme.second)), fontFamily: base.fontFamily }
    theme.node = { ...(asObj(theme.node)), fontFamily: base.fontFamily }
  }
  if (base.fontSize !== undefined) theme.node = { ...(asObj(theme.node)), fontSize: base.fontSize }
  return theme
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}
