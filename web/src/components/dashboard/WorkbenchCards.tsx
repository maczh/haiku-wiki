import { Card, Input, Progress, Tag, Tooltip } from 'antd'
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleFilled,
  ProjectOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import { GANTT_STATUS_META } from '../../lib/gantt'
import { TASK_STATE_COLOR, TASK_STATE_LABEL } from '../../lib/calendar'
import { priorityMeta } from '../../lib/todo'
import {
  aggregateCalendar,
  aggregateGantt,
  aggregateTodos,
  type CalendarEntry,
  type GanttAggregate,
  type TodoAggregate,
} from '../../lib/workbench'
import { browserStorage, type FlagStorage } from '../../lib/dashboard'
import {
  clearSearchHistory,
  pushSearchTerm,
  readSearchHistory,
  writeSearchHistory,
} from '../../lib/searchHistory'
import type { WorkbenchDoc } from '../../types'

/** 打开文档的统一回调（bookId + docId，由页面拼 URL） */
export type OpenWorkbenchDoc = (bookId: number, docId: number) => void

/** 卡片标题：图标 + 名称 + 计数后缀 */
function CardTitle({
  icon,
  color,
  text,
  suffix,
}: {
  icon: React.ReactNode
  color: string
  text: string
  suffix?: string
}) {
  return (
    <span style={{ fontSize: 14 }}>
      <span style={{ color, marginRight: 6 }}>{icon}</span>
      {text}
      {suffix && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#8a919f' }}>{suffix}</span>}
    </span>
  )
}

/**
 * 「统计基于最近 N 篇」提示。
 *
 * 后端为了控制返回体积只给每类最近若干篇；若全库数量更大，卡片必须说明口径，
 * 否则用户会以为「未完成 3」是全库的真实数字。
 */
function SampleHint({ total, sampled }: { total: number; sampled: number }) {
  if (!total || total <= sampled) return null
  return (
    <Tooltip title={`该类型共 ${total} 篇，此处统计基于最近更新的 ${sampled} 篇`}>
      <span style={{ fontSize: 11, color: '#b6bcc8', cursor: 'help' }}>（最近 {sampled} 篇）</span>
    </Tooltip>
  )
}

/** 一行小统计：数字 + 说明 */
function MiniStat({ value, label, color }: { value: React.ReactNode; label: string; color?: string }) {
  return (
    <div className="hk-dash-wb-stat">
      <span className="hk-dash-wb-stat-num" style={color ? { color } : undefined}>
        {value}
      </span>
      <span className="hk-dash-wb-stat-label">{label}</span>
    </div>
  )
}

/** 卡片内可点击的一行 */
function WbRow({
  onClick,
  title,
  meta,
  left,
  right,
  accent,
}: {
  onClick: () => void
  title: React.ReactNode
  meta?: React.ReactNode
  left?: React.ReactNode
  right?: React.ReactNode
  accent?: string
}) {
  return (
    <div
      className="hk-dash-wb-row"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick()
      }}
      style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}
    >
      {left && <span className="hk-dash-wb-row-left">{left}</span>}
      <div className="hk-dash-wb-row-main">
        <div className="hk-dash-wb-row-title">{title}</div>
        {meta && <div className="hk-dash-wb-row-meta">{meta}</div>}
      </div>
      {right && <span className="hk-dash-wb-row-right">{right}</span>}
    </div>
  )
}

// ---------------------------------------------------------------- 待办

interface TodoCardProps {
  docs: WorkbenchDoc[]
  /** 全库待办清单总数（用于口径提示；缺省时按 docs.length） */
  total?: number
  onOpenDoc: OpenWorkbenchDoc
}

/**
 * 「待办事项」卡：把**所有**待办清单里的未完成项聚成一屏。
 *
 * 排序由 lib/workbench.aggregateTodos 完成（逾期 → 今日到期 → 有截止日 → 无截止日），
 * 这里只负责渲染；完成率按全部清单的条目合并计算，而不是「各清单完成度的平均」。
 */
