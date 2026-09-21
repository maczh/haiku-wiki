import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  svarDataIdCandidates,
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
      {/* nowrap：最长的状态文案是「正常进行中」（5 个汉字），窄列下换行会把行高撑成两行 */}
      <span style={{ color: '#4b5563', whiteSpace: 'nowrap' }}>{meta.label}</span>
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
  { id: 'text', header: '任务名称', width: 176 },
  { id: 'assignees', header: '负责人', width: 100, align: 'left', cell: AssigneesCell },
  { id: 'status', header: '状态', width: 108, align: 'left', cell: StatusCell },
  { id: 'priority', header: '优先级', width: 74, align: 'center', cell: PriorityCell },
  { id: 'start', header: '开始日期', width: 96, align: 'center' },
  { id: 'duration', header: '工期(天)', width: 68, align: 'center' },
  { id: 'progress', header: '进度', width: 104, align: 'center', cell: ProgressCell },
]

/** 编辑态列：可内联编辑 + 行尾「+」新增按钮（负责人/描述经工具栏弹窗编辑） */
const EDIT_COLUMNS: IColumnConfig[] = [
  { id: 'text', header: '任务名称', width: 176, editor: 'text', sort: true },
  { id: 'assignees', header: '负责人', width: 100, align: 'left', cell: AssigneesCell },
  { id: 'status', header: '状态', width: 108, align: 'left', cell: StatusCell },
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

/** 面板显示模式：SVAR 原生 displayMode，见组件内 fold 状态注释 */
type FoldMode = 'all' | 'grid' | 'chart'

/**
 * 甘特画布本体（memo 包裹）。
 * 悬停气泡的 setTip 由外层容器在 onMouseMove 里频繁触发，若甘特本体也跟着重渲染，
 * 大图表下会明显卡顿。这里把 Willow+Gantt 抽成 memo 组件，props（seed / mode / init）都稳定，
 * 因此 tip 变化不会引发甘特重渲染，只重渲染外层那一层（含气泡）。
 */
type GanttSeed = ReturnType<typeof ganttToSvar>
const GanttBody = memo(function GanttBody({
  seed,
  mode,
  init,
}: {
  seed: GanttSeed
  mode: GanttMode
  init: (api: IApi) => void
}) {
  return (
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
  )
})

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
  const [tip, setTip] = useState<TipState | null>(null)
  // 当前悬停的 bar id（同一条内移动只更新位置、不重算任务，避免抖动）
  const tipBarRef = useRef<string | null>(null)
  // 根容器（.hk-gantt）与气泡定位内层容器（position:relative）的 ref：
  // 悬停监听挂在 document 捕获阶段，需要这两个节点做「矩形命中测试」与「气泡坐标基准」
  const rootRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  /**
   * 左表格 / 右时间轴 折叠状态。
   *
   * ⚠️ 必须走 SVAR 原生的 displayMode，**不能**用 CSS 把面板 display:none 藏起来：
   * 左侧表格的行并不是自己虚拟化的，而是「按右侧时间轴的可见区切片」渲染的
   * （组件内部 `tasks.slice(area.start, area.end)`，area 由时间轴测量得到）。
   * 一旦把时间轴 display:none，测量高度变 0 → area 收缩 → 左表格只剩 2 行
   * （实测 12 行 → 2 行）。改用 displayMode 后，被折叠的面板是被压成 0 宽/0 高
   * 但仍参与布局与测量，行数据完整。
   *   all   = 左右并排
   *   grid  = 隐藏右侧时间轴（左表格铺满）
   *   chart = 隐藏左侧表格（时间轴铺满）
   */
  const [fold, setFold] = useState<FoldMode>('all')
  const leftCollapsed = fold === 'chart'
  const rightCollapsed = fold === 'grid'

  /** 任务 id → 优先级：驱动进度条上下「优先级外框」的样式注入（数据变更时同步刷新） */
  const [priorityMap, setPriorityMap] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    for (const t of seed.tasks) m[String(t.id)] = clampPriority(t.priority)
    return m
  })
  const priorityFrameCss = useMemo(() => {
    const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return Object.entries(priorityMap)
      .map(([id, p]) => {
        const c = ganttPriorityColor(p)
        // ⚠️ 选择器要用 DOM 上 data-id 的**实际形态**：SVAR 给非纯数字 id 加了 `:` 前缀
        // （`temp://x` → `:temp://x`）。直接拿序列化回来的 id 拼选择器，新增任务的
        // 优先级外框会静默失配（实测 computedStyle.boxShadow === 'none'）。
        const parts = svarDataIdCandidates(id).map((v) => `.hk-gantt .wx-bar[data-id="${esc(v)}"]`)
        // ⚠️ SVAR 自己的 hover 样式用的是 CSS-Modules 哈希类（.wx-XXXX:hover），与这里特异度相同
        // 但加载更晚，会把外框整条覆盖掉（悬停时外框消失）。所以：① 显式补一条 :hover 分支提高
        // 特异度；② 再加 !important 兜底，保证优先级外框任何状态下都可见。
        const all = parts.flatMap((sel) => [sel, `${sel}:hover`])
        return `${all.join(',')}{box-shadow:0 -3px 0 0 ${c},0 3px 0 0 ${c} !important;}`
      })
      .join('\n')
  }, [priorityMap])

  const init = useCallback(
    (api: IApi) => {
      onApiRef.current?.(api)
      apiRef.current = api

      // 左侧表格列宽固定：禁止拖动表头分隔线调整各列宽度（resize-column 走手动拖拽）
      api.intercept('resize-column', () => false)

      // 面板折叠状态的双向同步：SVAR 自带的 resizer 展开箭头也会派发 set-display-mode，
      // 这里回读成 React 状态，保证四角按钮与被折叠的面板始终一致。
      api.on('set-display-mode', (ev) => {
        const m = (ev as { mode?: FoldMode } | undefined)?.mode
        if (m === 'all' || m === 'grid' || m === 'chart') setFold(m)
      })

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

  /**
   * 悬停任务条 → 描述/负责人气泡。
   *
   * 关键坑（真实浏览器探针复现）：光标正下方的「顶层元素」常常不是 .wx-bar 的子节点，
   * 而是 gantt 的祖先容器（探针实测：部分任务 bar 中心的 elementFromPoint 命中了 .hk-gantt 的父级 DIV）。
   * 若用 React 的 onMouseMove（冒泡监听在 wrapper 上），事件目标在 wrapper 的祖先之上时只向上冒泡、
   * 根本到不了 wrapper 的监听器 → 这些任务悬停永远弹不出气泡（表现为「只有最顶部/部分任务能弹」）。
   *
   * 修法：监听器挂到 document 的【捕获阶段】（事件从 document 向下派发，无论光标正下方是谁都必触发），
   * 命中测试改用【矩形包容】——指针坐标落在哪个 .wx-bar 的 getBoundingClientRect 内就命中哪个，
   * 与「顶层元素是不是 bar 子节点 / 事件是否冒泡到 wrapper」彻底解耦，任何任务都稳定生效。
   * 用 tipBarRef 记录当前 bar：同一 bar 内移动只跟随光标、不重算任务，避免抖动。无附加信息不打扰。
   */
  useEffect(() => {
    const root = rootRef.current
    const wrap = wrapRef.current
    if (!root || !wrap) return
    const onMove = (e: MouseEvent) => {
      // 快速排除：指针明显在 gantt 之外时，直接清气泡（已在 gantt 外且无气泡则跳过整段命中测试）
      const rootRect = root.getBoundingClientRect()
      const far =
        e.clientX < rootRect.left - 40 ||
        e.clientX > rootRect.right + 40 ||
        e.clientY < rootRect.top - 40 ||
        e.clientY > rootRect.bottom + 40
      if (far) {
        if (tipBarRef.current !== null) {
          tipBarRef.current = null
          setTip(null)
        }
        return
      }
      // 矩形命中测试：指针落在哪个 bar 的可见矩形内就命中哪个，不依赖 e.target
      let bar: HTMLElement | null = null
      const bars = root.querySelectorAll<HTMLElement>('.wx-bar')
      for (const b of bars) {
        const r = b.getBoundingClientRect()
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          bar = b
          break
        }
      }
      if (!bar || bar.classList.contains('wx-summary')) {
        if (tipBarRef.current !== null) {
          tipBarRef.current = null
          setTip(null)
        }
        return
      }
      const id = bar.getAttribute('data-id')
      const api = apiRef.current
      if (!id || !api) {
        tipBarRef.current = null
        setTip(null)
        return
      }
      // 同一任务条内移动：只跟随光标，不重算任务
      if (tipBarRef.current === id) {
        const rect = wrap.getBoundingClientRect()
        setTip((prev) =>
          prev ? { ...prev, x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 16 } : prev,
        )
        return
      }
      // data-id 是字符串，store 里存的是数字 id，必须走兼容解析
      const task = resolveSvarTask(api, id)
      if (!task) {
        tipBarRef.current = null
        setTip(null)
        return
      }
      const details = typeof task.details === 'string' ? task.details.trim() : ''
      const assignees = Array.isArray(task.assignees)
        ? (task.assignees as unknown[]).filter((a) => typeof a === 'string' && a)
        : []
      if (!details && assignees.length === 0) {
        tipBarRef.current = null
        setTip(null)
        return
      }
      tipBarRef.current = id
      const rect = wrap.getBoundingClientRect()
      setTip({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 16, task })
    }
    document.addEventListener('mousemove', onMove, true)
    return () => document.removeEventListener('mousemove', onMove, true)
  }, [])

  /**
   * 切换面板显示模式（折叠/展开左表格或右时间轴）。
   * 折叠交给 SVAR 的 displayMode —— 它只改变两面板的宽度分配，被折叠的面板仍在布局与测量中，
   * 因此左表格的行数据不受影响（这也是本文件顶部 fold 注释里那个「越折越少行」缺陷的修法）。
   */
  const setDisplayMode = useCallback((next: FoldMode) => {
    const api = apiRef.current
    if (!api) return
    api.exec('set-display-mode', { mode: next })
    setFold(next)
  }, [])

  return (
    <div
      ref={rootRef}
      className={`hk-gantt${mode === 'progress' ? ' hk-gantt-progress' : ''}${
        leftCollapsed ? ' hk-gantt-left-collapsed' : ''
      }${rightCollapsed ? ' hk-gantt-right-collapsed' : ''}`}
    >
      {priorityFrameCss && <style>{priorityFrameCss}</style>}
      <div ref={wrapRef} style={{ position: 'relative', height: '100%' }}>
        <GanttBody seed={seed} mode={mode} init={init} />
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
        {/* 左表格 / 右时间轴 折叠控制：同一时刻至少保留一个面板可见 */}
        {fold === 'all' && (
          <button
            type="button"
            className="hk-gantt-fold hk-gantt-fold-left"
            title="隐藏左侧表格"
            aria-label="隐藏左侧表格"
            onClick={() => setDisplayMode('chart')}
          >
            ‹
          </button>
        )}
        {fold === 'all' && (
          <button
            type="button"
            className="hk-gantt-fold hk-gantt-fold-right"
            title="隐藏右侧时间轴"
            aria-label="隐藏右侧时间轴"
            onClick={() => setDisplayMode('grid')}
          >
            ›
          </button>
        )}
        {leftCollapsed && (
          <button
            type="button"
            className="hk-gantt-reopen hk-gantt-reopen-left"
            title="展开左侧表格"
            aria-label="展开左侧表格"
            onClick={() => setDisplayMode('all')}
          >
            ›
          </button>
        )}
        {rightCollapsed && (
          <button
            type="button"
            className="hk-gantt-reopen hk-gantt-reopen-right"
            title="展开右侧时间轴"
            aria-label="展开右侧时间轴"
            onClick={() => setDisplayMode('all')}
          >
            ‹
          </button>
        )}
      </div>
    </div>
  )
}
