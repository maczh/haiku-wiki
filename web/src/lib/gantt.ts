// 甘特图文档（doc_type=gantt）正文契约 v1。
//
//   content = JSON.stringify({ version: 1, tasks: [...], links: [...] })
//
// 后端只当普通文本存（docs.content 是 longtext），所有结构由前端解释；
// 这里同时负责与 SVAR Gantt 的 ITask/ILink 互转（web/src/components/gantt/GanttChart.tsx）。
//
// 日期语义（易错点）：SVAR 的 end 是**开区间**（end = start + duration 天），
// 直接存 end 会让界面上的「结束日期」比用户直觉多一天。因此这里只存 start + duration，
// end 在渲染时按 `start + duration` 推导，避免歧义。里程碑固定 duration = 0。

/** 任务/依赖的标识：SVAR 新建任务时可能给出字符串型临时 id，故两者都接受 */
export type GanttId = number | string

export type GanttTaskType = 'task' | 'summary' | 'milestone'

/** 依赖类型：e2s 完成-开始（默认）/ s2s 开始-开始 / e2e 完成-完成 / s2e 开始-完成 */
export type GanttLinkType = 'e2s' | 's2s' | 'e2e' | 's2e'

export interface GanttTaskData {
  id: GanttId
  text: string
  /** 开始日期 YYYY-MM-DD（本地墙上时间，不带时区） */
  start: string
  /** 工期（天）；里程碑为 0 */
  duration: number
  /** 进度 0~100 */
  progress: number
  type: GanttTaskType
  /** 父任务 id；0 或省略表示顶层。子任务即 parent 指向父任务 id */
  parent?: GanttId
  /** 负责人（多选，存昵称/姓名字符串，允许自由输入） */
  assignees?: string[]
  /** 优先级 1~10，越大越紧急（缺省 5） */
  priority?: number
  /** 备注 */
  details?: string
}

export interface GanttLinkData {
  id: GanttId
  source: GanttId
  target: GanttId
  type: GanttLinkType
  /** 延隔（天） */
  lag?: number
}

export interface GanttJSON {
  version: 1
  tasks: GanttTaskData[]
  links: GanttLinkData[]
}

export const GANTT_VERSION = 1

const MS_PER_DAY = 86400000
const LINK_TYPES: GanttLinkType[] = ['e2s', 's2s', 'e2e', 's2e']

/** Date → YYYY-MM-DD（按本地时区，不用 toISOString，避免 UTC 偏移） */
export function isoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** YYYY-MM-DD → Date（本地零点）；非法输入返回 null */
export function parseIsoDate(s: unknown): Date | null {
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : s
  if (typeof s !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** YYYY-MM-DD 加减天数 */
export function addDays(iso: string, n: number): string {
  const d = parseIsoDate(iso) ?? new Date()
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

export function todayIso(): string {
  return isoDate(new Date())
}

export function clampProgress(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n)))
}

/** 优先级钳制到 1~10；非法输入回落 5 */
export function clampPriority(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 5
  return Math.min(10, Math.max(1, Math.round(n)))
}

/**
 * 优先级 → 进度条上下外框颜色（紫罗兰色系，半透明，优先级越高越深越显眼）。
 * alpha 从 0.16（p=1）线性到 0.72（p=10）。
 */
export function ganttPriorityColor(p: number): string {
  const c = clampPriority(p)
  const alpha = 0.16 + ((c - 1) / 9) * 0.56
  return `rgba(114, 46, 209, ${alpha.toFixed(2)})`
}

function normalizeId(v: unknown, fallback: GanttId): GanttId {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v !== '') return v
  return fallback
}

/** 「纯数字」判定：有限数字，或纯数字字符串；`temp://…` 之类一律不算 */
function asNumericId(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim())
  return null
}

