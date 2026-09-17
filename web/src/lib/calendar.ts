// 工作日历内容契约 v1 —— 与后端 exportx.BuildCalendarXLSX / BuildCalendarICS 的读取字段一致：
// {"version":1,"tasks":[{"id","title","start","end","done","cancelled","note"}]}
//
// start/end 统一存「本地墙上时间」字符串（YYYY-MM-DD HH:mm），不带时区：
// 日程记录的是用户所在时区的实际时间，存 UTC 反而会在跨时区打开时整体偏移。
// 只填日期（YYYY-MM-DD）表示当天全天，界面按全天处理。

export interface CalendarTask {
  id: string
  title: string
  /** 开始时间 YYYY-MM-DD HH:mm（或 YYYY-MM-DD 表示全天） */
  start: string
  /** 结束时间；空表示按 1 小时（全天则按当天）处理 */
  end: string
  done: boolean
  cancelled: boolean
  note: string
}

export interface CalendarJSON {
  version: 1
  tasks: CalendarTask[]
}

export function newTaskId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** 任务状态（用于界面配色与徽标） */
export type TaskState = 'done' | 'cancelled' | 'pending'

export function taskState(t: CalendarTask): TaskState {
  if (t.cancelled) return 'cancelled'
  if (t.done) return 'done'
  return 'pending'
}

export const TASK_STATE_LABEL: Record<TaskState, string> = {
  done: '已完成',
  cancelled: '已取消',
  pending: '待办',
}

export const TASK_STATE_COLOR: Record<TaskState, string> = {
  done: '#389e0d',
  cancelled: '#8c8c8c',
  pending: '#1677ff',
}

/** 默认内容：空日程表（打开后由用户点日期添加） */
export function defaultCalendarJSON(): CalendarJSON {
  return { version: 1, tasks: [] }
}

/** 宽容解析：字段缺失/类型不对不应让文档打不开。 */
export function parseCalendarJSON(content: string): { data: CalendarJSON; reset: boolean } {
  if (content && content.trim() !== '') {
    try {
      const raw = JSON.parse(content) as { version?: unknown; tasks?: unknown }
      if (Array.isArray(raw.tasks)) {
        const tasks: CalendarTask[] = raw.tasks.map((it) => {
          const o = (it ?? {}) as Record<string, unknown>
          return {
            id: typeof o.id === 'string' && o.id ? o.id : newTaskId(),
            title: typeof o.title === 'string' ? o.title : '',
            start: typeof o.start === 'string' ? o.start : '',
            end: typeof o.end === 'string' ? o.end : '',
            done: o.done === true,
            cancelled: o.cancelled === true,
            note: typeof o.note === 'string' ? o.note : '',
          }
        })
        return { data: { version: 1, tasks }, reset: false }
      }
    } catch {
      /* 落到默认值 */
    }
  }
  return { data: defaultCalendarJSON(), reset: !!content && content.trim() !== '' }
}

export function stringifyCalendar(data: CalendarJSON): string {
  return JSON.stringify({ version: 1, tasks: data.tasks })
}

// ---------- 日期工具（不引额外依赖，日粒度足够） ----------

/** Date → 'YYYY-MM-DD' */
export function toDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Date → 'YYYY-MM-DD HH:mm' */
export function toDateTimeKey(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${toDateKey(d)} ${hh}:${mm}`
}

/** 任务对应的「日」键（用于在月历里归位）；解析失败返回空串 */
export function taskDateKey(t: CalendarTask): string {
  const s = (t.start || '').trim()
  if (!s) return ''
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s)
  if (!m) return ''
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** 是否为「全天」任务（只给了日期，没有时间部分） */
export function isAllDay(t: CalendarTask): boolean {
  const s = (t.start || '').trim()
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)
}

/** 取时间里的 HH:mm；全天返回空串 */
export function taskTimeLabel(t: CalendarTask): string {
  const s = (t.start || '').trim()
  const m = /[T ](\d{1,2}):(\d{2})/.exec(s)
  if (!m) return ''
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/** 构造某月日历网格所需的 42 天（6 周，含上下月补位），周一为每周首日 */
export function monthGrid(year: number, month0: number): { date: Date; inMonth: boolean }[] {
  const first = new Date(year, month0, 1)
  // JS getDay(): 0=周日；转成「周一=0」的偏移
  const offset = (first.getDay() + 6) % 7
  const cells: { date: Date; inMonth: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month0, 1 - offset + i)
    cells.push({ date: d, inMonth: d.getMonth() === month0 })
  }
  return cells
}

/** 把任务按「日」分组，便于月历渲染 */
export function groupByDate(tasks: CalendarTask[]): Map<string, CalendarTask[]> {
  const map = new Map<string, CalendarTask[]>()
  for (const t of tasks) {
    const key = taskDateKey(t)
    if (!key) continue
    const list = map.get(key)
    if (list) list.push(t)
    else map.set(key, [t])
  }
  return map
}
