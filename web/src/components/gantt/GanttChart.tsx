import { useCallback, useMemo, useRef, useState } from 'react'
import { Gantt, Willow } from '@svar-ui/react-gantt'
import type { IApi, IColumnConfig, IScaleConfig } from '@svar-ui/react-gantt'
import '@svar-ui/react-gantt/style.css'
import './gantt.css'
import {
  clampPriority,
  ganttFromSvar,
  ganttPriorityColor,
  ganttToSvar,
  isoDate,
  resolveSvarTask,
  GANTT_STATUS_META,
  taskStatus,
  type GanttJSON,
  type GanttSvarLink,
  type GanttSvarTask,
} from '../../lib/gantt'

/**
 * 权限模式：
 * - edit     编辑态：增删改任务、子任务、依赖、日期、进度全开
 * - progress 阅读态且有写权限：**只允许改进度**（拖条形上的进度手柄）
 * - readonly 阅读态且无写权限：完全只读
 */
export type GanttMode = 'edit' | 'progress' | 'readonly'

interface Props {
  value: GanttJSON
  mode: GanttMode
  /** 数据变更回调（已归一化为 GanttJSON，调用方负责防抖落库） */
  onChange: (next: GanttJSON) => void
  /** 拿到组件内部 api，供外层工具栏执行 add-task / delete-task 等命令 */
  onApi?: (api: IApi | null) => void
}

/** 时间刻度：月份 + 日（中文格式函数，不依赖 d3 格式串的英文月份名） */
const SCALES: IScaleConfig[] = [
  { unit: 'month', step: 1, format: (d: Date) => `${d.getFullYear()} 年 ${d.getMonth() + 1} 月` },
  { unit: 'day', step: 1, format: (d: Date) => `${d.getMonth() + 1}/${d.getDate()}` },
]

/** 状态列单元格：圆灯 + 文字（口径与后端导出一致，见 lib/gantt.ts taskStatus） */
function StatusCell({ row }: { row?: Record<string, unknown> }) {
  const t = {
    start: typeof row?.start === 'object' && row?.start instanceof Date ? isoDate(row.start) : String(row?.start ?? ''),
    duration: Number(row?.duration ?? 0),
    progress: Number(row?.progress ?? 0),
  }
  const meta = GANTT_STATUS_META[taskStatus(t)]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <span
        style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }}
        aria-hidden
      />
      <span style={{ color: '#4b5563' }}>{meta.label}</span>
    </span>
  )
}

/** 负责人列单元格：最多展示 2 个标签 + 溢出数字 */
function AssigneesCell({ row }: { row?: Record<string, unknown> }) {
  const list = Array.isArray(row?.assignees) ? (row?.assignees as unknown[]).filter((a) => typeof a === 'string' && a) : []
  if (list.length === 0) return <span style={{ color: '#c0c4cc' }}>—</span>
  const shown = list.slice(0, 2)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, flexWrap: 'nowrap', overflow: 'hidden' }}>
      {shown.map((a) => (
        <span
          key={a as string}
          style={{
            maxWidth: 72,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '0 6px',
            height: 18,
            lineHeight: '18px',
            borderRadius: 9,
            background: '#eef4ff',
            color: '#2f54eb',
          }}
        >
          {a as string}
        </span>
      ))}
      {list.length > shown.length && <span style={{ color: '#8c8c8c' }}>+{list.length - shown.length}</span>}
    </span>
  )
}

/** 优先级列单元格：数字徽章 + 同色圆点（1 浅 ~ 10 深） */
function PriorityCell({ row }: { row?: Record<string, unknown> }) {
  const p = clampPriority(row?.priority)
  const color = ganttPriorityColor(p)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <span
        style={{ width: 10, height: 10, borderRadius: '50%', background: color, border: '1px solid rgba(114,46,209,0.35)', flexShrink: 0 }}
        aria-hidden
      />
      <span style={{ color: '#4b5563' }}>P{p}</span>
    </span>
  )
}

/** 阅读态列：无编辑器、无「+」新增列 */
const READ_COLUMNS: IColumnConfig[] = [
  { id: 'text', header: '任务名称', width: 176, flexgrow: 1 },
  { id: 'assignees', header: '负责人', width: 100, align: 'left', cell: AssigneesCell },
  { id: 'status', header: '状态', width: 92, align: 'left', cell: StatusCell },
  { id: 'priority', header: '优先级', width: 74, align: 'center', cell: PriorityCell },
  { id: 'start', header: '开始日期', width: 96, align: 'center' },
  { id: 'duration', header: '工期(天)', width: 68, align: 'center' },
  { id: 'progress', header: '进度', width: 104, align: 'center', cell: ProgressCell },
]