/**
 * 把 SVAR 的临时 id 稳定成数字 id —— **落库前必须做**，否则临时 id 会被持久化。
 *
 * 背景：`api.exec('add-task', { task })` 我们没有给 id，SVAR 会自己补一个
 * `temp://<毫秒时间戳>` 形式的临时 id，并在 `api.serialize()` 里原样交回。
 * 直接落库的后果（2026-09-19 探针实测）：
 *   · 正文里变成「数字 id 与临时 id 混存」，任何 `Number(id)` 的快速路径都会落空；
 *   · 这类 id 在 DOM 上被渲染成 `:temp://…`（多一个 `:` 前缀），
 *     凡是按 id 拼的 CSS 选择器（优先级外框）都会静默失配。
 *
 * 规则（**必须是纯函数**：同一份输入永远给出同一结果，否则同一会话里的多次自动保存
 * 会让同一个任务反复拿到不同 id）：
 *   · 纯数字 id 原样保留；
 *   · 其余 id 按「在数组中的出现顺序」依次分配 `max(数字 id) + 1、+2、…`（跳过已占用）。
 * 返回「原始 id 字符串 → 数字 id」的映射，调用方用它同步改写 parent / links 的引用。
 */
function stabilizeIds(list: { id?: unknown }[]): Map<string, number> {
  const used = new Set<number>()
  let max = 0
  for (const it of list) {
    const n = asNumericId(it?.id)
    if (n == null) continue
    used.add(n)
    if (n > max) max = n
  }
  const map = new Map<string, number>()
  for (const it of list) {
    const raw = it?.id
    if (raw == null || raw === '') continue
    const key = String(raw)
    if (map.has(key)) continue
    const n = asNumericId(raw)
    if (n != null) {
      map.set(key, n)
      continue
    }
    let assigned = max + 1
    while (used.has(assigned)) assigned++
    used.add(assigned)
    max = assigned
    map.set(key, assigned)
  }
  return map
}

/**
 * id → DOM 上 `.wx-bar[data-id]` 的候选形态。
 *
 * ⚠️ 实测：SVAR 渲染时给**非纯数字**的 id 加了 `:` 前缀（`temp://1789821459269` 在 DOM 上是
 * `:temp://1789821459269`），数字 id 原样输出。所以按 id 拼选择器注入样式时，
 * 非数字 id 必须把两种形态都写上 —— 匹配不上的那条无害，猜错规则却会让样式静默消失。
 */
export function svarDataIdCandidates(id: GanttId): string[] {
  const s = String(id)
  return /^\d+$/.test(s) ? [s] : [s, `:${s}`]
}

/** 新建文档时的初始内容：给一个最小的层级示例，避免空图无从下手 */
export function defaultGanttJSON(): GanttJSON {
  const start = todayIso()
  return {
    version: GANTT_VERSION as 1,
    tasks: [
      { id: 1, text: '项目启动', type: 'summary', start, duration: 7, progress: 0 },
      { id: 2, text: '需求调研', type: 'task', parent: 1, start, duration: 3, progress: 0 },
      { id: 3, text: '方案设计', type: 'task', parent: 1, start: addDays(start, 3), duration: 4, progress: 0 },
    ],
    links: [],
  }
}

/** 空图（无任务） */
export function emptyGanttJSON(): GanttJSON {
  return { version: GANTT_VERSION as 1, tasks: [], links: [] }
}

export function stringifyGantt(data: GanttJSON): string {
  return JSON.stringify(data)
}

/**
 * 宽容解析：字段缺失或类型不对不应让文档打不开。
 * reset=true 表示内容无法识别、已回退为空白图（调用方会给一次提示）。
 */
