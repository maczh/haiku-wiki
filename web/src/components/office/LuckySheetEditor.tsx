import { useEffect, useRef, useState } from 'react'
import '../../lib/luckysheetTouchShim'
import luckysheet from 'luckysheet'
import 'luckysheet/dist/css/luckysheet.css'
import 'luckysheet/dist/assets/iconfont/iconfont.css'
import { Alert, Button, Space, Spin, message } from 'antd'
import { patchDoc } from '../../api/docs'
import {
  luckysheetToSheetJSON,
  parseSheetJSON,
  sheetsToLuckysheet,
  stringifySheet,
  type SheetJSON,
} from '../../lib/sheet'
import VersionDrawer from '../editor/VersionDrawer'
import { parseNativeAttachment } from '../../lib/office/native'
import { xlsxFileToLuckysheetContent } from '../../lib/import/parse'
import { downloadBlob } from '../../lib/office/native'

interface LuckysheetApi {
  create(options: Record<string, unknown>): void
  destroy(): void
  getAllSheets(): unknown
  resize?(): void
}

interface Props {
  content?: string
  docId?: number
  title?: string
  readOnly?: boolean
  onSaved?: () => void
}

let sequence = 0

export default function LuckySheetEditor({ content = '', docId, title = '工作簿', readOnly = false, onSaved }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef<SheetJSON>(parseSheetJSON(content).data)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [resolvedContent, setResolvedContent] = useState<string | null>(() => {
    const source = parseNativeAttachment(content)
    return source?.ext === 'xlsx' ? null : content
  })

  useEffect(() => {
    const source = parseNativeAttachment(content)
    const controller = new AbortController()
    try {
      const value = JSON.parse(content) as { schema?: string; workbook?: unknown }
      if (value.schema === 'haiku.sheet/1' && value.workbook) {
        setResolvedContent(JSON.stringify(value.workbook))
        return () => controller.abort()
      }
    } catch {
      // Plain Luckysheet JSON and blank documents continue below.
    }
    if (!source || source.ext !== 'xlsx') {
      setResolvedContent(content)
      return () => controller.abort()
    }
    setResolvedContent(null)
    void fetch(source.edited_url || source.url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`XLSX 文件读取失败（HTTP ${response.status}）`)
        return response.blob()
      })
      .then((blob) => xlsxFileToLuckysheetContent(new File([blob], source.filename || 'workbook.xlsx', { type: blob.type })))
      .then(setResolvedContent)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'XLSX 文件解析失败')
      })
    return () => controller.abort()
  }, [content])

  useEffect(() => {
    const host = hostRef.current
    if (!host || resolvedContent == null) return
    const parsed = parseSheetJSON(resolvedContent)
    latestRef.current = parsed.data
    setError(parsed.reset ? '表格内容无法识别，已使用空工作簿保护原内容' : '')
    host.innerHTML = ''
    const container = document.createElement('div')
    container.id = `haiku-luckysheet-${docId ?? 'reader'}-${++sequence}`
    container.style.cssText = 'width:100%;height:100%'
    host.appendChild(container)
    const api = luckysheet as unknown as LuckysheetApi
    ;(window as unknown as { luckysheet?: unknown }).luckysheet = api
    const capture = () => {
      if (readOnly) return
      try { latestRef.current = luckysheetToSheetJSON(api.getAllSheets()) } catch { /* keep last valid copy */ }
    }
    try {
      api.create({
        container: container.id,
        lang: 'zh',
        title: '',
        showinfobar: false,
        showtoolbar: !readOnly,
        showsheetbar: true,
        showstatisticBar: true,
        sheetFormulaBar: !readOnly,
        allowEdit: !readOnly,
        allowCopy: true,
        enableAddRow: !readOnly,
        data: sheetsToLuckysheet(parsed.data),
        hook: {
          updated: capture,
          cellUpdated: capture,
          rangePasteAfter: capture,
          sheetAdd: capture,
          sheetDelete: capture,
          sheetCopy: capture,
          sheetMoveAfter: capture,
        },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Luckysheet 初始化失败')
    }
    const requestResize = () => {
      api.resize?.()
      window.dispatchEvent(new Event('resize'))
    }
    const frame = requestAnimationFrame(requestResize)
    const resizeTimer = window.setTimeout(requestResize, 120)
    const observer = new ResizeObserver(requestResize)
    observer.observe(host)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(resizeTimer)
      observer.disconnect()
      try { api.destroy() } catch { /* already disposed */ }
      host.innerHTML = ''
    }
  }, [resolvedContent, docId, readOnly])

  async function save() {
    if (!docId || readOnly || busy) return
    setBusy(true)
    try {
      const api = luckysheet as unknown as LuckysheetApi
      latestRef.current = luckysheetToSheetJSON(api.getAllSheets())
      const attachment = parseNativeAttachment(content)
      const nextContent = attachment
        ? JSON.stringify({ schema: 'haiku.sheet/1', ...attachment, workbook: latestRef.current })
        : stringifySheet(latestRef.current)
      await patchDoc(docId, { content: nextContent, source: 'manual' })
      message.success('Excel 文档已保存')
      onSaved?.()
    } catch {
      message.error('Excel 文档保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function exportXlsx() {
    if (busy) return
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const api = luckysheet as unknown as LuckysheetApi
      const workbookData = luckysheetToSheetJSON(api.getAllSheets())
      const workbook = XLSX.utils.book_new()
      for (const [sheetIndex, sheet] of workbookData.sheets.entries()) {
        const rows: unknown[][] = []
        for (const cell of sheet.celldata ?? []) {
          if (!rows[cell.r]) rows[cell.r] = []
          const value = cell.v && typeof cell.v === 'object'
            ? (cell.v as { v?: unknown }).v
            : cell.v
          rows[cell.r][cell.c] = value ?? ''
        }
        const worksheet = XLSX.utils.aoa_to_sheet(rows)
        for (const cell of sheet.celldata ?? []) {
          if (!cell.v || typeof cell.v !== 'object') continue
          const formula = (cell.v as { f?: unknown }).f
          if (typeof formula !== 'string' || !formula.trim()) continue
          const address = XLSX.utils.encode_cell({ r: cell.r, c: cell.c })
          const existing = worksheet[address] ?? { t: 'n' as const }
          worksheet[address] = { ...existing, f: formula.replace(/^=/, '') }
        }
        XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name || `Sheet${sheetIndex + 1}`)
      }
      const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
      downloadBlob(
        new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `${title.replace(/[\\/:*?"<>|]/g, '_') || '工作簿'}.xlsx`,
      )
    } catch {
      message.error('Excel 文档导出失败')
    } finally {
      setBusy(false)
    }
  }

  return <div style={{ height: '100%', minHeight: 520, display: 'flex', flexDirection: 'column' }}>
    <Space style={{ paddingBottom: 12 }}>
      {!readOnly && docId ? <Button type="primary" loading={busy} onClick={() => void save()}>保存</Button> : null}
      <Button loading={busy} onClick={() => void exportXlsx()}>导出 XLSX</Button>
      {!readOnly && docId ? <Button onClick={() => setVersionOpen(true)}>历史版本</Button> : null}
    </Space>
    {error ? <Alert type="warning" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
    {resolvedContent == null
      ? <Spin tip="正在解析 XLSX…"><div style={{ minHeight: 480 }} /></Spin>
      : <div ref={hostRef} style={{ flex: 1, minHeight: 480, position: 'relative', overflow: 'hidden' }} />}
    {docId ? <VersionDrawer open={versionOpen} docId={docId} title={title} docType="excel" onClose={() => setVersionOpen(false)} onRolledBack={() => { setVersionOpen(false); onSaved?.() }} /> : null}
  </div>
}

