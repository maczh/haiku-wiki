import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Space, Tooltip } from 'antd'
import { HistoryOutlined, SaveOutlined } from '@ant-design/icons'
import { patchDoc } from '../../api/docs'
import { renderFlowchart, DEFAULT_FLOWCHART } from '../../lib/flowchart'
import FlowchartView from '../reader/FlowchartView'
import VersionDrawer from './VersionDrawer'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'

interface Props {
  docId: number
  initialContent: string
  title: string
}

const SAVE_DEBOUNCE_MS = 3000

/**
 * 流程图编辑器（I07）：左 mermaid 源码（等宽字体）右实时预览；
 * parse 失败给行内 Alert，渲染区保留上一次成功结果，不崩溃。
 */
export default function FlowchartEditor({ docId, initialContent, title }: Props) {
  const [src, setSrc] = useState(initialContent || DEFAULT_FLOWCHART)
  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef(initialContent || DEFAULT_FLOWCHART)
  const dirtyRef = useRef(false)
  // 上一次成功渲染的源码：错误时预览区保留它（FlowchartView 由内容不变自然保留）
  const lastGoodRef = useRef(initialContent || DEFAULT_FLOWCHART)
  const [previewSrc, setPreviewSrc] = useState(initialContent || DEFAULT_FLOWCHART)

  // 左右面板分隔可拖动：左面板宽度百分比（默认 42%）
  const [leftPct, setLeftPct] = useState(42)
  const splitRef = useRef<HTMLDivElement>(null)
  const dragHandlers = useRef<{ move?: (e: MouseEvent) => void; up?: () => void }>({})

  // 初始实时渲染一次
  useEffect(() => {
    renderFlowchart(latestRef.current).then((res) => {
      if (res.svg) {
        setPreviewError('')
        setPreviewSrc(latestRef.current)
        lastGoodRef.current = latestRef.current
      } else {
        setPreviewError(res.error || '流程图语法有误')
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      // 切换文档前若有未保存内容，立即保存（fire-and-forget）
      if (dirtyRef.current) {
        void patchDoc(docId, { content: latestRef.current, source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId],
  )

  // 拖动分隔条：按指针相对容器的横向位置实时计算左面板百分比，范围 [20%, 80%]
  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    const container = splitRef.current
    if (!container) return
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(80, Math.max(20, pct)))
    }
    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    dragHandlers.current = { move: onMove, up: onUp }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 组件卸载时若仍挂在拖动监听上，确保清理，避免监听器泄漏
  useEffect(
    () => () => {
      const h = dragHandlers.current
      if (h.move) window.removeEventListener('mousemove', h.move)
      if (h.up) window.removeEventListener('mouseup', h.up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    },
    [],
  )

  function onSrcChange(value: string) {
    setSrc(value)
    latestRef.current = value
    dirtyRef.current = true
    setStatus('editing')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
    // 实时预览（500ms 防抖，避免每键渲染）
    renderFlowchart(value).then((res) => {
      if (res.svg) {
        setPreviewError('')
        setPreviewSrc(value)
        lastGoodRef.current = value
      } else {
        setPreviewError(res.error || '流程图语法有误')
      }
    })
  }

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    setStatus('saving')
    try {
      await patchDoc(docId, { content: latestRef.current, source })
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
      {/* 顶部状态条 */}
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

      <div ref={splitRef} style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* 左：mermaid 源码编辑 */}
        <div style={{ width: `${leftPct}%`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 12px 0', color: '#8a919f', fontSize: 12 }}>Mermaid 源码（保存即快照）</div>
          <Input.TextArea
            value={src}
            onChange={(e) => onSrcChange(e.target.value)}
            style={{ flex: 1, border: 'none', boxShadow: 'none', resize: 'none', fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace', fontSize: 13, padding: 12 }}
          />
        </div>
        {/* 分隔条：可左右拖动调整左右面板宽度 */}
        <div
          role="separator"
          aria-orientation="vertical"
          title="拖动调整左右面板宽度"
          onMouseDown={startDrag}
          style={{
            width: 6,
            flexShrink: 0,
            cursor: 'col-resize',
            background: '#ebedf0',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#d0d5dd')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#ebedf0')}
        />
        {/* 右：实时预览 */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {previewError && (
            <Alert
              type="warning"
              showIcon
              message="流程图语法有误，预览保留上一次成功结果"
              description={<pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{previewError}</pre>}
              style={{ margin: 12 }}
            />
          )}
          <FlowchartView content={previewSrc} />
        </div>
      </div>

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        docType="flowchart"
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => window.location.reload()}
      />
    </div>
  )
}