export function parseGanttJSON(content: string): { data: GanttJSON; reset: boolean } {
  const fallback = { data: emptyGanttJSON(), reset: true }
  if (!content || content.trim() === '') return { data: emptyGanttJSON(), reset: false }
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return fallback
  }
  if (!raw || typeof raw !== 'object') return fallback
  const obj = raw as { version?: unknown; tasks?: unknown; links?: unknown }
  if (!Array.isArray(obj.tasks)) return fallback

  const seen = new Set<string>()
  const tasks: GanttTaskData[] = []
  obj.tasks.forEach((t, i) => {
    if (!t || typeof t !== 'object') return
    const item = t as Record<string, unknown>
    const id = normalizeId(item.id, i + 1)
    const key = String(id)
    if (seen.has(key)) return
    seen.add(key)
    const type: GanttTaskType =
      item.type === 'summary' || item.type === 'milestone' ? item.type : 'task'
    let duration = typeof item.duration === 'number' ? Math.round(item.duration) : Number(item.duration)
    if (!Number.isFinite(duration) || duration < 0) duration = 1
    tasks.push({
      id,
      text: typeof item.text === 'string' ? item.text : '',
      start: parseIsoDate(item.start) ? isoDate(parseIsoDate(item.start)!) : todayIso(),
      duration: type === 'milestone' ? 0 : duration,
      progress: clampProgress(item.progress),
      type,
      parent: item.parent === undefined || item.parent === null || item.parent === 0 ? 0 : normalizeId(item.parent, 0),
      assignees: Array.isArray(item.assignees)
        ? item.assignees.filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim())
        : [],
      priority: clampPriority(item.priority),
      details: typeof item.details === 'string' ? item.details : '',
    })
  })

  const links: GanttLinkData[] = []
  if (Array.isArray(obj.links)) {
    obj.links.forEach((l, i) => {
      if (!l || typeof l !== 'object') return
      const item = l as Record<string, unknown>
      if (item.source === undefined || item.target === undefined) return
      const type = LINK_TYPES.includes(item.type as GanttLinkType) ? (item.type as GanttLinkType) : 'e2s'
      links.push({
        id: normalizeId(item.id, i + 1),
        source: normalizeId(item.source, 0),
        target: normalizeId(item.target, 0),
        type,
        lag: typeof item.lag === 'number' ? item.lag : 0,
      })
    })
  }

  return { data: { version: GANTT_VERSION as 1, tasks, links }, reset: false }
}

/**
 * 编辑器/阅读器入口：空正文（新建文档尚未落库）时给一份带层级示例的初始图，
 * 否则按内容解析。注意「任务被删空」的正文不是空串，不会被重新播种。
 */
export function ganttFromContent(content: string): { data: GanttJSON; reset: boolean } {
  if (!content || content.trim() === '') return { data: defaultGanttJSON(), reset: false }
  return parseGanttJSON(content)
}

/* ------------------------------------------------------------------ *
 * 与 SVAR Gantt 的互转
 *
 * 只声明用到的字段，避免 lib 层对组件库产生运行时依赖（这里全部是类型/结构约定）。
 * ------------------------------------------------------------------ */

/** 喂给 <Gantt tasks=... /> 的任务形态（ITask 的子集） */
export interface GanttSvarTask {
  id: GanttId
  text: string
  start?: Date
  end?: Date
  duration?: number
  progress?: number
  type?: string
  parent?: GanttId
  details?: string
  open?: boolean
  [key: string]: unknown
}

export interface GanttSvarLink {
  id: GanttId
  source: GanttId
  target: GanttId
  type: GanttLinkType
  lag?: number
}

/* ------------------------------------------------------------------ *
 * 任务状态（圆灯）
 *
 * 与后端 exportx/gantt.go 的 ganttTaskStatus 保持同一套规则，两边都要改：
 *   已超期(红)   progress < 100 且今天已越过结束日（end = start + duration 的开区间，可视结束日 = start+duration-1）
 *   进度拖延(黄) 进度落后于时间进度 15 个百分点以上，或 3 天内到期但进度 < 100
 *   已结束(灰)   progress >= 100
 *   未开始(蓝)   progress = 0 且尚未到开始日
 *   正常(绿)     其余
 * ------------------------------------------------------------------ */

export type GanttStatus = 'overdue' | 'atrisk' | 'done' | 'notstarted' | 'normal'

export const GANTT_STATUS_META: Record<GanttStatus, { label: string; color: string }> = {
  overdue: { label: '已超期', color: '#f5222d' },
  atrisk: { label: '进度拖延', color: '#faad14' },
  done: { label: '已结束', color: '#8c8c8c' },
  notstarted: { label: '未开始', color: '#1677ff' },
  normal: { label: '正常进行中', color: '#52c41a' },
}