export function TodoWorkbenchCard({ docs, total, onOpenDoc }: TodoCardProps) {
  const agg: TodoAggregate = aggregateTodos(docs)
  const percent = agg.total === 0 ? 100 : Math.round((agg.done / agg.total) * 100)

  return (
    <Card
      size="small"
      data-testid="hk-wb-todo"
      style={{ height: '100%' }}
      title={<CardTitle icon={<UnorderedListOutlined />} color="#cf1322" text="待办事项" suffix={`${agg.open} 项未完成`} />}
      extra={
        <span style={{ fontSize: 12, color: '#8a919f' }}>
          {total ?? agg.lists} 份清单
          <SampleHint total={total ?? agg.lists} sampled={agg.lists} />
        </span>
      }
    >
      <div className="hk-dash-wb-stats">
        <MiniStat value={agg.open} label="未完成" color={agg.open > 0 ? '#cf1322' : undefined} />
        <MiniStat value={agg.overdue} label="已逾期" color={agg.overdue > 0 ? '#cf1322' : undefined} />
        <MiniStat value={agg.done} label="已完成" color="#389e0d" />
        <MiniStat value={`${percent}%`} label="完成率" />
      </div>
      <Progress
        percent={percent}
        size="small"
        showInfo={false}
        strokeColor={agg.overdue > 0 ? '#ff7875' : '#52c41a'}
        style={{ marginBottom: 8 }}
      />

      {agg.entries.length === 0 ? (
        <div className="hk-dash-wb-empty">
          <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
          {agg.total === 0 ? '这些清单还没有条目' : '没有待处理事项，全部完成'}
        </div>
      ) : (
        <div>
          {agg.entries.map((e) => {
            const pm = priorityMeta(e.item.priority)
            return (
              <WbRow
                key={`${e.docId}:${e.item.id}`}
                accent={e.overdue ? '#f5222d' : undefined}
                onClick={() => onOpenDoc(e.bookId, e.docId)}
                title={<span className={e.overdue ? 'hk-dash-wb-overdue' : undefined}>{e.item.text}</span>}
                left={
                  e.overdue ? (
                    <CloseCircleFilled style={{ color: '#f5222d' }} />
                  ) : (
                    <ClockCircleOutlined style={{ color: '#bfbfbf' }} />
                  )
                }
                meta={
                  <>
                    <Tooltip title="所属待办清单">
                      <span>{e.docTitle}</span>
                    </Tooltip>
                    {e.item.due && (
                      <span style={{ color: e.overdue ? '#f5222d' : e.dueToday ? '#d46b08' : '#8a919f' }}>
                        {e.overdue ? '已逾期 ' : e.dueToday ? '今天到期' : '截止 '}
                        {e.item.due}
                      </span>
                    )}
                    {pm && (
                      <Tag
                        bordered={false}
                        style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', background: `${pm.color}1a`, color: pm.color }}
                      >
                        {pm.label}优先
                      </Tag>
                    )}
                  </>
                }
              />
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- 甘特图

interface GanttCardProps {
  docs: WorkbenchDoc[]
  total?: number
  onOpenDoc: OpenWorkbenchDoc
}

/**
 * 「甘特图工作进度」卡：跨知识库汇总所有甘特图的推进情况。
 *
 * 进度按期长加权（见 lib/workbench.aggregateGantt）：等权平均会让 1 天的任务与
 * 100 天的任务等价，反映不出真实工期压力。
 */
export function GanttWorkbenchCard({ docs, total, onOpenDoc }: GanttCardProps) {
  const agg: GanttAggregate = aggregateGantt(docs)

  return (
    <Card
      size="small"
      data-testid="hk-wb-gantt"
      style={{ height: '100%' }}
      title={<CardTitle icon={<ProjectOutlined />} color="#2f54eb" text="甘特图进度" suffix={`平均 ${agg.progress}%`} />}
      extra={
        <span style={{ fontSize: 12, color: '#8a919f' }}>
          {total ?? agg.charts} 张图
          <SampleHint total={total ?? agg.charts} sampled={agg.charts} />
        </span>
      }
    >
      <div className="hk-dash-wb-stats">
        <MiniStat value={agg.tasks} label="任务" />
        <MiniStat value={agg.done} label="已结束" color="#8c8c8c" />
        <MiniStat value={agg.overdue} label="已超期" color={agg.overdue > 0 ? '#f5222d' : undefined} />
        <MiniStat value={agg.atRisk} label="进度拖延" color={agg.atRisk > 0 ? '#faad14' : undefined} />
      </div>

      {agg.rows.length === 0 ? (
        <div className="hk-dash-wb-empty">
          <ProjectOutlined style={{ marginRight: 6 }} />
          这些甘特图里还没有任务
        </div>
      ) : (
        <div>
          {agg.rows.map((r) => (
            <div
              key={r.docId}
              className="hk-dash-wb-gantt-row"
              role="button"
              tabIndex={0}
              title={`${r.title}　·　${r.bookName}`}
              onClick={() => onOpenDoc(r.bookId, r.docId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpenDoc(r.bookId, r.docId)
              }}
            >
              <div className="hk-dash-wb-gantt-head">
                <span className="hk-dash-wb-row-title">{r.title || '未命名甘特图'}</span>
                <span style={{ fontSize: 12, color: '#5f6672', flex: 'none' }}>
                  {r.done}/{r.tasks} · {r.progress}%
                </span>
              </div>
              <Progress
                percent={r.progress}
                size="small"
                showInfo={false}
                strokeColor={
                  r.overdue > 0
                    ? GANTT_STATUS_META.overdue.color
                    : r.atRisk > 0
                      ? GANTT_STATUS_META.atrisk.color
                      : GANTT_STATUS_META.normal.color
                }
              />
              <div className="hk-dash-wb-gantt-foot">
                <Tooltip title="所属知识库">
                  <span>{r.bookName}</span>
                </Tooltip>
                {r.endIso && <span>计划至 {r.endIso}</span>}
                {r.overdue > 0 && (
                  <Tag bordered={false} style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', background: '#fff1f0', color: '#f5222d' }}>
                    {r.overdue} 项超期
                  </Tag>
                )}
                {r.atRisk > 0 && (
                  <Tag bordered={false} style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', background: '#fffbe6', color: '#d46b08' }}>
                    {r.atRisk} 项拖延
                  </Tag>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- 工作日历

interface CalendarCardProps {
  docs: WorkbenchDoc[]
  total?: number
  onOpenDoc: OpenWorkbenchDoc
}

function calendarEntryMeta(e: CalendarEntry) {
  return (
    <>
      <Tooltip title="所属工作日历">
        <span>{e.docTitle}</span>
      </Tooltip>
      {e.bookName && <span>{e.bookName}</span>}
    </>
  )
}

/**
 * 「工作日历」卡：今天 + 未来 7 天的日程。
 *
 * 已取消的日程不展示（对使用者不是待处理项）；已完成保留但划线弱化，便于回顾。
 */
export function CalendarWorkbenchCard({ docs, total, onOpenDoc }: CalendarCardProps) {
  const agg = aggregateCalendar(docs)

  return (
    <Card
      size="small"
      data-testid="hk-wb-calendar"
      style={{ height: '100%' }}
      title={
        <CardTitle
          icon={<CalendarOutlined />}
          color="#13a86b"
          text="工作日历"
          suffix={agg.pendingToday > 0 ? `今天 ${agg.pendingToday} 项` : '今天无待办'}
        />
      }
      extra={
        <span style={{ fontSize: 12, color: '#8a919f' }}>
          {total ?? agg.calendars} 本日历
          <SampleHint total={total ?? agg.calendars} sampled={agg.calendars} />
        </span>
      }
    >
      <div className="hk-dash-wb-sub">今天</div>
      {agg.today.length === 0 ? (
        <div className="hk-dash-wb-empty">
          <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
          今天没有安排
        </div>
      ) : (
        agg.today.map((e, i) => (
          <WbRow
            key={`t${i}-${e.docId}-${e.title}`}
            onClick={() => onOpenDoc(e.bookId, e.docId)}
            left={
              <span style={{ color: TASK_STATE_COLOR[e.state], fontSize: 13, minWidth: 42, display: 'inline-block' }}>
                {e.allDay ? '全天' : e.timeLabel || '—'}
              </span>
            }
            title={
              <span style={e.state === 'done' ? { color: '#b6bcc8', textDecoration: 'line-through' } : undefined}>{e.title}</span>
            }
            meta={calendarEntryMeta(e)}
            right={
              <Tag
                bordered={false}
                style={{
                  marginInlineEnd: 0,
                  fontSize: 11,
                  lineHeight: '16px',
                  background: `${TASK_STATE_COLOR[e.state]}1a`,
                  color: TASK_STATE_COLOR[e.state],
                }}
              >
                {TASK_STATE_LABEL[e.state]}
              </Tag>
            }
          />
        ))
      )}

      <div className="hk-dash-wb-sub" style={{ marginTop: 10 }}>
        接下来 7 天
      </div>
      {agg.upcoming.length === 0 ? (
        <div className="hk-dash-wb-empty">未来 7 天没有安排</div>
      ) : (
        agg.upcoming.slice(0, 6).map((e, i) => (
          <WbRow
            key={`u${i}-${e.docId}-${e.title}`}
            onClick={() => onOpenDoc(e.bookId, e.docId)}
            left={<span style={{ color: '#8a919f', fontSize: 12, minWidth: 42, display: 'inline-block' }}>{e.dateKey.slice(5)}</span>}
            title={e.title}
            meta={calendarEntryMeta(e)}
            right={<span style={{ fontSize: 12, color: '#8a919f' }}>{e.allDay ? '全天' : e.timeLabel}</span>}
          />
        ))
      )}
      {agg.upcoming.length > 6 && <div className="hk-dash-wb-more">还有 {agg.upcoming.length - 6} 项…</div>}
    </Card>
  )
}

// ---------------------------------------------------------------- 文库内搜索

interface SearchCardProps {
  onSearch: (q: string) => void
  /** 可注入存储（便于测试）；缺省用浏览器 localStorage */
  storage?: FlagStorage | null
}

/** 预设检索入口：把「不知道搜什么」变成「点一下就有结果」 */
const SEARCH_PRESETS = [
  { label: '会议纪要', q: '会议纪要' },
  { label: '需求文档', q: '需求' },
  { label: '接口文档', q: '接口' },
  { label: '周报', q: '周报' },
]

/**
 * 「文库内搜索」卡：站内检索入口 + 本地搜索历史。
 *
 * 历史只存关键词、只存在本机（见 lib/searchHistory），不上报服务端。
 * 检索本身走后端 /api/search（markdown 搜标题+正文，其余类型只搜标题），
 * 这里刻意不做本地假搜索 —— 否则会出现「搜得到却点不开」的错觉。
 */
export function LibrarySearchCard({ onSearch, storage }: SearchCardProps) {
  const store = storage === undefined ? browserStorage() : storage
  const [term, setTerm] = useState('')
  const [history, setHistory] = useState<string[]>(() => readSearchHistory(store))

  function submit(q: string) {
    const v = q.trim()
    if (!v) return
    const next = pushSearchTerm(readSearchHistory(store), v)
    writeSearchHistory(next, store)
    setHistory(next)
    onSearch(v)
  }

  return (
    <Card
      size="small"
      data-testid="hk-dash-search"
      title={<CardTitle icon={<SearchOutlined />} color="#2f54eb" text="文库内搜索" />}
      extra={
        history.length > 0 ? (
          <a
            style={{ fontSize: 12 }}
            onClick={() => {
              clearSearchHistory(store)
              setHistory([])
            }}
          >
            清空历史
          </a>
        ) : null
      }
    >
      <Input.Search
        allowClear
        placeholder="搜索标题与正文，回车开始检索…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onSearch={submit}
        enterButton="搜索"
        size="middle"
        data-testid="hk-dash-search-input"
      />
      <div className="hk-dash-chips">
        <span className="hk-dash-chips-label">试试</span>
        {SEARCH_PRESETS.map((p) => (
          <Tag key={p.q} className="hk-dash-chip" bordered={false} onClick={() => submit(p.q)}>
            {p.label}
          </Tag>
        ))}
      </div>
      {history.length > 0 && (
        <div className="hk-dash-chips">
          <span className="hk-dash-chips-label">最近</span>
          {history.map((h) => (
            <Tag key={h} className="hk-dash-chip" bordered={false} onClick={() => submit(h)}>
              {h}
            </Tag>
          ))}
        </div>
      )}
    </Card>
  )
}
