import { useEffect, useRef, useState } from 'react'
import x_spreadsheet from 'x-data-spreadsheet'
import 'x-data-spreadsheet/dist/xspreadsheet.css'
import { Button, Space, Tooltip, message } from 'antd'
import { HistoryOutlined, SaveOutlined } from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import { patchDoc } from '../../api/docs'
import { sheetToXData, xDataToSheet, parseSheetJSON, stringifySheet } from '../../lib/sheet'
import type { SheetJSON } from '../../lib/sheet'

interface Props {
  docId: number
  initialContent: string
  title: string
  docType: 'sheet' | 'datatable'
}

const SAVE_DEBOUNCE_MS = 3000 // 3s 防抖自动保存（与 VditorEditor 一致）

/**
 * x-data-spreadsheet 唯一隔离层（架构文档 I05）：
 *  - 加载/保存各一个转换函数（lib/sheet.ts），对外只暴露稳定 JSON schema
 *  - 3s 防抖 patchDoc 自动保存 + 手动保存 + 历史版本
 *  - 日后更换 Univer 只改本文件与 lib/sheet.ts，不动存储契约
 */
export default function SheetEditor({ docId, initialContent, title, docType }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<SheetJSON>(parseSheetJSON(initialContent).data)
  const dirtyRef = useRef(false)
  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)

  // docId 变化时重建表格
  useEffect(() => {
    const { data, reset } = parseSheetJSON(initialContent)
    if (reset) message.warning('内容格式异常，已重置为空表格')
    latestRef.current = data
    dirtyRef.current = false
    setStatus('editing')
    setSavedAt(null)

    const host = elRef.current
    if (!host) return
    host.innerHTML = ''
    const xs = new x_spreadsheet(host, {
      mode: 'edit',
      showToolbar: true,
      showGrid: true,
      showContextmenu: true,
      showBottomBar: false,
      view: {
        height: () => (host.clientHeight || 600) - 4,
        width: () => (host.clientWidth || 900) - 4,
      },
    })
    xs.loadData(sheetToXData(data))
    xs.change((json: { rows?: Record<number, { cells: Record<string, { text?: string }> }> }) => {
      latestRef.current = xDataToSheet(json as never)
      dirtyRef.current = true
      setStatus('editing')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
    })

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      // 切换文档前若有未保存内容，立即保存（fire-and-forget）
      if (dirtyRef.current) {
        void patchDoc(docId, { content: stringifySheet(latestRef.current), source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
      try {
        ;(xs as unknown as { destroy?: () => void }).destroy?.()
      } catch {
        /* 部分版本无 destroy，忽略 */
      }
      host.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    setStatus('saving')
    try {
      await patchDoc(docId, { content: stringifySheet(latestRef.current), source })
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

      <div ref={elRef} style={{ flex: 1, minHeight: 0 }} />

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        docType={docType}
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => {
          // 回滚后重新载入内容
          window.location.reload()
        }}
      />
    </div>
  )
}