/** 可视结束日（含首尾）：start + duration - 1 天；里程碑/0 工期即开始日当天 */
export function ganttEndIso(t: Pick<GanttTaskData, 'start' | 'duration'>): string {
  return addDays(t.start, Math.max(0, Math.round(t.duration)) - 1)
}

/** 与后端 ganttTaskStatus 对齐的状态推导（today 传 YYYY-MM-DD 便于测试） */
export function taskStatus(
  t: Pick<GanttTaskData, 'start' | 'duration' | 'progress'>,
  today: string = todayIso(),
): GanttStatus {
  const progress = clampProgress(t.progress)
  if (progress >= 100) return 'done'

  const start = parseIsoDate(t.start)
  const end = parseIsoDate(ganttEndIso(t))
  const now = parseIsoDate(today)
  if (!start || !end || !now) return 'normal'

  if (now.getTime() > end.getTime()) return 'overdue'
  if (now.getTime() < start.getTime()) return progress === 0 ? 'notstarted' : 'normal'

  // 时间进度期望：已过天数 / 总天数（总天数按可视含首尾口径，至少 1 天）
  const total = Math.max(1, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1)
  const elapsed = Math.max(0, Math.round((now.getTime() - start.getTime()) / MS_PER_DAY) + 1)
  const expected = (elapsed / total) * 100
  const daysLeft = Math.round((end.getTime() - now.getTime()) / MS_PER_DAY)
  if (progress + 15 <= expected || (daysLeft <= 3 && progress < 100)) return 'atrisk'
  return 'normal'
}

/** 契约数据 → SVAR 渲染数据 */
export function ganttToSvar(data: GanttJSON): { tasks: GanttSvarTask[]; links: GanttSvarLink[] } {
  const hasChild = new Set<GanttId>()
  for (const t of data.tasks) {
    if (t.parent) hasChild.add(t.parent)
  }

  const tasks: GanttSvarTask[] = data.tasks.map((t) => {
    const start = parseIsoDate(t.start) ?? parseIsoDate(todayIso())!
    const isMilestone = t.type === 'milestone'
    const duration = isMilestone ? 0 : Math.max(1, Math.round(t.duration) || 1)
    const out: GanttSvarTask = {
      id: t.id,
      text: t.text,
      progress: clampProgress(t.progress),
      type: t.type,
      parent: t.parent ?? 0,
      // ⚠️ 只能给「有子任务」的节点写 open:true —— SVAR 内部 toArray() 遇到
      // open===true 且 data===null（叶子节点被 parse 置空）会直接抛
      // "Cannot read properties of null (reading 'forEach')"，整图白屏。
      open: hasChild.has(t.id) ? true : undefined,
    }
    // 有子任务的 summary 交给组件按子节点推导日期，避免存了过期值后父条与子条对不上
    if (!(t.type === 'summary' && hasChild.has(t.id))) {
      out.start = start
      out.duration = duration
      if (!isMilestone) out.end = new Date(start.getTime() + duration * MS_PER_DAY)
    }
    if (t.details) out.details = t.details
    if (t.assignees?.length) out.assignees = t.assignees
    out.priority = clampPriority(t.priority)
    return out
  })

  const links: GanttSvarLink[] = data.links.map((l) => ({
    id: l.id,
    source: l.source,
    target: l.target,
    type: LINK_TYPES.includes(l.type) ? l.type : 'e2s',
    lag: l.lag ?? 0,
  }))

  return { tasks, links }
}

/**
 * 按 id 取任务（兼容 id 的「数字 / 字符串」两种形态）。
 *
 * ⚠️ SVAR 内部 `tree.byId()` 走的是 `Map.get(id)`，键的类型必须与写入时**完全一致**：
 * 我们播种的任务 id 是数字（1、2、3…），而 DOM 上 `data-id` 读回来永远是字符串。
 * 直接 `api.getTask('1')` 会拿到 undefined（悬停气泡因此永远不显示），必须两种都试一遍。
 */
