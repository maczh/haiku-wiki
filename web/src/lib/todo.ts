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

/** 是否已逾期：有截止时间、未完成、且截止时间早于现在 */
export function isOverdue(item: TodoItem, now = new Date()): boolean {
  if (item.done || !item.due) return false
  const t = new Date(item.due.replace(/-/g, '/'))
  if (Number.isNaN(t.getTime())) return false
  return t.getTime() < now.getTime()
}
