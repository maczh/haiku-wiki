import type { WorkbenchDoc } from '../types'
import { isOverdue, parseTodoJSON, type TodoItem } from './todo'
import { addDays, ganttEndIso, parseGanttJSON, taskStatus, todayIso, type GanttTaskData } from './gantt'
import {
  isAllDay,
  parseCalendarJSON,
  taskDateKey,
  taskState,
  taskTimeLabel,
  toDateKey,
  type TaskState,
} from './calendar'

/**
 * 首页「工作台」的聚合计算（纯函数，无 React / 无 DOM）。
 *
 * 设计要点：
 *  1. **只做聚合，不做渲染** —— 卡片组件只负责把这里的结果画出来，因此这些函数
 *     可以在 node 里直接断言（见 web/scripts/verify-workbench.mjs），不必起浏览器。
 *  2. **时间一律由外部注入**（`now` 参数）—— 否则「今天到期」「已超期」这类断言
 *     会随运行时刻漂移，测试变成偶然通过。
 *  3. **宽容解析** —— 正文交给各类型自己的 `parseXxxJSON`（它们已经能兜住脏数据），
 *     这里不再重复校验，坏数据最多体现为「这一篇没贡献统计」。
 *  4. **汇总口径必须诚实** —— 后端只返回每类最近 N 篇，所以卡片要能说明
 *     「基于最近 N 份清单」而不是假装是全量（见各 Aggregate 的 lists/charts/calendars）。
 */

/** 工作台关注的三类文档（与后端 workbenchDocTypes 保持一致，顺序即卡片优先级） */
export const WORKBENCH_TYPES = ['todo', 'gantt', 'calendar'] as const

/** 按类型筛选工作台文档 */
export function pickWorkbenchDocs(items: WorkbenchDoc[], docType: string): WorkbenchDoc[] {
  return items.filter((it) => it.doc_type === docType)
}

/**
 * 是否需要渲染工作台区块。
 *
 * 需求原文：「优先展示待办、甘特图工作进度、工作日历（若有这些文档的话，无则不显示）」——
 * 三类都没有时整段隐藏，而不是显示一个空壳。
 */
export function hasWorkbench(items: WorkbenchDoc[] | undefined | null): boolean {
  if (!items || items.length === 0) return false
  return WORKBENCH_TYPES.some((t) => items.some((it) => it.doc_type === t))
}