export function resolveSvarTask(
  api: { getTask(id: string | number): unknown } | null | undefined,
  id: string | number | null | undefined,
): GanttSvarTask | null {
  if (!api || id == null) return null
  const tryGet = (key: string | number): GanttSvarTask | null => {
    try {
      const t = api.getTask(key) as GanttSvarTask | undefined | null
      return t ?? null
    } catch {
      return null
    }
  }
  const direct = tryGet(id)
  if (direct) return direct
  if (typeof id === 'string') {
    const n = Number(id)
    // 只接受「纯数字字符串」的回退；'temp://123' 之类不做转换
    if (Number.isFinite(n) && String(n) === id.trim()) return tryGet(n)
    return null
  }
  return tryGet(String(id))
}

/**
 * SVAR 状态 → 契约数据。
 * 入参是 api.serialize() 的结果：已按树的先序展开成扁平数组，但每项仍挂着 data 子树，
 * 这里按 id 去重后只取需要落库的字段（子结构丢弃，parent 已经表达了层级）。
 *
 * 落库前会把 SVAR 的临时 id（`temp://…`）稳定成数字 id（见 stabilizeIds），
 * 并同步改写 parent 与 links 的 source/target —— 这是唯一一处「id 归一化出口」，
 * 别在调用方再补一遍。
 */
export function ganttFromSvar(rawTasks: unknown, rawLinks: unknown): GanttJSON {
  const list = Array.isArray(rawTasks) ? (rawTasks as GanttSvarTask[]) : []
  const seen = new Set<string>()
  const tasks: GanttTaskData[] = []
  // 临时 id（SVAR 的 `temp://…`）在这里一次性稳定成数字 id，parent / links 同步改写
  const idMap = stabilizeIds(list)
  /** 把任意 id 引用映射到稳定后的 id；缺失或映射不中时退回 $2 */
  const mapId = (v: unknown, fallback: GanttId): GanttId => {
    if (v == null || v === '') return fallback
    return idMap.get(String(v)) ?? fallback
  }

  for (const t of list) {
    if (!t || typeof t !== 'object') continue
    // 去重按「原始 id」：id 缺失时用位置占位，避免多个缺 id 的项被误判成同一个
    const key = t.id == null || t.id === '' ? `#${tasks.length + 1}` : String(t.id)
    if (seen.has(key)) continue
    seen.add(key)
    const id = mapId(t.id, tasks.length + 1)

    const type: GanttTaskType =
      t.type === 'summary' || t.type === 'milestone' ? t.type : 'task'
    const start = parseIsoDate(t.start) ?? null
    let duration = typeof t.duration === 'number' ? Math.round(t.duration) : NaN
    if (!Number.isFinite(duration) || duration < 0) {
      duration = start && t.end instanceof Date ? Math.max(1, Math.round((t.end.getTime() - start.getTime()) / MS_PER_DAY)) : 1
    }
    tasks.push({
      id,
      text: typeof t.text === 'string' ? t.text : '',
      start: start ? isoDate(start) : todayIso(),
      duration: type === 'milestone' ? 0 : duration,
      progress: clampProgress(t.progress),
      type,
      parent: t.parent ? mapId(t.parent, 0) : 0,
      assignees: Array.isArray(t.assignees)
        ? (t.assignees as unknown[]).filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim())
        : [],
      priority: clampPriority(t.priority),
      details: typeof t.details === 'string' ? t.details : '',
    })
  }

  const rawLinkList = Array.isArray(rawLinks) ? (rawLinks as GanttSvarLink[]) : []
  const links: GanttLinkData[] = []
  // 依赖自身的 id 也要稳定化（新增依赖时同样是临时 id），source/target 走任务那张映射表
  const linkIdMap = stabilizeIds(rawLinkList)
  for (const l of rawLinkList) {
    if (!l || typeof l !== 'object') continue
    if (l.source === undefined || l.target === undefined) continue
    links.push({
      id: linkIdMap.get(String(l.id)) ?? normalizeId(l.id, links.length + 1),
      source: mapId(l.source, 0),
      target: mapId(l.target, 0),
      type: LINK_TYPES.includes(l.type as GanttLinkType) ? (l.type as GanttLinkType) : 'e2s',
      lag: typeof l.lag === 'number' ? l.lag : 0,
    })
  }

  return { version: GANTT_VERSION as 1, tasks, links }
}
