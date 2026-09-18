import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Tooltip, message } from 'antd'
import { DeleteOutlined, EditOutlined, HistoryOutlined, NodeIndexOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import GanttChart from '../gantt/GanttChart'
import type { IApi } from '@svar-ui/react-gantt'
import { listTeamMembers } from '../../api/teams'
import { patchDoc } from '../../api/docs'
import { clampPriority, resolveSvarTask, todayIso, ganttFromContent, stringifyGantt, type GanttJSON } from '../../lib/gantt'

interface Props {
  docId: number
  initialContent: string
  title: string
  /** 团队文库 id：用于拉取团队成员作为负责人候选；个人库为空时仍可自由输入 */
  teamId?: number | null
}

const SAVE_DEBOUNCE_MS = 3000

interface TaskFormValues {
  text: string
  assignees?: string[]
  priority: number
  details?: string
  start: Dayjs
  duration: number
  progress: number
}

/** 甘特图编辑器：可增删任务/子任务、改期、改进度、连依赖；自动保存节奏同其余编辑器。 */
export default function GanttEditor({ docId, initialContent, title, teamId }: Props) {
  const latestRef = useRef<GanttJSON>(ganttFromContent(initialContent).data)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apiRef = useRef<IApi | null>(null)
  const selectedRef = useRef<string | number | null>(null)
  const [selected, setSelected] = useState<string | number | null>(null)
  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const [form] = Form.useForm<TaskFormValues>()
  /** modal: null 关闭 | 'add' 同级 | 'child' 子任务 | 'edit' 编辑选中 */
  const [modal, setModal] = useState<null | 'add' | 'child' | 'edit'>(null)
  const [memberOptions, setMemberOptions] = useState<{ value: string }[]>([])
  const [savingTask, setSavingTask] = useState(false)

  useEffect(() => {
    const { data, reset } = ganttFromContent(initialContent)
    if (reset) message.warning('内容格式异常，已重置为空白甘特图')
    latestRef.current = data
    dirtyRef.current = false
    setStatus('editing')
    setSavedAt(null)
    setSelected(null)
    selectedRef.current = null
  }, [docId, initialContent])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (dirtyRef.current) {
        void patchDoc(docId, { content: stringifyGantt(latestRef.current), source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
    },
    [docId],
  )

  // 负责人候选：团队成员（拉不到就只靠自由输入，Select tags 模式不依赖候选）
  useEffect(() => {
    let alive = true
    if (!teamId) {
      setMemberOptions([])
      return
    }
    listTeamMembers(teamId)
      .then((ms) => {
        if (!alive) return
        const seen = new Set<string>()
        const opts: { value: string }[] = []
        for (const m of ms ?? []) {
          const name = (m.nickname || m.name || m.username || '').trim()
          if (!name || seen.has(name)) continue
          seen.add(name)
          opts.push({ value: name })
        }
        setMemberOptions(opts)
      })
      .catch(() => alive && setMemberOptions([]))
    return () => {
      alive = false
    }
  }, [teamId])

  const handleApi = useCallback((api: IApi | null) => {
    apiRef.current = api
    if (!api) return
    api.on('select-task', (ev: { id?: string | number }) => {
      selectedRef.current = ev?.id ?? null
      setSelected(ev?.id ?? null)
    })
  }, [])

  function handleChange(next: GanttJSON) {
    latestRef.current = next
    dirtyRef.current = true
    setStatus('editing')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
  }

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    setStatus('saving')
    try {
      await patchDoc(docId, { content: stringifyGantt(latestRef.current), source })
      dirtyRef.current = false
      const now = new Date()
      setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
      setStatus('saved')
    } catch {
      setStatus('editing')
    }
  }

  /** 打开任务弹窗（mode 决定提交行为） */
  function openTaskModal(mode: 'add' | 'child' | 'edit') {
    const api = apiRef.current
    if (mode === 'edit') {
      const sel = selectedRef.current
      if (!api || sel == null) {
        message.info('请先选中要编辑的任务')
        return
      }
      const t = resolveSvarTask(api, sel) as Record<string, unknown> | null
      const startRaw = t?.start
      const start = startRaw instanceof Date ? dayjs(startRaw) : dayjs(`${todayIso()}T00:00:00`)
      form.setFieldsValue({
        text: typeof t?.text === 'string' ? t.text : '',
        assignees: Array.isArray(t?.assignees) ? (t?.assignees as string[]) : [],
        priority: clampPriority(t?.priority),
        details: typeof t?.details === 'string' ? t.details : '',
        start,
        duration: Math.max(0, Number(t?.duration ?? 3)),
        progress: Math.max(0, Math.min(100, Number(t?.progress ?? 0))),
      })
    } else {
      form.setFieldsValue({ text: '', assignees: [], priority: 5, details: '', start: dayjs(`${todayIso()}T00:00:00`), duration: 3, progress: 0 })
    }
    setModal(mode)
  }

  /**
   * 提交弹窗：
   * - add/child：先给非 summary 父任务转 summary，再 add-task；
   * - edit：update-task 全量更新名称/负责人/描述/开始/工期/进度。
   */
  async function submitTask(values: TaskFormValues) {
    const api = apiRef.current
    if (!api || !modal) return
    const task = {
      text: values.text.trim() || '新任务',
      assignees: (values.assignees ?? []).map((a) => a.trim()).filter(Boolean),
      priority: clampPriority(values.priority),
      details: (values.details ?? '').trim(),
      start: values.start.toDate(),
      duration: Math.max(0, Math.round(values.duration || 0)),
      progress: Math.max(0, Math.min(100, Math.round(values.progress || 0))),
    }
    setSavingTask(true)
    try {
      if (modal === 'edit') {
        const sel = selectedRef.current
        if (sel == null) return
        const t = resolveSvarTask(api, sel) as Record<string, unknown> | null
        const isMilestone = t?.type === 'milestone'
        await api.exec('update-task', {
          id: sel,
          task: {
            text: task.text,
            assignees: task.assignees,
            priority: task.priority,
            details: task.details,
            start: task.start,
            duration: isMilestone ? 0 : task.duration,
            progress: task.progress,
          },
        })
      } else if (modal === 'child') {
        const sel = selectedRef.current
        if (!sel) {
          message.info('请先选中一个任务，再新增子任务')
          return
        }
        const parent = resolveSvarTask(api, sel) as Record<string, unknown> | null
        if (parent && parent.type !== 'summary') {
          await api.exec('update-task', { id: sel, task: { type: 'summary' } })
        }
        await api.exec('add-task', { task, target: sel, mode: 'child', show: true })
      } else {
        const sel = selectedRef.current
        await api.exec('add-task', { task, target: sel ?? undefined, mode: sel ? 'after' : undefined, show: true })
      }
      setModal(null)
      // 编辑信息不触发 add/delete 等动作事件？update-task 已由 GanttChart 内监听回读
    } finally {
      setSavingTask(false)
    }
  }

  async function removeTask() {
    const api = apiRef.current
    const sel = selectedRef.current
    if (!api || sel == null) {
      message.info('请先选中要删除的任务')
      return
    }
    await api.exec('delete-task', { id: sel })
  }

  function scrollToToday() {
    apiRef.current?.exec('scroll-chart', { date: new Date() })
  }

  const modalTitle =
    modal === 'edit' ? '编辑任务' : modal === 'child' ? '新增子任务' : '新增任务'

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          minHeight: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
          borderBottom: '1px solid #ebedf0',
          background: '#fff',
        }}
      >
        <SaveIndicator status={status} savedAt={savedAt} />
        <Space size={8}>
          <Tooltip title="填写名称、负责人与描述后新增一个同级任务">
            <Button size="small" icon={<PlusOutlined />} onClick={() => openTaskModal('add')}>
              新增任务
            </Button>
          </Tooltip>
          <Tooltip title="在选中任务下新增子任务（父任务自动转为汇总任务）">
            <Button size="small" icon={<NodeIndexOutlined />} onClick={() => openTaskModal('child')}>
              新增子任务
            </Button>
          </Tooltip>
          <Tooltip title="编辑选中任务的名称、负责人、描述、时间与进度">
            <Button size="small" icon={<EditOutlined />} disabled={selected == null} onClick={() => openTaskModal('edit')}>
              编辑信息
            </Button>
          </Tooltip>
          <Tooltip title="删除选中任务（含其子任务）">
            <Button size="small" icon={<DeleteOutlined />} disabled={selected == null} onClick={() => void removeTask()}>
              删除
            </Button>
          </Tooltip>
          <Button size="small" onClick={scrollToToday}>
            回到今天
          </Button>
        </Space>
        <div style={{ flex: 1 }} />
        <Space size={8}>
          <Tooltip title="立即保存（生成手动版本快照）">
            <Button size="small" icon={<SaveOutlined />} onClick={() => void doSave('manual')}>
              保存
            </Button>
          </Tooltip>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => setVersionOpen(true)}>
            历史版本
          </Button>
        </Space>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
        <GanttChart
          key={docId}
          value={latestRef.current}
          mode="edit"
          onChange={handleChange}
          onApi={handleApi}
        />
      </div>

      <Modal
        open={modal != null}
        title={modalTitle}
        okText={modal === 'edit' ? '保存' : '新增'}
        cancelText="取消"
        confirmLoading={savingTask}
        onOk={() => void form.submit()}
        onCancel={() => setModal(null)}
        forceRender
        width={480}
      >
        <FormWrapper form={form} memberOptions={memberOptions} isEdit={modal === 'edit'} onFinish={(v) => void submitTask(v)} />
      </Modal>

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        docType="gantt"
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => window.location.reload()}
      />
    </div>
  )
}

