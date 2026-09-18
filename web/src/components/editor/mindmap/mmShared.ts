// 思维导图编辑器浮动工具条的共享类型与常量。
// 说明：simple-mind-map 未提供 TS 类型，这里只声明本项目用到的成员。

import type MindMap from 'simple-mind-map'

/** 节点实例（仅取用到的成员） */
export interface MmNodeLike {
  isRoot?: boolean
  getData?(): { text?: string; style?: Record<string, unknown> }
  getStyle?(): Record<string, unknown>
  setStyle?(prop: string, value: unknown, isRender?: boolean): void
  setShape?(shape: string): void
  setImage?(img: { url: string; title?: string; width?: number; height?: number } | null): void
  setIcon?(icons: string[]): void
  setHyperlink?(url: string, title?: string): void
  setNote?(note: string): void
  setTag?(tags: string[]): void
}

/** 供浮动工具条使用的编辑器句柄（由 MindmapEditor 注入） */
export interface MmHandle {
  /** 画布实例（未初始化时 null） */
  mm: MindMap | null
  /** 当前是否有选中节点 */
  hasActive: boolean
  /** 取选中节点：无选中时提示并返回 null */
  activeNode: () => MmNodeLike | null
  /** 取实例：未就绪时提示并返回 null */
  requireMm: () => MindMap | null
  /** 提示统一出口 */
  toast: (msg: string, kind?: 'info' | 'success' | 'warning' | 'error') => void
  /** 当前已生效的自定义主题配置（opt.themeConfig 的实时快照，用于基础样式/字体的累加式覆盖） */
  baseTheme: () => Record<string, unknown>
  /** 默认主题配置（未叠加任何自定义样式时的基准，用于主题预设的「干净切换」与高亮匹配） */
  defaultTheme: () => Record<string, unknown>
  /** 触发防抖自动保存（主题/基础样式/字体等不触发 data_change 的改动需显式调用） */
  scheduleSave: () => void
}

/** 浅递归合并：普通对象逐键合并，数组与基本类型直接替换 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T))
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k]
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v
  }
  return out as T
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Painter 插件（格式刷）运行时接口 */
export interface MmPainter {
  startPainter?: () => void
  endPainter?: () => void
}

/** 结构面板可选布局（与 simple-mind-map LAYOUT 常量一致） */
export const MM_LAYOUTS: { value: string; label: string }[] = [
  { value: 'logicalStructure', label: '逻辑结构图' },
  { value: 'logicalStructureLeft', label: '逻辑结构图（向左）' },
  { value: 'mindMap', label: '思维导图' },
  { value: 'organizationStructure', label: '组织结构图' },
  { value: 'catalogOrganization', label: '目录组织图' },
  { value: 'timeline', label: '时间轴' },
  { value: 'timeline2', label: '时间轴 2' },
  { value: 'verticalTimeline', label: '竖向时间轴' },
  { value: 'fishbone', label: '鱼骨图' },
  { value: 'rightFishbone', label: '向右鱼骨图' },
]

/** 节点形状（SET_NODE_SHAPE 取值，与 shapeList 一致） */
export const MM_SHAPES: { value: string; label: string }[] = [
  { value: 'rectangle', label: '矩形' },
  { value: 'roundedRectangle', label: '圆角矩形' },
  { value: 'ellipse', label: '椭圆' },
  { value: 'circle', label: '圆形' },
  { value: 'diamond', label: '菱形' },
  { value: 'parallelogram', label: '平行四边形' },
  { value: 'octagonalRectangle', label: '八角矩形' },
  { value: 'outerTriangularRectangle', label: '外三角矩形' },
  { value: 'innerTriangularRectangle', label: '内三角矩形' },
]

/** 主题预设：仅覆盖默认主题的关键颜色字段（setTheme 采用浅合并语义） */
export interface MmThemePreset {
  key: string
  label: string
  /** 卡片预览色（根节点 / 一级节点 / 连线） */
  preview: [string, string, string]
  theme: Record<string, unknown>
}

/** 构建主题预设所需的默认主题片段（root/second/node 各层样式） */
function level(color: string, fillColor: string, borderColor: string) {
  return { color, fillColor, borderColor }
}

export const MM_THEME_PRESETS: MmThemePreset[] = [
  {
    key: 'default',
    label: '默认',
    preview: ['#ffffff', '#ffffff', '#5496ff'],
    theme: {},
  },
  {
    key: 'ocean',
    label: '海洋',
    preview: ['#1f6fe0', '#d6ecff', '#7fb6f5'],
    theme: {
      lineColor: '#7fb6f5',
      root: { ...level('#ffffff', '#1f6fe0', '#1f6fe0') },
      second: { ...level('#0b3f86', '#d6ecff', '#7fb6f5') },
      node: { ...level('#1d3f6b', '#f2f8ff', '#bcdcff') },
    },
  },
  {
    key: 'forest',
    label: '森林',
    preview: ['#2b9348', '#e3f6e8', '#8fd6a5'],
    theme: {
      lineColor: '#8fd6a5',
      root: { ...level('#ffffff', '#2b9348', '#2b9348') },
      second: { ...level('#14532d', '#e3f6e8', '#8fd6a5') },
      node: { ...level('#1f4d33', '#f3fbf5', '#c7e9d3') },
    },
  },
  {
    key: 'sunset',
    label: '暖阳',
    preview: ['#fa8c16', '#ffeccc', '#f7c07a'],
    theme: {
      lineColor: '#f7c07a',
      root: { ...level('#ffffff', '#fa8c16', '#fa8c16') },
      second: { ...level('#7c3d00', '#ffeccc', '#f7c07a') },
      node: { ...level('#5f3a10', '#fff8ee', '#f7e2c4') },
    },
  },
  {
    key: 'grape',
    label: '紫罗兰',
    preview: ['#722ed1', '#efe4ff', '#bd9bf0'],
    theme: {
      lineColor: '#bd9bf0',
      root: { ...level('#ffffff', '#722ed1', '#722ed1') },
      second: { ...level('#3d1a70', '#efe4ff', '#bd9bf0') },
      node: { ...level('#412b63', '#faf6ff', '#ded0f7') },
    },
  },
  {
    key: 'dark',
    label: '暗夜',
    preview: ['#2b2f38', '#1f242c', '#6b7684'],
    theme: {
      backgroundColor: '#15181d',
      lineColor: '#6b7684',
      root: { ...level('#f5f7fa', '#2b2f38', '#4b5563') },
      second: { ...level('#e5e7eb', '#1f242c', '#4b5563') },
      node: { ...level('#d1d5db', '#1b1f26', '#3f4650') },
    },
  },
]

/** 字体候选（右下工具条字体选择） */
export const MM_FONTS: { value: string; label: string }[] = [
  { value: '', label: '默认字体' },
  { value: '微软雅黑, Microsoft YaHei, sans-serif', label: '微软雅黑' },
  { value: '宋体, SimSun, serif', label: '宋体' },
  { value: '黑体, SimHei, sans-serif', label: '黑体' },
  { value: '楷体, KaiTi, serif', label: '楷体' },
  { value: 'PingFang SC, Microsoft YaHei, sans-serif', label: '苹方' },
]
