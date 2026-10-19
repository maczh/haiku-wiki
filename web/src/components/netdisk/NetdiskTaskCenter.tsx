/**
 * 网盘任务中心（抽屉）：上传 / 导入的进度、取消、重试。
 *
 * 轮询策略：有 pending/running 时 2s 一次，全终态后停止
 * （后端返回的 running 计数就是判据，不必自己再算一遍）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Drawer, Empty, Progress, Tag, message } from 'antd'
import { cancelTask, listTasks, retryTask } from '../../api/netdisk'
import { formatPercent, formatSize, formatTime, taskStatusColor, taskStatusLabel, taskTypeLabel } from '../../lib/netdisk/format'
import type { NetdiskTask, NetdiskTaskStatus } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  /** 只显示某个连接的任务（网盘页打开时传） */
  connId?: number
  /** 任务成功时通知外层刷新目录 */
  onTaskDone?: (task: NetdiskTask) => void
}

const TERMINAL: NetdiskTaskStatus[] = ['success', 'failed', 'canceled']

export default function NetdiskTaskCenter({ open, onClose, connId, onTaskDone }: Props) {
  const [tasks, setTasks] = useState<NetdiskTask[]>([])
  const [running, setRunning] = useState(0)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listTasks({ connId, limit: 100 })
      setTasks(res.items)
      setRunning(res.running)
    } catch {
      /* request 拦截器已提示 */
    } finally {
      setLoading(false)
    }
  }, [connId])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  // 有任务在跑才轮询，全终态即停
  useEffect(() => {
    if (!open || running <= 0) return
    const timer = window.setInterval(() => void load(), 2000)
    return () => window.clearInterval(timer)
  }, [open, running, load])

  // 任务刚变 success → 通知外层刷新目录（用 ref 存上一次快照，避免 setState 抖动）
  const prevRef = useRef<Map<number, NetdiskTaskStatus>>(new Map())
  useEffect(() => {
    for (const t of tasks) {
      const before = prevRef.current.get(t.id)
      if (t.status === 'success' && before && before !== 'success') onTaskDone?.(t)
    }
    const next = new Map<number, NetdiskTaskStatus>()
    for (const t of tasks) next.set(t.id, t.status)
    prevRef.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks])

  async function handleRetry(id: number) {
    try {
      await retryTask(id)
      void load()
    } catch {
      /* request 拦截器已提示 */
    }
  }

  async function handleCancel(id: number) {
    try {
      await cancelTask(id)
      void load()
    } catch {
      /* request 拦截器已提示 */
    }
  }

  return (
    <Drawer
      open={open}
      title="网盘任务中心"
      width={420}
      onClose={onClose}
      extra={
        <Button size="small" onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      }
    >
      {tasks.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无上传 / 导入任务" />
      ) : (
        tasks.map((t) => (
          <div className="hk-nd-task-item" key={t.id} data-testid="hk-netdisk-task">
            <div className="hk-nd-task-head">
              <Tag color={taskStatusColor(t.status)}>{taskStatusLabel(t.status)}</Tag>
              <span style={{ color: '#8a919f' }}>{taskTypeLabel(t.type)}</span>
              <span className="hk-nd-task-name" title={t.file_name}>
                {t.file_name}
              </span>
            </div>
            <Progress
              percent={t.progress || 0}
              size="small"
              status={
                t.status === 'failed'
                  ? 'exception'
                  : t.status === 'success'
                    ? 'success'
                    : t.status === 'canceled'
                      ? 'normal'
                      : 'active'
              }
              style={{ margin: '6px 0 2px' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: '#8a919f' }}>
              <span>
                {formatPercent(t.progress)}
        {t.total_bytes > 0 ? ` · ${formatSize(t.done_bytes)} / ${formatSize(t.total_bytes)}` : ''}
              </span>
              <span style={{ marginLeft: 'auto' }}>
                {t.status === 'failed' && t.can_retry && (
                  <Button type="link" size="small" onClick={() => handleRetry(t.id)}>
                    重试
                  </Button>
                )}
                {!TERMINAL.includes(t.status) && (
                  <Button type="link" size="small" danger onClick={() => handleCancel(t.id)}>
                    取消
                  </Button>
                )}
                {t.status === 'failed' && t.error && (
                  <span style={{ color: '#cf1322', marginLeft: 4 }} title={t.error}>
                    {t.error.slice(0, 24)}
                  </span>
                )}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#bfbfbf' }}>{formatTime(t.updated_at)}</div>
          </div>
        ))
      )}
    </Drawer>
  )
}
