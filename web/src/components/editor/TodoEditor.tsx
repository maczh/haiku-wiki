import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Button, Space, Tooltip, message } from 'antd'
import { CopyOutlined, HistoryOutlined, SaveOutlined } from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import TodoBoard from '../todo/TodoBoard'
import { saveTodoOptions, type TodoOption } from '../../api/todo'
import { patchDoc } from '../../api/docs'
import { parseTodoJSON, stringifyTodo, type TodoJSON } from '../../lib/todo'

interface Props {
  docId: number
  initialContent: string
  title: string
  onSaveAs: () => void
}

export interface TodoEditorHandle {
  getContent: () => string
}

/** 自动保存防抖（与 SheetEditor / TypoMdEditor 保持一致的 3s） */
const SAVE_DEBOUNCE_MS = 3000

async function persistTodo(docId: number, snapshot: TodoJSON, source: 'auto' | 'manual') {
  await patchDoc(docId, { content: stringifyTodo(snapshot), source })
  const options: TodoOption[] = snapshot.items.flatMap(it => [
    ...it.assignees.map(name => ({ kind: 'assignee' as const, name: name.trim() })),
    ...(it.project.trim() ? [{ kind: 'project' as const, name: it.project.trim() }] : []),
  ])
  await saveTodoOptions([...new Map(options.map(o => [`${o.kind}:${o.name}`, o])).values()])
}

/**
 * 待办清单编辑器：3s 防抖自动保存 + 手动保存（生成版本快照）+ 历史版本。
 * 变更后立即重置计时器，避免连续输入期间反复落库。
 */
const TodoEditor = forwardRef<TodoEditorHandle, Props>(function TodoEditor({ docId, initialContent, title, onSaveAs }, ref) {
  const latestRef = useRef<TodoJSON>(parseTodoJSON(initialContent).data)
  useImperativeHandle(ref, () => ({ getContent: () => stringifyTodo(latestRef.current) }), [])
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [data, setData] = useState<TodoJSON>(latestRef.current)
  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)

  useEffect(() => {
    const { data: parsed, reset } = parseTodoJSON(initialContent)
    if (reset) message.warning('内容格式异常，已重置为空白清单')
    latestRef.current = parsed
    setData(parsed)
    dirtyRef.current = false
    setStatus('editing')
    setSavedAt(null)
  }, [docId, initialContent])

  // 卸载（切换文档）时把未保存内容立刻落库，避免丢改动
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (dirtyRef.current) {
        void persistTodo(docId, latestRef.current, 'auto').catch(() => undefined)
        dirtyRef.current = false
      }
    },
    [docId],
  )

  function handleChange(next: TodoJSON) {
    setData(next)
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
      const snapshot = latestRef.current
      await persistTodo(docId, snapshot, source)
      dirtyRef.current = latestRef.current !== snapshot
      if (dirtyRef.current) { setStatus('editing'); return }
      const now = new Date()
      setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
      setStatus('saved')
    } catch {
      setStatus('editing')
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          height: 44,
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
        <div style={{ flex: 1 }} />
        <Space size={8}>
          <Button size="small" icon={<CopyOutlined aria-hidden="true" />} onClick={onSaveAs}>
            另存为
          </Button>
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

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: 20 }}>
        <TodoBoard value={data} onChange={handleChange} />
      </div>

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        docType="todo"
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => window.location.reload()}
      />
    </div>
  )
})

export default TodoEditor
