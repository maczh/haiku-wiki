import { useEffect, useRef, useState } from 'react'
import Vditor from 'vditor'
import { Button, Space, Tooltip } from 'antd'
import { HistoryOutlined, SaveOutlined } from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import { patchDoc } from '../../api/docs'
import { getToken } from '../../api/request'

interface Props {
  docId: number
  initialContent: string
  title: string
}

const SAVE_DEBOUNCE_MS = 3000 // 3s 防抖自动保存（架构文档 §五.1）

/**
 * Vditor IR 模式编辑器（Markdown + 富文本混合）：
 *  - 图片/附件上传钩子 → POST /api/uploads
 *  - 3s 防抖自动保存（source=auto），内容无变化不请求
 *  - 手动保存（source=manual）/ 历史版本抽屉
 */
export default function VditorEditor({ docId, initialContent, title }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const vdRef = useRef<Vditor | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef(initialContent)
  const lastSavedRef = useRef(initialContent)
  const dirtyRef = useRef(false)
  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)

  // docId 变化时重建编辑器
  useEffect(() => {
    latestRef.current = initialContent
    lastSavedRef.current = initialContent
    dirtyRef.current = false
    setStatus('editing')
    setSavedAt(null)

    let disposed = false
    const vd = new Vditor(elRef.current!, {
      mode: 'ir',
      value: initialContent,
      cache: { enable: false },
      counter: { enable: true },
      height: '100%',
      placeholder: '开始写作…（Markdown 与富文本混合，自动保存已开启）',
      toolbar: [
        'headings', 'bold', 'italic', 'strike', '|',
        'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
        'quote', 'line', 'code', 'inline-code', 'insert-before', 'insert-after', '|',
        'upload', 'link', 'table', '|',
        'undo', 'redo', '|', 'fullscreen', 'edit-mode', 'export',
      ],
      upload: {
        url: '/api/uploads',
        fieldName: 'file',
        max: 20 * 1024 * 1024,
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
        // 将后端统一响应转换为 Vditor 期望格式
        format(files: File[], responseText: string) {
          try {
            const res = JSON.parse(responseText)
            if (res.code === 0 && res.data?.url) {
              const succMap: Record<string, string> = {}
              for (const f of files) succMap[f.name] = res.data.url
              return JSON.stringify({ msg: '', code: 0, data: { errFiles: [], succMap } })
            }
          } catch {
            /* fallthrough */
          }
          return JSON.stringify({ msg: '上传失败', code: 1, data: { errFiles: files.map((f) => f.name) } })
        },
      },
      input: (value: string) => {
        latestRef.current = value
        dirtyRef.current = true
        setStatus('editing')
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
      },
      after: () => {
        if (!disposed) vdRef.current = vd
      },
    })

    return () => {
      disposed = true
      if (timerRef.current) clearTimeout(timerRef.current)
      // 切换文档前若有未保存内容，立即保存（fire-and-forget）
      if (dirtyRef.current && latestRef.current !== lastSavedRef.current) {
        void patchDoc(docId, { content: latestRef.current, source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
      try {
        vd.destroy()
      } catch {
        /* 已销毁 */
      }
      vdRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (latestRef.current === lastSavedRef.current && source === 'auto') return
    setStatus('saving')
    try {
      await patchDoc(docId, { content: latestRef.current, source })
      lastSavedRef.current = latestRef.current
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
      {/* 顶部状态条：保存状态 + 手动保存 + 历史版本 */}
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

      <div style={{ flex: 1, overflow: 'auto', background: '#fff' }} ref={elRef} />

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => {
          // 回滚后重新载入内容
          window.location.reload()
        }}
      />
    </div>
  )
}
