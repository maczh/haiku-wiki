import { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Button, Checkbox, Collapse, DatePicker, Empty, Input, InputNumber, Modal, Progress, Select, Slider, Space, Tag, Tooltip, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { listTodoOptions, type TodoOption } from '../../api/todo'
import './todo.css'
import dayjs from '../../lib/dayjs'
import {
  PRIORITY_OPTIONS,
  groupTodos,
  importTodoText,
  normalizeNames,
  patchTodoItem,
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
  const [options, setOptions] = useState<TodoOption[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  useEffect(() => {
    if (readOnly) return
    let active = true
    void listTodoOptions().then(result => { if (active) setOptions(result) }).catch(() => undefined)
    return () => { active = false }
  }, [readOnly])
  const imported = useMemo(() => importTodoText(importText), [importText])
  const assigneeOptions = normalizeNames([...options.filter(o => o.kind === 'assignee').map(o => o.name), ...value.items.flatMap(it => it.assignees)]).map(value => ({ value, label: value }))
  const projectOptions = normalizeNames([...options.filter(o => o.kind === 'project').map(o => o.name), ...value.items.map(it => it.project)]).map(value => ({ value }))
  const items = value.items
  const progress = todoProgress(items)
  const groups = groupTodos(items)

  function patch(id: string, next: Partial<TodoItem>) {
    if (readOnly || !onChange) return
    onChange({ ...value, items: items.map((it) => (it.id === id ? patchTodoItem(it, next) : it)) })
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

  function renderItem(it: TodoItem) {
    const meta = priorityMeta(it.priority)
    const overdue = isOverdue(it)
    return (
      <div key={it.id} className="todo-item">
        <Checkbox aria-label={`完成：${it.text || '待办事项'}`} checked={it.done} disabled={readOnly}
          onChange={e => patch(it.id, { done: e.target.checked })} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {readOnly ? <div className="todo-title" style={{ textDecoration: it.done ? 'line-through' : undefined }}>{it.text || '（空条目）'}</div> :
            <Input aria-label="待办事项" value={it.text} placeholder="待办事项…" onChange={e => patch(it.id, { text: e.target.value })} />}
          {readOnly ? <>
            <Space size={6} wrap>
              {it.project && <Tag>{it.project}</Tag>}
              {it.assignees.map(name => <Tag key={name}>{name}</Tag>)}
              {it.due && <Tag color={overdue ? 'red' : 'default'}>{overdue ? '已逾期 · ' : '截止 '}{it.due}</Tag>}
              {meta && <Tag color={meta.color}>优先级 {meta.label}</Tag>}
            </Space>
            {it.note && <div className="todo-note">{it.note}</div>}
            <Progress aria-label="任务进度" percent={it.progress} size="small" />
          </> : <>
            <div className="todo-fields">
              <label>负责人<Select aria-label="负责人" mode="tags" value={it.assignees} options={assigneeOptions} tokenSeparators={[',', '，', '、']} placeholder="选择或输入人名…" onChange={names => patch(it.id, { assignees: normalizeNames(names) })} /></label>
              <label>项目名称<AutoComplete aria-label="项目名称" value={it.project} options={projectOptions} maxLength={191} filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} placeholder="选择或输入项目…" onChange={project => patch(it.id, { project })} /></label>
            </div>
            <div className="todo-progress"><span>进度</span>
              <Slider ariaLabelForHandle="任务进度" min={0} max={100} value={it.progress} onChange={progress => patch(it.id, { progress })} style={{ flex: 1, minWidth: 60 }} />
              <InputNumber aria-label="进度百分比" min={0} max={100} precision={0} value={it.progress} onChange={progress => patch(it.id, { progress: progress ?? 0 })} addonAfter="%" />
            </div>
            <Space size={6} wrap>
              <DatePicker aria-label="截止时间" size="small" showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" placeholder="截止时间" value={it.due ? dayjs(it.due) : null} onChange={d => patch(it.id, { due: d ? d.format('YYYY-MM-DD HH:mm') : '' })} style={{ width: 190 }} />
              <Select aria-label="优先级" size="small" placeholder="优先级" allowClear value={it.priority || undefined} onChange={v => patch(it.id, { priority: (v as TodoPriority) || '' })} options={PRIORITY_OPTIONS.map(o => ({ value: o.value, label: o.label }))} style={{ width: 90 }} />
              <Input aria-label="备注" size="small" placeholder="备注…" value={it.note} onChange={e => patch(it.id, { note: e.target.value })} style={{ width: 170 }} />
              <Tooltip title="删除这一条"><Button aria-label="删除这一条" size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(it.id)} /></Tooltip>
            </Space>
          </>}
        </div>
      </div>
    )
  }

  return (
    <div className="todo-board" style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px 48px' }}>
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

      {readOnly ? <Collapse defaultActiveKey={groups.map(group => group.name)} items={groups.map(group => ({
        key: group.name,
        label: `${group.name} · ${group.items.length} 项 · 已完成 ${group.items.filter(it => it.done).length} 项`,
        children: group.items.map(renderItem),
      }))} /> : items.map(renderItem)}

      {!readOnly && <>
        <Button onClick={() => setImportOpen(true)} style={{ marginTop: 16 }}>智能导入</Button>
        <Modal title="智能导入待办" open={importOpen} onCancel={() => setImportOpen(false)} okText={`追加导入 ${imported.length} 项`} cancelText="取消" okButtonProps={{ disabled: imported.length === 0 }} onOk={() => {
          onChange?.({ ...value, items: [...items.filter(it => it.text.trim() || it.note || it.assignees.length || it.project || it.due || it.priority || it.progress), ...imported] })
          setImportOpen(false)
          setImportText('')
        }}>
          <Typography.Paragraph type="secondary">识别“负责人：”、编号、括号内状态和后续备注。完成设为 100%，未标明百分比的任务设为 0%；确认后追加，不覆盖已有待办。</Typography.Paragraph>
          <Input.TextArea aria-label="待导入文本" rows={8} value={importText} onChange={e => setImportText(e.target.value)} placeholder="粘贴文本，例如：斌辉：\n1、12类优惠（完成）…" />
          <div aria-live="polite" style={{ marginTop: 12 }}>预览：{imported.length} 项</div>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>{imported.map((it, i) => <div key={i} className="todo-import-item">
            <strong>{it.assignees.join('、') || '未分配负责人'}</strong> · {it.text} · {it.progress}%
            {it.note && <div className="todo-note">{it.note}</div>}
          </div>)}</div>
        </Modal>
      </>}

      {!readOnly && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Input
            aria-label="新增待办"
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