/** 弹窗表单体：名称 / 负责人（多选+自由输入）/ 描述 / 开始 / 工期 / 进度 */
function FormWrapper({
  form,
  memberOptions,
  isEdit,
  onFinish,
}: {
  form: ReturnType<typeof Form.useForm<TaskFormValues>>[0]
  memberOptions: { value: string }[]
  isEdit: boolean
  onFinish: (values: TaskFormValues) => void
}) {
  return (
    <Form form={form} layout="vertical" preserve={false} onFinish={onFinish}>
      <Form.Item name="text" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
        <Input placeholder="例如：接口联调" maxLength={100} />
      </Form.Item>
      <Form.Item
        name="assignees"
        label="负责人（可多选，支持直接输入新名字）"
        tooltip="候选来自团队成员；也可以直接键入任意名字回车创建"
      >
        <Select
          mode="tags"
          tokenSeparators={[',', '，']}
          placeholder="选择团队成员或直接输入名字"
          options={memberOptions}
          allowClear
          maxTagCount={6}
        />
      </Form.Item>
      <Form.Item name="priority" label="优先级" tooltip="1 最低 ~ 10 最高；进度条上下外框颜色随优先级加深">
        <Select
          options={Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: `P${i + 1}` }))}
          placeholder="P1 ~ P10"
        />
      </Form.Item>
      <Form.Item name="details" label="任务描述" tooltip="保存后悬停任务条即可查看">
        <Input.TextArea rows={3} maxLength={500} showCount placeholder="补充背景、验收标准、链接等" />
      </Form.Item>
      <Space size={12} style={{ display: 'flex' }}>
        <Form.Item name="start" label="开始日期" rules={[{ required: true, message: '请选择开始日期' }]}>
          <DatePicker allowClear={false} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name="duration" label="工期（天）" rules={[{ required: true, message: '请输入工期' }]}>
          <InputNumber min={0} max={3650} precision={0} style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="progress" label="进度（%）">
          <InputNumber min={0} max={100} precision={0} style={{ width: 100 }} />
        </Form.Item>
      </Space>
      {isEdit && (
        <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: -6 }}>
          提示：拖动任务条可改期，拖动条上的圆形手柄可调整进度。
        </div>
      )}
    </Form>
  )
}