/** 编辑态列：可内联编辑 + 行尾「+」新增按钮（负责人/描述经工具栏弹窗编辑） */
const EDIT_COLUMNS: IColumnConfig[] = [
  { id: 'text', header: '任务名称', width: 176, flexgrow: 1, editor: 'text', sort: true },
  { id: 'assignees', header: '负责人', width: 100, align: 'left', cell: AssigneesCell },
  { id: 'status', header: '状态', width: 92, align: 'left', cell: StatusCell },
  { id: 'priority', header: '优先级', width: 74, align: 'center', cell: PriorityCell, editor: 'text' },
  { id: 'start', header: '开始日期', width: 96, align: 'center', editor: 'datepicker' },
  { id: 'duration', header: '工期(天)', width: 68, align: 'center', editor: 'text' },
  { id: 'progress', header: '进度', width: 104, align: 'center', cell: ProgressCell, editor: 'text' },
  { id: 'add-task', header: '', width: 37, align: 'center' },
]

/** 进度列单元格：细进度条 + 百分比（props 是栅格 cell 的 ICellProps，这里只取 row） */
function ProgressCell({ row }: { row?: Record<string, unknown> }) {
  const raw = typeof row?.progress === 'number' ? row.progress : Number(row?.progress ?? 0)
  const p = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: 6, padding: '0 8px' }}>
      <div style={{ flex: 1, height: 6, background: '#f0f2f5', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: p >= 100 ? '#52c41a' : '#1677ff' }} />
      </div>
      <span style={{ fontSize: 12, color: '#5f6672', minWidth: 32, textAlign: 'right' }}>{p}%</span>
    </div>
  )
}

interface TipState {
  x: number
  y: number
  task: GanttSvarTask
}

/**
 * 甘特图画布（内部共用组件）。
 *
 * 数据流：外层给出初始 GanttJSON → 这里只在挂载时播种一次，之后由组件内部状态自持，
 * 每次变更通过 api.serialize() 读回并回调 onChange（否则受控回写会把组件重置、丢滚动位置）。
 * 切换文档/切换读写模式时外层用 key 强制重挂载，天然拿到最新正文。
 */
