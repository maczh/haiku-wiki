import { groupTodos, isOverdue, parseTodoJSON, priorityMeta, todoProgress } from '../todo'

export function todoProgressBar(percent: number): string {
  const filled = Math.round(percent / 10)
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${percent}%`
}

/** 静态阅读视图：展开全部负责人分组，适用于 PDF 与打印，不依赖交互组件的折叠状态。 */
export function todoToHtml(content: string): string {
  const { data, reset } = parseTodoJSON(content)
  if (reset) return '<p>（待办内容无法解析）</p>'
  const progress = todoProgress(data.items)
  const bar = (percent: number) => `<div style="display:flex;align-items:center;gap:12px;margin:8px 0"><div role="progressbar" aria-label="任务进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" style="flex:1;background:#f0f0f0;border-radius:4px;height:6px;overflow:hidden"><div style="width:${percent}%;height:6px;background:${percent === 100 ? '#52c41a' : '#1677ff'}"></div></div><span style="font-variant-numeric:tabular-nums">${percent}%</span></div>`
  const summary = `<p>已完成 ${progress.done} / ${progress.total}</p>${bar(progress.percent)}`
  const groups = groupTodos(data.items).map(group => {
    const done = group.items.filter(item => item.done).length
    const items = group.items.map(item => {
      const meta = priorityMeta(item.priority)
      const tags = [item.project, ...item.assignees, item.due ? `${isOverdue(item) ? '已逾期 · ' : '截止 '}${item.due}` : '', meta ? `优先级 ${meta.label}` : ''].filter(Boolean)
      return `<article data-todo-export-task style="padding:12px 16px;border-bottom:1px solid #f0f0f0;break-inside:avoid;overflow-wrap:anywhere"><div style="display:flex;gap:10px"><span aria-label="${item.done ? '已完成' : '未完成'}">${item.done ? '☑' : '☐'}</span><div style="min-width:0;flex:1"><div style="font-size:15px;${item.done ? 'text-decoration:line-through;color:#8c8c8c' : ''}">${escapeHtml(item.text || '（空条目）')}</div><div>${tags.map(tag => `<span style="display:inline-block;background:#fafafa;border:1px solid #d9d9d9;border-radius:4px;padding:0 6px;margin:4px 6px 0 0;font-size:12px">${escapeHtml(tag)}</span>`).join('')}</div>${item.note ? `<div style="white-space:pre-wrap;color:#666;font-size:13px;margin-top:4px">${escapeHtml(item.note)}</div>` : ''}${bar(item.progress)}</div></div></article>`
    }).join('')
    return `<section style="border:1px solid #d9d9d9;border-radius:8px;margin:14px 0"><h2 style="font-size:15px;background:#fafafa;padding:12px 16px;margin:0;break-after:avoid">${escapeHtml(group.name)} · ${group.items.length} 项 · 已完成 ${done} 项</h2>${items}</section>`
  }).join('')
  return summary + (groups || '<p>这份待办清单还没有条目</p>')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
