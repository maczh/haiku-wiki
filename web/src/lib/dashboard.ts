// 首页 Dashboard 的纯逻辑：相对时间、统计、引导关闭状态、默认目标知识库。
//
// 之所以单独成文件：这些判断都有「边界」，而边界最容易在重构中被悄悄改坏
// （时间显示成负数、关闭状态存了却读不回来、快捷新建选了只读库…）。
// 集合到一个无副作用的模块后，scripts/verify-dashboard.mjs 可以直接
// 现场转译产品源码来断言，改逻辑这里立刻失败。

import dayjs from './dayjs'
import type { BookWithCount, RecentDocItem } from '../types'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 相对时间文案。
 *  · 未来时间（时钟偏差）→ 「刚刚」
 *  · < 1 分钟 → 刚刚
 *  · < 1 小时 → N 分钟前
 *  · < 24 小时 → N 小时前
 *  · < 30 天 → N 天前
 *  · 更早 → YYYY-MM-DD
 * 非法输入返回空串（表格里宁可空着，也不显示「NaN 天前」）。
 */
export function relativeTime(input?: string | number | Date | null, now: number = Date.now()): string {
  if (input === undefined || input === null || input === '') return ''
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime()
  if (Number.isNaN(t)) return ''
  const diff = now - t
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  const days = Math.floor(diff / DAY)
  if (days < 30) return `${days} 天前`
  return dayjs(t).format('YYYY-MM-DD')
}

/** 按更新时间倒序（后端已排序，此处是客户端兜底，避免接口顺序变化导致列表跳变）。 */
export function sortRecentDocs(items: RecentDocItem[]): RecentDocItem[] {
  return [...items].sort((a, b) => {
    const ta = new Date(a.updated_at).getTime()
    const tb = new Date(b.updated_at).getTime()
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
    if (Number.isNaN(ta)) return 1
    if (Number.isNaN(tb)) return -1
    return tb - ta
  })
}

/** 问候语（按小时分档，用于首页欢迎条）。 */
export function greetingOf(date: Date = new Date()): string {
  const h = date.getHours()
  if (h < 6) return '凌晨好'
  if (h < 9) return '早上好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/** 首页统计：我的知识库 / 参与团队 / 最近更新。 */
export interface DashboardStats {
  books: number
  teams: number
  recent: number
}

export function dashboardStats(input: {
  mine?: BookWithCount[]
  visible?: BookWithCount[]
  teams?: BookWithCount[]
  recent?: RecentDocItem[]
}): DashboardStats {
  return {
    books: (input.mine?.length ?? 0) + (input.visible?.length ?? 0),
    teams: input.teams?.length ?? 0,
    recent: input.recent?.length ?? 0,
  }
}

// ---------- 引导 / 视频的关闭状态（本地记忆） ----------

/** 新手向导关闭标记 */
export const ONBOARD_DISMISS_KEY = 'hk_onboard_dismissed'
/** 视频介绍关闭标记 */
export const INTRO_DISMISS_KEY = 'hk_intro_video_dismissed'

/** 可注入的最小存储接口（便于在 node 侧断言，不依赖真实 localStorage） */
export interface FlagStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

/** 读取关闭标记；无存储（SSR / 隐私模式）时视为「未关闭」。 */
export function readFlag(key: string, storage?: FlagStorage | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(key) === '1'
  } catch {
    return false
  }
}

/** 写入关闭标记；存储不可用时静默失败（不影响主流程）。 */
export function writeFlag(key: string, value: boolean, storage?: FlagStorage | null): void {
  if (!storage) return
  try {
    if (value) storage.setItem(key, '1')
    else storage.removeItem?.(key)
  } catch {
    /* 忽略：隐私模式 / 配额满 */
  }
}

/** 默认浏览器存储（拿不到时返回 null，调用方按「未关闭」处理）。 */
export function browserStorage(): FlagStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

// ---------- 快捷新建的默认目标 ----------

/** 快捷新建文档时的默认目标：优先「可写」的库；否则避开公司知识库（默认只读），再退第一本。 */
export function firstWritableBook(books: BookWithCount[]): BookWithCount | null {
  if (!books || books.length === 0) return null
  return books.find((b) => b.can_write) ?? books.find((b) => !b.is_company_kb) ?? books[0]
}

/** 各类型的默认文档名（与目录树「新建文档」保持一致的命名习惯）。 */
export const DOC_TYPE_DEFAULT_TITLE: Record<string, string> = {
  markdown: '未命名文档',
  sheet: '未命名表格',
  mindmap: '未命名思维导图',
  flowchart: '未命名流程图',
  drawing: '未命名绘图',
  todo: '未命名待办清单',
  calendar: '未命名工作日历',
  gantt: '未命名甘特图',
  api: '未命名接口文档',
}

/** 取某类型的默认文档名（未知类型回退「未命名文档」）。 */
export function defaultTitleOf(docType: string): string {
  return DOC_TYPE_DEFAULT_TITLE[docType] ?? '未命名文档'
}