export default function GanttChart({ value, mode, onChange, onApi }: Props) {
  // 只播种一次：后续由组件内部状态自持（受控回写会导致重置与滚动跳动）
  const [seed] = useState(() => ganttToSvar(value))
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onApiRef = useRef(onApi)
  onApiRef.current = onApi
  const apiRef = useRef<IApi | null>(null)
  const tipRef = useRef<TipState | null>(null)
  const [tip, setTip] = useState<TipState | null>(null)
  tipRef.current = tip

  /** 任务 id → 优先级：驱动进度条上下「优先级外框」的样式注入（数据变更时同步刷新） */
  const [priorityMap, setPriorityMap] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    for (const t of seed.tasks) m[String(t.id)] = clampPriority(t.priority)
    return m
  })
  const priorityFrameCss = useMemo(() => {
    const esc = (id: string) => id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return Object.entries(priorityMap)
      .map(([id, p]) => {
        const c = ganttPriorityColor(p)
        const sel = `.hk-gantt .wx-bar[data-id="${esc(id)}"]`
        // ⚠️ SVAR 自己的 hover 样式用的是 CSS-Modules 哈希类（.wx-XXXX:hover），与这里特异度相同
        // 但加载更晚，会把外框整条覆盖掉（悬停时外框消失）。所以：① 显式补一条 :hover 分支提高
        // 特异度；② 再加 !important 兜底，保证优先级外框任何状态下都可见。
        return `${sel},${sel}:hover{box-shadow:0 -3px 0 0 ${c},0 3px 0 0 ${c} !important;}`
      })
      .join('\n')
  }, [priorityMap])

  const init = useCallback(
    (api: IApi) => {
      onApiRef.current?.(api)
      apiRef.current = api

      if (mode === 'progress') {
        // 阅读态（有写权限）：只放行「改进度」
        // 横向拖动（改期/改工期）与纵向拖动（重排）都走 drag-task，一律拦掉；
        // 进度手柄不走该 action，因此不受影响。
        api.intercept('drag-task', () => false)
        api.intercept('add-task', () => false)
        api.intercept('delete-task', () => false)
        api.intercept('copy-task', () => false)
        api.intercept('move-task', () => false)
        api.intercept('indent-task', () => false)
        api.intercept('split-task', () => false)
        api.intercept('add-link', () => false)
        api.intercept('update-link', () => false)
        api.intercept('delete-link', () => false)
        api.intercept('update-task', (ev) => {
          // 只放行纯进度更新；改期/改名/改类型等一律拦下
          const keys = Object.keys((ev as { task?: Record<string, unknown> })?.task ?? {})
          return keys.length > 0 && keys.every((k) => k === 'progress')
        })
      }

      const sync = () => {
        const tasks = api.serialize({ data: 'tasks' }) as GanttSvarTask[] | null
        const links = api.serialize({ data: 'links' }) as GanttSvarLink[] | null
        onChangeRef.current(ganttFromSvar(tasks ?? [], links ?? []))
        if (tasks) {
          const m: Record<string, number> = {}
          for (const t of tasks) m[String(t.id)] = clampPriority(t.priority)
          setPriorityMap(m)
        }
      }
      // 拖拽过程中会连续派发 inProgress=true 的中间态，只在最终落定时回读
      const syncIfFinal = (ev: { inProgress?: boolean }) => {
        if (ev?.inProgress) return
        sync()
      }
      for (const action of ['add-task', 'delete-task', 'move-task', 'copy-task', 'indent-task', 'split-task', 'add-link', 'update-link', 'delete-link']) {
        api.on(action, sync)
      }
      api.on('update-task', syncIfFinal)
    },
    [mode],
  )

  /** 悬停任务条 → 描述/负责人气泡（无附加信息不打扰；同一条内移动不重置） */
  const onBarHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement
    const bar = el.closest?.('.wx-bar') as HTMLElement | null
    const related = (e as unknown as { relatedTarget?: EventTarget | null }).relatedTarget as HTMLElement | null
    if (bar && related?.closest?.('.wx-bar') === bar && tipRef.current) return
    if (!bar || bar.classList.contains('wx-summary')) {
      setTip(null)
      return
    }
    const id = bar.getAttribute('data-id')
    const api = apiRef.current
    if (!id || !api) {
      setTip(null)
      return
    }
    // data-id 是字符串，store 里存的是数字 id，必须走兼容解析
    const task = resolveSvarTask(api, id)
    const details = typeof task?.details === 'string' ? task.details.trim() : ''
    const assignees = Array.isArray(task?.assignees) ? (task!.assignees as unknown[]).filter((a) => typeof a === 'string' && a) : []
    if (!details && assignees.length === 0) {
      setTip(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTip({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 16, task: task! })
  }, [])

  return (
    <div className={`hk-gantt${mode === 'progress' ? ' hk-gantt-progress' : ''}`}>
      {priorityFrameCss && <style>{priorityFrameCss}</style>}
      <div style={{ position: 'relative', height: '100%' }} onMouseOver={onBarHover} onMouseOut={() => setTip(null)}>
        <Willow>
          <Gantt
            tasks={seed.tasks}
            links={seed.links}
            columns={mode === 'edit' ? EDIT_COLUMNS : READ_COLUMNS}
            scales={SCALES}
            readonly={mode === 'readonly'}
            zoom
            cellHeight={34}
            cellWidth={36}
            init={init}
          />
        </Willow>
        {tip && (
          <div
            className="hk-gantt-tip"
            style={{ left: tip.x, top: tip.y }}
            onMouseOver={(e) => e.stopPropagation()}
          >
            <div className="hk-gantt-tip-title">
              {String(tip.task.text ?? '')}
              {typeof tip.task.progress === 'number' ? (
                <span style={{ fontWeight: 400, color: '#8c8c8c', marginLeft: 8 }}>{Math.round(tip.task.progress)}%</span>
              ) : null}
            </div>
            {(tip.task.assignees as unknown[] | undefined)?.length ? (
              <div className="hk-gantt-tip-row">
                <span className="hk-gantt-tip-label">负责人</span>
                <span>{(tip.task.assignees as string[]).join('、')}</span>
              </div>
            ) : null}
            <div className="hk-gantt-tip-row">
              <span className="hk-gantt-tip-label">时间</span>
              <span>
                {(() => {
                  const s = tip.task.start instanceof Date ? isoDate(tip.task.start) : ''
                  const d = Number(tip.task.duration ?? 0)
                  if (!s) return '—'
                  return d > 0 ? `${s} 起 · ${d} 天` : `${s} · 里程碑`
                })()}
              </span>
            </div>
            {typeof tip.task.details === 'string' && tip.task.details.trim() !== '' && (
              <div className="hk-gantt-tip-row">
                <span className="hk-gantt-tip-label">描述</span>
                <span className="hk-gantt-tip-desc">{tip.task.details}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
