import { useEffect, useMemo, useRef, useState } from 'react'
import { Workbook, type WorkbookInstance } from '@fortune-sheet/react'
import type { Sheet } from '@fortune-sheet/core'
import '@fortune-sheet/react/dist/index.css'
import { Alert, App, Button, Space, Spin } from 'antd'
import { patchDoc } from '../../api/docs'
import { uploadWithDedup } from '../../lib/uploadFlow'
import { downloadBlob, parseNativeAttachment } from '../../lib/office/native'
import { fromFortune, parseFortuneContent, readXlsx, toFortune, writeXlsx } from '../../lib/office/fortune'
import type { SheetJSON } from '../../lib/sheet'
import VersionDrawer from '../editor/VersionDrawer'
import { useSheetDirty } from './useSheetDirty'
import './FortuneSheetEditor.css'

interface Props { content?: string; docId?: number; title?: string; readOnly?: boolean; onSaved?: () => void }
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export default function FortuneSheetEditor(props: Props) {
  return <SheetSession key={`${props.docId ?? ''}:${props.content ?? ''}:${props.readOnly}`} {...props} />
}

function SheetSession({ content = '', docId, title = '工作簿', readOnly = false, onSaved }: Props) {
  const { message } = App.useApp()
  const workbook = useRef<WorkbookInstance>(null)
  const latest = useRef<Sheet[] | null>(null)
  const [data, setData] = useState<SheetJSON | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { dirty, markDirty, clearDirty } = useSheetDirty(readOnly)
  const [versionOpen, setVersionOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const source = parseNativeAttachment(content)
      let hasWorkbook = false
      try { hasWorkbook = !!JSON.parse(content).workbook } catch { /* plain legacy/blank */ }
      if (source?.ext === 'xlsx' && !hasWorkbook) {
        const response = await fetch(source.edited_url || source.url, { signal: controller.signal })
        if (!response.ok) throw new Error(`XLSX 文件读取失败（HTTP ${response.status}）`)
        const next = await readXlsx(await response.arrayBuffer())
        if (!controller.signal.aborted) setData(next)
      }
      else setData(parseFortuneContent(content))
    }
    void load().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '工作簿加载失败') })
    return () => controller.abort()
  }, [content])

  const initial = useMemo(() => data ? toFortune(data) : null, [data])
  function current() {
    const sheets = workbook.current?.getAllSheets() ?? latest.current ?? initial
    if (!sheets) throw new Error('工作簿尚未加载完成')
    return fromFortune(sheets)
  }

  async function save() {
    if (!docId || readOnly || !initial || busy) return
    setBusy(true)
    try {
      const snapshot = current()
      const filename = `${title.replace(/\.xlsx$/i, '') || '工作簿'}.xlsx`
      const file = new File([await writeXlsx(snapshot)], filename, { type: MIME })
      const uploaded = await uploadWithDedup(file)
      const source = parseNativeAttachment(content) ?? { url: uploaded.url, filename, size: uploaded.size, ext: 'xlsx' }
      await patchDoc(docId, { content: JSON.stringify({ ...source, schema: 'haiku.sheet/1', editor: 'fortune-sheet', edited_url: uploaded.url, workbook: snapshot }), source: 'manual' })
      clearDirty()
      message.success('工作簿已保存')
      onSaved?.()
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '保存失败') }
    finally { setBusy(false) }
  }

  async function download() {
    if (!initial || busy) return
    setBusy(true)
    try { downloadBlob(await writeXlsx(current()), `${title.replace(/\.xlsx$/i, '') || '工作簿'}.xlsx`) }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '导出失败') }
    finally { setBusy(false) }
  }

  return <section className="haiku-excel" aria-label={`${title} · ${readOnly ? '阅读' : '编辑'}`}>
    <div className="haiku-excel-header">
      <div className="haiku-excel-title"><span className="haiku-excel-mark" aria-hidden="true">X</span><span>{title}</span><small>{readOnly ? '只读' : dirty ? '未保存' : '工作簿'}</small></div>
      <Space wrap>
        {!readOnly && docId ? <Button size="small" disabled={!initial || !!error} loading={busy} onClick={() => void save()}>保存</Button> : null}
        <Button size="small" disabled={!initial || !!error || busy} onClick={() => void download()}>导出 XLSX</Button>
        {!readOnly && docId ? <Button size="small" onClick={() => setVersionOpen(true)}>历史版本</Button> : null}
      </Space>
    </div>
    {error ? <Alert type="error" showIcon message="无法打开工作簿" description={error} /> : initial ?
      <div className="haiku-excel-grid">
        <Workbook ref={workbook} data={initial} lang="zh" allowEdit={!readOnly} showToolbar={!readOnly} showFormulaBar showSheetTabs
          {...(readOnly ? { cellContextMenu: [], headerContextMenu: [], sheetTabContextMenu: [] } : {})}
          onChange={sheets => { latest.current = sheets }} onOp={markDirty} />
      </div>
      : <Spin tip="正在读取工作簿…"><div style={{ minHeight: 480 }} /></Spin>}
    {docId ? <VersionDrawer open={versionOpen} docId={docId} title={title} docType="excel" onClose={() => setVersionOpen(false)} onRolledBack={() => { setVersionOpen(false); onSaved?.() }} /> : null}
  </section>
}
