import { useEffect, useRef, useState } from 'react'
import { Button, Space, Tooltip, message } from 'antd'
import { HistoryOutlined, SaveOutlined } from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import CalendarBoard from '../calendar/CalendarBoard'
import { patchDoc } from '../../api/docs'
import { parseCalendarJSON, stringifyCalendar, type CalendarJSON } from '../../lib/calendar'

interface Props {
  docId: number
  initialContent: string
  title: string
}

const SAVE_DEBOUNCE_MS = 3000

/** 工作日历编辑器：与待办清单共用同一套自动保存/版本快照节奏。 */
export default function CalendarEditor({ docId, initialContent, title }: Props) {
  const latestRef = useRef<CalendarJSON>(parseCalendarJSON(initialContent).data)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [data, setData] = useState<CalendarJSON>(latestRef.current)
  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)

  useEffect(() => {
    const { data: parsed, reset } = parseCalendarJSON(initialContent)
    if (reset) message.warning('内容格式异常，已重置为空白日历')
    latestRef.current = parsed
    setData(parsed)
    dirtyRef.current = false
    setStatus('editing')
    setSavedAt(null)
  }, [docId, initialContent])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (dirtyRef.current) {
        void patchDoc(docId, { content: stringifyCalendar(latestRef.current), source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
    },
    [docId],
  )

  function handleChange(next: CalendarJSON) {
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
      await patchDoc(docId, { content: stringifyCalendar(latestRef.current), source })
      dirtyRef.current = false
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
        <CalendarBoard value={data} onChange={handleChange} />
      </div>

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        docType="calendar"
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => window.location.reload()}
      />
    </div>
  )
}
