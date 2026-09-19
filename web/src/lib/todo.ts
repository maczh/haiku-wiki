// 待办清单内容契约 v1 —— 与后端 exportx.BuildTodoXLSX / BuildTodoMD 的读取字段一致：
// {"version":1,"items":[{"id","text","done","due","priority","note"}]}
//
// 为什么用 JSON 而不是 Markdown 复选清单：待办项需要「截止时间 / 优先级 / 备注」这些
// 结构化字段，还要能原样导出成 Excel 的列；Markdown 表达不了，也解析不回来。

export type TodoPriority = 'high' | 'medium' | 'low'

export interface TodoItem {
  id: string
  text: string
  done: boolean
  /** 截止时间：YYYY-MM-DD 或 YYYY-MM-DD HH:mm（空字符串表示未设置） */
  due: string
  priority: TodoPriority | ''
  note: string
}

export interface TodoJSON {
  version: 1
  items: TodoItem[]
}

/** 优先级展示文案与配色（顺序即下拉顺序） */
export const PRIORITY_OPTIONS: { value: TodoPriority; label: string; color: string }[] = [
  { value: 'high', label: '高', color: '#cf1322' },
  { value: 'medium', label: '中', color: '#d46b08' },
  { value: 'low', label: '低', color: '#389e0d' },
]

export function priorityMeta(p: string) {
  return PRIORITY_OPTIONS.find((x) => x.value === p)
}

/** 生成待办项 ID（仅需文档内唯一，不参与服务端主键） */
export function newTodoId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function emptyItem(text = ''): TodoItem {
  return { id: newTodoId(), text, done: false, due: '', priority: '', note: '' }
}

/** 文档默认内容：一条空待办，打开即可输入 */
export function defaultTodoJSON(): TodoJSON {
  return { version: 1, items: [emptyItem()] }
}

/** 宽容解析：字段缺失/类型不对都不应让整个文档打不开。 */
export function parseTodoJSON(content: string): { data: TodoJSON; reset: boolean } {
  if (content && content.trim() !== '') {
    try {
      const raw = JSON.parse(content) as { version?: unknown; items?: unknown }
      if (Array.isArray(raw.items)) {
        const items: TodoItem[] = raw.items.map((it) => {
          const o = (it ?? {}) as Record<string, unknown>
          const priority = typeof o.priority === 'string' ? o.priority : ''
          return {
            id: typeof o.id === 'string' && o.id ? o.id : newTodoId(),
            text: typeof o.text === 'string' ? o.text : '',
            done: o.done === true,
            due: typeof o.due === 'string' ? o.due : '',
            priority: (['high', 'medium', 'low'] as string[]).includes(priority)
              ? (priority as TodoPriority)
              : '',
            note: typeof o.note === 'string' ? o.note : '',
          }
        })
        return { data: { version: 1, items }, reset: false }
      }
    } catch {
      /* 落到默认值 */
    }
  }
  return { data: defaultTodoJSON(), reset: !!content && content.trim() !== '' }
}

export function stringifyTodo(data: TodoJSON): string {
  return JSON.stringify({ version: 1, items: data.items })
}

/** 完成进度（用于界面统计） */
export function todoProgress(items: TodoItem[]): { done: number; total: number; percent: number } {
  const total = items.length
  const done = items.filter((x) => x.done).length
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

/**
 * 把待办的截止串解析成**逾期的起始时刻**。
 *
 * 关键语义：**只填日期的截止项，逾期从「当天结束」开始计时**，而不是当天 00:00 ——
 * 「今天到期」是「还没到期」，不是「已逾期」。历史实现直接把 `'2026-09-19'` 交给
 * `new Date` 得到当天 00:00，于是当天一过零点就判逾期：工作台的「已逾期」计数会多算，
 * 行内标签也会把「今天到期」显示成「已逾期」。
 *
 * 带具体时间的截止项（`YYYY-MM-DD HH:mm`，含 datetime-local 的 `T` 分隔）按精确时刻比较。
 * 解析不出返回 null（调用方按「未逾期」处理）。
 */
function overdueFrom(due: string): Date | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(due.trim())
  if (!m) return null
  const hasTime = m[4] !== undefined
  const t = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    hasTime ? Number(m[4]) : 23,
    hasTime ? Number(m[5]) : 59,
    hasTime ? 0 : 59,
    hasTime ? 0 : 999,
  )
  return Number.isNaN(t.getTime()) ? null : t
}

/** 是否已逾期：有截止时间、未完成、且已越过截止时刻（只填日期则当天整日都不算逾期）。 */
export function isOverdue(item: TodoItem, now = new Date()): boolean {
  if (item.done || !item.due) return false
  const t = overdueFrom(item.due)
  return t !== null && t.getTime() < now.getTime()
}
