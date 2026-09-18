import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Tag } from 'antd'
import GanttChart from '../gantt/GanttChart'
import { patchDoc } from '../../api/docs'
import { ganttFromContent, stringifyGantt, type GanttJSON } from '../../lib/gantt'

interface Props {
  content: string
  /** 有值时阅读态的进度改动会落库（需要用户对文档有写权限） */
  docId?: number
  /** 当前用户是否有写权限：有 → 只允许改进度；无 → 完全只读 */
  progressEditable?: boolean
}

const SAVE_DEBOUNCE_MS = 3000

/**
 * 甘特图阅读视图。
 *
 * 权限分两档（对应需求「团队成员可以新增任务、子任务、改进度等，阅读模式下只能改进度」）：
 * - 有写权限：阅读态仍可拖动条形上的进度手柄更新进度，但不能增删任务/改期/连依赖
 * - 无写权限（含分享页）：完全只读
 */
export default function GanttView({ content, docId, progressEditable = false }: Props) {
  const parsed = useMemo(() => ganttFromContent(content), [content])
  const [data] = useState<GanttJSON>(() => parsed.data)
  const latestRef = useRef<GanttJSON>(parsed.data)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canSave = !!docId && progressEditable

  useEffect(() => {
    latestRef.current = parsed.data
  }, [parsed])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (canSave && dirtyRef.current && docId) {
        void patchDoc(docId, { content: stringifyGantt(latestRef.current), source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
    },
    [docId, canSave],
  )

  function handleChange(next: GanttJSON) {
    latestRef.current = next
    if (!canSave || !docId) return
    dirtyRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (!docId) return
      void patchDoc(docId, { content: stringifyGantt(latestRef.current), source: 'auto' })
        .then(() => {
          dirtyRef.current = false
        })
        .catch(() => undefined)
    }, SAVE_DEBOUNCE_MS)
  }

  return (
    <div style={{ padding: '0 24px 24px' }}>
      {canSave ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 12px' }}>
          <Tag color="blue">阅读模式：仅可拖动进度条更新进度</Tag>
          <span style={{ color: '#8a919f', fontSize: 12 }}>需要增删任务或调整排期，请切换到编辑模式</span>
        </div>
      ) : (
        <div style={{ padding: '8px 0 12px' }}>
          <Tag>只读</Tag>
        </div>
      )}
      {parsed.reset && (
        <Alert type="warning" showIcon message="甘特图内容格式无法识别，已按空白图显示" style={{ marginBottom: 12 }} />
      )}
      <div style={{ height: 'min(72vh, 760px)', minHeight: 420, border: '1px solid #ebedf0', borderRadius: 8, overflow: 'hidden' }}>
        <GanttChart
          key={docId ?? 'share'}
          value={data}
          mode={canSave ? 'progress' : 'readonly'}
          onChange={handleChange}
        />
      </div>
    </div>
  )
}
