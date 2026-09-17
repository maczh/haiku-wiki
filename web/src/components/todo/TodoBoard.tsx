import { useState } from 'react'
import { Button, Checkbox, DatePicker, Empty, Input, Progress, Select, Space, Tag, Tooltip, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from '../../lib/dayjs'
import {
  PRIORITY_OPTIONS,
  emptyItem,
  isOverdue,
  priorityMeta,
  todoProgress,
  type TodoJSON,
  type TodoItem,
  type TodoPriority,
} from '../../lib/todo'

interface Props {
  value: TodoJSON
  /** 只读模式（阅读视图）不提供任何修改入口 */
  readOnly?: boolean
  onChange?: (next: TodoJSON) => void
}

/**
 * 待办清单面板 —— 编辑与阅读共用同一套渲染，只读时隐藏所有变更控件。
 *
 * 之所以不再单独写一个阅读组件：待办清单的「阅读」价值恰恰在于逐项查看
 * 状态/截止/优先级，与编辑态的差异只有「能不能改」，共用一份渲染能避免两边样式走偏。
 * 截止时间用 dayjs 处理（dayjs 已是本项目依赖，见 lib/dayjs.ts）。
 */
export default function TodoBoard({ value, readOnly = false, onChange }: Props) {
  const [draft, setDraft] = useState('')
  const items = value.items
  const progress = todoProgress(items)

  function patch(id: string, next: Partial<TodoItem>) {
    if (readOnly || !onChange) return
    onChange({ ...value, items: items.map((it) => (it.id === id ? { ...it, ...next } : it)) })
  }

  function remove(id: string) {
    if (readOnly || !onChange) return
    onChange({ ...value, items: items.filter((it) => it.id !== id) })
  }

  function add() {
    if (readOnly || !onChange) return
    const text = draft.trim()
    if (!text) return
    setDraft('')
    onChange({ ...value, items: [...items, emptyItem(text)] })
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px 48px' }}>
      {/* 进度概览：让「还剩几件」一眼可见 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        <Progress
          percent={progress.percent}
          size="small"
          style={{ flex: 1 }}
          strokeColor={progress.percent === 100 ? '#52c41a' : '#1677ff'}
        />
        <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
          已完成 {progress.done} / {progress.total}
        </Typography.Text>
      </div>

      {items.length === 0 && (
        <Empty
          description={readOnly ? '这份待办清单还没有条目' : '还没有待办，在下方输入一条试试'}
          style={{ margin: '40px 0' }}
        />
      )}

      {items.map((it) => {
        const meta = priorityMeta(it.priority)
        const overdue = isOverdue(it)
        return (
          <div
            key={it.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 12px',
              borderBottom: '1px solid #f0f0f0',
              background: it.done ? '#fafafa' : undefined,
            }}
          >
            <Checkbox
              checked={it.done}
              disabled={readOnly}
              onChange={(e) => patch(it.id, { done: e.target.checked })}
              style={{ marginTop: 6 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              {readOnly ? (
                <div
                  style={{
                    fontSize: 15,
                    lineHeight: '22px',
                    textDecoration: it.done ? 'line-through' : undefined,
                    color: it.done ? '#8c8c8c' : undefined,
                  }}
                >
                  {it.text || <Typography.Text type="secondary">（空条目）</Typography.Text>}
                </div>
              ) : (
                <Input
                  value={it.text}
                  placeholder="待办事项"
                  variant="borderless"
                  style={{ padding: 0, fontSize: 15 }}
                  onChange={(e) => patch(it.id, { text: e.target.value })}
                />
              )}
              {/* 元信息行：截止时间 / 优先级 / 备注 */}
              {(it.due || it.priority || it.note || !readOnly) && (
                <div style={{ marginTop: 6 }}>
                  {readOnly ? (
                    <Space size={6} wrap>
                      {it.due && (
                        <Tag color={overdue ? 'red' : 'default'} style={{ margin: 0 }}>
                          {overdue ? '已逾期 · ' : '截止 '}
                          {it.due}
                        </Tag>
                      )}
                      {meta && (
                        <Tag color={meta.color} style={{ margin: 0 }}>
                          优先级 {meta.label}
                        </Tag>
                      )}
                      {it.note && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{it.note}</Typography.Text>}
                    </Space>
                  ) : (
                    <Space size={6} wrap>
                      <DatePicker
                        size="small"
                        showTime={{ format: 'HH:mm' }}
                        format="YYYY-MM-DD HH:mm"
                        placeholder="截止时间"
                        value={it.due ? dayjs(it.due) : null}
                        onChange={(d) => patch(it.id, { due: d ? d.format('YYYY-MM-DD HH:mm') : '' })}
                        style={{ width: 190 }}
                      />
                      <Select
                        size="small"
                        placeholder="优先级"
                        allowClear
                        value={it.priority || undefined}
                        onChange={(v) => patch(it.id, { priority: (v as TodoPriority) || '' })}
                        options={PRIORITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                        style={{ width: 90 }}
                      />
                      <Input
                        size="small"
                        placeholder="备注"
                        value={it.note}
                        onChange={(e) => patch(it.id, { note: e.target.value })}
                        style={{ width: 170 }}
                      />
                      <Tooltip title="删除这一条">
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(it.id)} />
                      </Tooltip>
                    </Space>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {!readOnly && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Input
            value={draft}
            placeholder="添加待办，回车确认"
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={add}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={add} disabled={!draft.trim()}>
            添加
          </Button>
        </div>
      )}
    </div>
  )
}
