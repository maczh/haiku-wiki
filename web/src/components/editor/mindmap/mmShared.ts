// 思维导图编辑器浮动工具条的共享类型与常量。
// 说明：simple-mind-map 未提供 TS 类型，这里只声明本项目用到的成员。

import type { MindMapApi, MindNodeShape, MindNodeStyle } from '../../mindmap-vite/src/components/MindMap'
import { MM_EXTRA_THEME_PRESETS } from './mmThemePresets.generated'

/**
 * 供浮动工具条使用的编辑器句柄（由 MindmapEditor 注入）。
 *
 * 画布已从 simple-mind-map 换成 mindmap-vite：simple-mind-map 的「节点实例 / 插件」
 * （execCommand / setThemeConfig / getCustomThemeConfig …）全部收敛为 MindMapApi
 * 上的方法，这里只把工具条需要的能力再包一层，工具条本身不必关心底层引擎。
 */
export interface MmHandle {
  /** 画布命令式句柄（未就绪时 null） */
  api: MindMapApi | null
  /** 当前是否有选中节点 */
  hasActive: boolean
  /** 当前选中节点 id（无选中时 null） */
  selectedId: () => string | null
  /** 选中节点的.style（无选中时空对象） */
  nodeStyle: () => MindNodeStyle
  /** 给选中节点合并样式（style 与新建节点默认值共用） */
  setNodeStyle: (patch: Partial<MindNodeStyle>) => void
  setNodeShape: (shape: MindNodeShape) => void
  clearNodeStyles: () => void
  /** 当前生效的主题快照（SMM themeConfig 口径，持久化不变） */
  theme: () => Record<string, unknown>
  /** 在当前主题上做一次合并覆盖（基础样式 / 字体等） */
  setTheme: (patch: Record<string, unknown>) => void
  /** 回到默认主题基准并套用给定预设（干净切换预设用）；不传则只回基准 */
  resetTheme: (preset?: Record<string, unknown>) => void
  /** 画布命令（undo / redo / EXPAND_ALL / UNEXPAND_ALL …） */
  execCommand: (cmd: string, ...args: unknown[]) => void
  setMode: (m: 'edit' | 'readonly') => void
  setWheelAction: (a: 'zoom' | 'move') => void
  setFreeDrag: (v: boolean) => void
  /** 提示统一出口 */
  toast: (msg: string, kind?: 'info' | 'success' | 'warning' | 'error') => void
  /** 触发防抖自动保存（主题/基础样式/字体等不触发 onChange 的改动需显式调用） */
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
  // 精编色卡（墨蓝 / 青玉 / 绛玫 / 石墨）：与内置文档模板里的脑图主题快照同源，
  // 见 mmThemePresets.generated.ts（由 tools/templates/gen-mindmap-themes.mjs 生成）。
  ...MM_EXTRA_THEME_PRESETS,
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
