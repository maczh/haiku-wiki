import { useMemo, useState } from 'react'
import { Button, DatePicker, Empty, Input, Modal, Space, Tag, Tooltip, Typography, message } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, EditOutlined, LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons'
import dayjs from '../../lib/dayjs'
import {
  TASK_STATE_COLOR,
  TASK_STATE_LABEL,
  groupByDate,
  newTaskId,
  taskDateKey,
  taskState,
  taskTimeLabel,
  toDateKey,
  toDateTimeKey,
  monthGrid,
  type CalendarJSON,
  type CalendarTask,
} from '../../lib/calendar'

interface Props {
  value: CalendarJSON
  readOnly?: boolean
  onChange?: (next: CalendarJSON) => void
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/**
 * 工作日历面板 —— 月视图 + 当日任务列表，编辑与阅读共用。
 *
 * 交互约定（对应需求「可以选择日期时间添加/修改/完成/取消待办任务」）：
 *   - 点任意日期格 → 右侧定位到该日，可在该日添加任务（时间可精确到分钟）
 *   - 任务行上的 ✓ / ✕ 分别表示「完成」与「取消」；两者都可再点一次撤销
 *   - 编辑按钮弹出对话框改标题/开始/结束/时间/备注
 * 只读模式保留全部展示，隐藏所有按钮。
 */
export default function CalendarBoard({ value, readOnly = false, onChange }: Props) {
  const today = dayjs()
  const [cursor, setCursor] = useState(() => dayjs().startOf('month'))
  const [selected, setSelected] = useState(() => toDateKey(new Date()))
  const [editing, setEditing] = useState<CalendarTask | null>(null)
  const [draft, setDraft] = useState('')
  const [draftTime, setDraftTime] = useState(() => dayjs())

  const byDate = useMemo(() => groupByDate(value.tasks), [value.tasks])
  const cells = useMemo(() => monthGrid(cursor.year(), cursor.month()), [cursor])
  const dayTasks = byDate.get(selected) ?? []

  function mutate(next: CalendarTask[]) {
    if (readOnly || !onChange) return
    onChange({ ...value, tasks: next })
  }

  function patch(id: string, next: Partial<CalendarTask>) {
    mutate(value.tasks.map((t) => (t.id === id ? { ...t, ...next } : t)))
  }

  function addTask() {
    const title = draft.trim()
    if (!title) {
      message.warning('请先填写任务内容')
      return
    }
    const start = toDateTimeKey(draftTime.toDate())
    const task: CalendarTask = {
      id: newTaskId(),
      title,
      start,
      end: draftTime.add(1, 'hour').format('YYYY-MM-DD HH:mm'),
      done: false,
      cancelled: false,
      note: '',
    }
    setDraft('')
    mutate([...value.tasks, task])
  }

  /** 月份切换：同时把选中日挪到新月的 1 号，避免停留在看不见的日期上 */
  function shiftMonth(delta: number) {
    const next = cursor.add(delta, 'month')
    setCursor(next)
    const target = next.date(1)
    setSelected(toDateKey(target.toDate()))
  }

  const monthLabel = `${cursor.year()} 年 ${cursor.month() + 1} 月`

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px 48px' }}>
      {/* 月份切换条 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Button size="small" icon={<LeftOutlined />} onClick={() => shiftMonth(-1)} />
        <Typography.Text strong style={{ fontSize: 16, minWidth: 120, textAlign: 'center' }}>
          {monthLabel}
        </Typography.Text>
        <Button size="small" icon={<RightOutlined />} onClick={() => shiftMonth(1)} />
        <Button
          size="small"
          onClick={() => {
            setCursor(dayjs().startOf('month'))
            setSelected(toDateKey(new Date()))
          }}
        >
          回到今天
        </Button>
        <div style={{ flex: 1 }} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          共 {value.tasks.length} 项 · 已完成{' '}
          {value.tasks.filter((t) => taskState(t) === 'done').length} · 待办{' '}
          {value.tasks.filter((t) => taskState(t) === 'pending').length}
        </Typography.Text>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* 月历网格 */}
        <div style={{ flex: '1 1 620px', minWidth: 320 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: '#f0f0f0', border: '1px solid #f0f0f0' }}>
            {WEEK_LABELS.map((w) => (
              <div key={w} style={{ background: '#fafafa', textAlign: 'center', padding: '6px 0', fontSize: 12, color: '#8c8c8c' }}>
                周{w}
              </div>
            ))}
            {cells.map(({ date, inMonth }) => {
              const key = toDateKey(date)
              const list = byDate.get(key) ?? []
              const isToday = key === toDateKey(new Date())
              const isSelected = key === selected
              return (
                <div
                  key={key}
                  onClick={() => setSelected(key)}
                  style={{
                    background: isSelected ? '#e6f4ff' : '#fff',
                    minHeight: 78,
                    padding: '4px 6px',
                    cursor: 'pointer',
                    outline: isSelected ? '1px solid #1677ff' : undefined,
                    outlineOffset: -1,
                    opacity: inMonth ? 1 : 0.45,
                  }}
                >
                  <div style={{ fontSize: 12, color: isToday ? '#1677ff' : '#8c8c8c', fontWeight: isToday ? 600 : 400 }}>
                    {date.getDate()}
                  </div>
                  {list.slice(0, 3).map((t) => {
                    const st = taskState(t)
                    return (
                      <div
                        key={t.id}
                        style={{
                          fontSize: 11,
                          lineHeight: '15px',
                          marginTop: 2,
                          padding: '1px 4px',
                          borderRadius: 3,
                          background: `${TASK_STATE_COLOR[st]}14`,
                          color: TASK_STATE_COLOR[st],
                          textDecoration: st === 'cancelled' ? 'line-through' : undefined,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={t.title}
                      >
                        {taskTimeLabel(t) ? `${taskTimeLabel(t)} ` : ''}
                        {t.title}
                      </div>
                    )
                  })}
                  {list.length > 3 && (
                    <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>还有 {list.length - 3} 项</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 当日任务详情 */}
        <div style={{ flex: '0 1 360px', minWidth: 280 }}>
          <Typography.Text strong>{selected}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            {dayTasks.length} 项任务
          </Typography.Text>
          <div style={{ marginTop: 10, borderTop: '1px solid #f0f0f0' }}>
            {dayTasks.length === 0 && <Empty description="这一天没有安排" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '18px 0' }} />}
            {dayTasks.map((t) => {
              const st = taskState(t)
              return (
                <div key={t.id} style={{ padding: '9px 0', borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag color={TASK_STATE_COLOR[st]} style={{ margin: 0 }}>
                      {TASK_STATE_LABEL[st]}
                    </Tag>
                    <Typography.Text style={{ flex: 1, textDecoration: st === 'cancelled' ? 'line-through' : undefined }}>
                      {t.title}
                    </Typography.Text>
                    {!readOnly && (
                      <Space size={2}>
                        <Tooltip title={t.done ? '撤销完成' : '标记完成'}>
                          <Button
                            size="small"
                            type="text"
                            icon={<CheckCircleOutlined style={{ color: t.done ? '#389e0d' : undefined }} />}
                            onClick={() => patch(t.id, { done: !t.done, cancelled: false })}
                          />
                        </Tooltip>
                        <Tooltip title={t.cancelled ? '撤销取消' : '取消任务'}>
                          <Button
                            size="small"
                            type="text"
                            icon={<CloseCircleOutlined style={{ color: t.cancelled ? '#8c8c8c' : undefined }} />}
                            onClick={() => patch(t.id, { cancelled: !t.cancelled })}
                          />
                        </Tooltip>
                        <Tooltip title="修改">
                          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(t)} />
                        </Tooltip>
                        <Tooltip title="删除">
                          <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => mutate(value.tasks.filter((x) => x.id !== t.id))}
                          />
                        </Tooltip>
                      </Space>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>
                    {t.start}
                    {t.end ? ` ~ ${t.end}` : ''}
                    {t.note ? ` · ${t.note}` : ''}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 在选中日添加任务 */}
          {!readOnly && (
            <div style={{ marginTop: 14 }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Input
                  placeholder="任务内容"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onPressEnter={addTask}
                />
                <DatePicker
                  showTime={{ format: 'HH:mm' }}
                  format="YYYY-MM-DD HH:mm"
                  value={draftTime}
                  onChange={(d) => d && setDraftTime(d)}
                  style={{ width: '100%' }}
                />
                <Button type="primary" block icon={<PlusOutlined />} onClick={addTask}>
                  添加到 {selected}
                </Button>
              </Space>
            </div>
          )}
        </div>
      </div>

      {/* 修改任务 */}
      <Modal
        open={!!editing}
        title="修改任务"
        okText="保存"
        cancelText="取消"
        onCancel={() => setEditing(null)}
        onOk={() => {
          if (editing) {
            patch(editing.id, {
              title: editing.title,
              start: editing.start,
              end: editing.end,
              note: editing.note,
            })
          }
          setEditing(null)
        }}
      >
        {editing && (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Input
              addonBefore="任务"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              placeholder="开始时间"
              value={editing.start ? dayjs(editing.start) : null}
              onChange={(d) => setEditing({ ...editing, start: d ? d.format('YYYY-MM-DD HH:mm') : '' })}
              style={{ width: '100%' }}
            />
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              placeholder="结束时间"
              value={editing.end ? dayjs(editing.end) : null}
              onChange={(d) => setEditing({ ...editing, end: d ? d.format('YYYY-MM-DD HH:mm') : '' })}
              style={{ width: '100%' }}
            />
            <Input
              addonBefore="备注"
              value={editing.note}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
            />
            {/* 修改时若把开始时间挪到别的日期，选中日跟着走，避免「改完就不见了」 */}
            {editing.start && taskDateKey(editing) && taskDateKey(editing) !== selected && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                保存后这条任务会移到 {taskDateKey(editing)}
              </Typography.Text>
            )}
          </Space>
        )}
      </Modal>
    </div>
  )
}