/** 把 'YYYY-MM-DD HH:mm' / 'YYYY-MM-DD' 归一成 'YYYY-MM-DD'；解析不出返回 '' */
export function dueDateKey(due: string): string {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec((due || '').trim())
  if (!m) return ''
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

// ---------------------------------------------------------------- 待办

export interface WorkbenchTodoEntry {
  docId: number
  bookId: number
  bookName: string
  docTitle: string
  item: TodoItem
  overdue: boolean
  dueToday: boolean
}

export interface TodoAggregate {
  /** 参与统计的清单数量（后端只给最近若干篇，故不等于全库待办清单数） */
  lists: number
  total: number
  done: number
  open: number
  overdue: number
  /** 需要人马上处理的条目：逾期 → 今天到期 → 有截止日 → 无截止日 */
  entries: WorkbenchTodoEntry[]
}

/**
 * 聚合所有待办清单。`limit` 限制返回条数（卡片只展示最紧要的几条）。
 *
 * 排序：逾期最前（截止日越早越前），其次今天到期，再次有截止日（按日期升序），
 * 最后是无截止日的条目（保持文档顺序）。
 */
export function aggregateTodos(docs: WorkbenchDoc[], now: Date = new Date(), limit = 6): TodoAggregate {
  const today = toDateKey(now)
  const out: TodoAggregate = { lists: 0, total: 0, done: 0, open: 0, overdue: 0, entries: [] }
  const entries: WorkbenchTodoEntry[] = []

  for (const doc of docs) {
    out.lists++
    const parsed = parseTodoJSON(doc.content)
    for (const item of parsed.data.items) {
      if (!item.text.trim()) continue // 空行不计入统计
      out.total++
      if (item.done) out.done++
      else out.open++
      if (item.done) continue
      const overdue = isOverdue(item, now)
      if (overdue) out.overdue++
      entries.push({
        docId: doc.id,
        bookId: doc.book_id,
        bookName: doc.book_name,
        docTitle: doc.title,
        item,
        overdue,
        dueToday: dueDateKey(item.due) === today,
      })
    }
  }

  entries.sort((a, b) => rank(a) - rank(b) || dueOf(a).localeCompare(dueOf(b)))
  out.entries = entries.slice(0, Math.max(0, limit))
  return out
}

function rank(e: WorkbenchTodoEntry): number {
  if (e.overdue) return 0
  if (e.dueToday) return 1
  return e.item.due ? 2 : 3
}
function dueOf(e: WorkbenchTodoEntry): string {
  return dueDateKey(e.item.due)
}

// ---------------------------------------------------------------- 甘特图

export interface GanttChartRow {
  docId: number
  bookId: number
  bookName: string
  title: string
  /** 真实任务数（不含汇总条，汇总条的进度由子任务派生，重复统计会失真） */
  tasks: number
  done: number
  overdue: number
  atRisk: number
  /** 按期长加权的平均进度 */
  progress: number
  /** 最晚的可视结束日 */
  endIso: string
}

export interface GanttAggregate {
  charts: number
  tasks: number
  done: number
  overdue: number
  atRisk: number
  /** 全部图表按期长加权的平均进度 */
  progress: number
  rows: GanttChartRow[]
}

/**
 * 聚合所有甘特图。
 *
 * 两个刻意的口径：
 *  - **排除 type='summary'**：汇总条的 progress 由子任务派生，纳入统计会双重计数；
 *  - **按期长加权**：只看平均进度会让「一个 1 天的任务」和「一个 100 天的任务」等权，
 *    与实际工期感知不符。duration=0（里程碑）按 1 天计权，避免被完全忽略。
 */
export function aggregateGantt(docs: WorkbenchDoc[], now: Date = new Date()): GanttAggregate {
  const today = toDateKey(now)
  const out: GanttAggregate = { charts: 0, tasks: 0, done: 0, overdue: 0, atRisk: 0, progress: 0, rows: [] }
  let wSum = 0
  let wProgress = 0

  for (const doc of docs) {
    const parsed = parseGanttJSON(doc.content)
    const leaves = parsed.data.tasks.filter((t) => t.type !== 'summary')
    const row: GanttChartRow = {
      docId: doc.id,
      bookId: doc.book_id,
      bookName: doc.book_name,
      title: doc.title,
      tasks: leaves.length,
      done: 0,
      overdue: 0,
      atRisk: 0,
      progress: 0,
      endIso: '',
    }
    let rowW = 0
    let rowP = 0
    for (const t of leaves) {
      const st = taskStatus(t, today)
      if (st === 'done') row.done++
      else if (st === 'overdue') row.overdue++
      else if (st === 'atrisk') row.atRisk++
      const w = weightOf(t)
      rowW += w
      rowP += clampProgress(t.progress) * w
      const end = ganttEndIso(t)
      if (end && end > row.endIso) row.endIso = end
    }
    row.progress = rowW > 0 ? Math.round(rowP / rowW) : 0
    out.charts++
    out.tasks += row.tasks
    out.done += row.done
    out.overdue += row.overdue
    out.atRisk += row.atRisk
    wSum += rowW
    wProgress += rowP
    out.rows.push(row)
  }

  out.progress = wSum > 0 ? Math.round(wProgress / wSum) : 0
  // 有超期/风险的排前面，其次工期结束得晚的
  out.rows.sort((a, b) => b.overdue + b.atRisk - (a.overdue + a.atRisk) || b.endIso.localeCompare(a.endIso))
  return out
}

function weightOf(t: Pick<GanttTaskData, 'duration'>): number {
  const d = Math.round(t.duration)
  return d > 0 ? d : 1
}
function clampProgress(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.max(0, Math.min(100, p))
}

// ---------------------------------------------------------------- 工作日历

export interface CalendarEntry {
  docId: number
  bookId: number
  bookName: string
  docTitle: string
  title: string
  dateKey: string
  timeLabel: string
  allDay: boolean
  state: TaskState
}

export interface CalendarAggregate {
  calendars: number
  /** 今天的日程（含已完成，便于回顾） */
  today: CalendarEntry[]
  /** 未来 N 天（不含今天）的日程 */
  upcoming: CalendarEntry[]
  /** 今天尚未完成的条数 */
  pendingToday: number
}

/**
 * 聚合所有工作日历的日程。
 *
 * 口径：**排除已取消**（对使用者不是待处理项，留在「今日日程」里只会造成噪音）；
 * 已完成保留，用状态色区分。全天日程排在定时日程之前（当天的「背景事项」）。
 */
export function aggregateCalendar(docs: WorkbenchDoc[], now: Date = new Date(), days = 7): CalendarAggregate {
  const today = toDateKey(now)
  const until = addDays(today, Math.max(1, days))
  const out: CalendarAggregate = { calendars: 0, today: [], upcoming: [], pendingToday: 0 }

  for (const doc of docs) {
    out.calendars++
    const parsed = parseCalendarJSON(doc.content)
    for (const t of parsed.data.tasks) {
      if (taskState(t) === 'cancelled') continue
      const key = taskDateKey(t)
      if (!key) continue
      const entry: CalendarEntry = {
        docId: doc.id,
        bookId: doc.book_id,
        bookName: doc.book_name,
        docTitle: doc.title,
        title: t.title || '未命名日程',
        dateKey: key,
        timeLabel: taskTimeLabel(t),
        allDay: isAllDay(t),
        state: taskState(t),
      }
      if (key === today) {
        out.today.push(entry)
        if (entry.state === 'pending') out.pendingToday++
      } else if (key > today && key < until) {
        out.upcoming.push(entry)
      }
    }
  }

  const cmp = (a: CalendarEntry, b: CalendarEntry) =>
    a.allDay === b.allDay ? a.timeLabel.localeCompare(b.timeLabel) : a.allDay ? -1 : 1
  out.today.sort(cmp)
  out.upcoming.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || cmp(a, b))
  return out
}

/** 今天的 ISO 日期（透出 gantt.ts 的实现，避免各卡片各自 new Date 出现跨天不一致） */
export { todayIso }
