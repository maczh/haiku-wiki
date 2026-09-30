// 思维导图编辑器浮动工具条的共享类型与常量。
// 画布为 vendored 的 mindmap-vite（自带 TS 类型）；
// 节点样式 / 基础样式 / 主题 / 优先级 / 进度 / 图标由 MindmapStyleCombos 直连 MindMapApi，不经此句柄。

import type { MindMapApi } from '../../mindmap-vite/src/components/MindMap'

/**
 * 供浮动工具条使用的编辑器句柄（由 MindmapEditor 注入）。
 *
 * simple-mind-map 时代的「节点实例 / 插件」（execCommand / setThemeConfig …）
 * 已全部收敛为 MindMapApi 上的方法，这里只把工具条需要的能力再包一层，
 * 工具条本身不必关心底层引擎。
 */
export interface MmHandle {
  /** 画布命令式句柄（未就绪时 null） */
  api: MindMapApi | null
  /** 当前是否有选中节点 */
  hasActive: boolean
  /** 当前选中节点 id（无选中时 null） */
  selectedId: () => string | null
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

/** 字体候选（右下工具条字体选择） */
export const MM_FONTS: { value: string; label: string }[] = [
  { value: '', label: '默认字体' },
  { value: '微软雅黑, Microsoft YaHei, sans-serif', label: '微软雅黑' },
  { value: '宋体, SimSun, serif', label: '宋体' },
  { value: '黑体, SimHei, sans-serif', label: '黑体' },
  { value: '楷体, KaiTi, serif', label: '楷体' },
  { value: 'PingFang SC, Microsoft YaHei, sans-serif', label: '苹方' },
]
