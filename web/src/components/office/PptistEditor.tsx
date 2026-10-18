import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Space, message } from 'antd'
import { patchDoc } from '../../api/docs'
import { uploadWithDedup } from '../../lib/uploadFlow'
import { downloadBlob, parseNativeAttachment, parsePptxDocument } from '../../lib/office/native'
import VersionDrawer from '../editor/VersionDrawer'

interface Props { content?: string; docId?: number; title?: string; readOnly?: boolean; onSaved?: () => void }
interface Snapshot { slides: unknown[]; theme: unknown; viewportSize: number; viewportRatio: number }
const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export default function PptistEditor(props: Props) {
  // A new frame per document revision gives Vue/Pinia, history and hotkeys their own lifecycle.
  return <PptistSession key={`${props.docId ?? ''}:${props.content ?? ''}:${props.readOnly}`} {...props} />
}

function PptistSession({ content = '', docId, title = '演示文稿', readOnly = false, onSaved }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [versionOpen, setVersionOpen] = useState(false)
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout>; resolve: (data: { snapshot: Snapshot; blob: Blob }) => void; reject: (error: Error) => void } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let started = false
    const startupTimer = setTimeout(() => setError('演示文稿加载超时，请刷新重试；若组件资源缺失，请重新构建前端'), 90000)
    const post = (data: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ channel: 'haiku-pptist', ...data }, window.location.origin)
    async function load() {
      let snapshot: Snapshot | undefined
      let bytes: ArrayBuffer | undefined
      try {
        const value = JSON.parse(content)
        if (value?.schema === 'haiku.pptist/1') snapshot = value.presentation
      } catch { /* blank or historical content */ }
      const legacy = parsePptxDocument(content)
      const attachment = parseNativeAttachment(content)
      if (!snapshot && legacy) {
        const { exportPPTX } = await import('@eflink-tech/pptx')
        const exportLegacy = exportPPTX as unknown as (presentation: unknown, name: string, blob: boolean) => Promise<Blob>
        bytes = await (await exportLegacy(legacy.presentation, title, true)).arrayBuffer()
      }
      else if (!snapshot && attachment) {
        const response = await fetch(attachment.edited_url || attachment.url, { signal: controller.signal })
        if (!response.ok) throw new Error(`PPTX 文件读取失败（HTTP ${response.status}）`)
        bytes = await response.arrayBuffer()
      }
      if (!controller.signal.aborted) post({ type: 'load', title, readOnly, snapshot, bytes })
    }
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== 'haiku-pptist') return
      const data = event.data
      if (data.type === 'ready' && !started) {
        started = true
        void load().catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'PPTX 加载失败') })
      }
      if (data.type === 'loaded') { clearTimeout(startupTimer); setReady(true) }
      if (data.type === 'error') {
        if (pending.current && data.requestId === pending.current.id) pending.current.reject(new Error(data.message))
        else setError(data.message || 'PPTX 处理失败')
      }
      if (data.type === 'snapshot' && pending.current && data.requestId === pending.current.id) pending.current.resolve(data)
    }
    window.addEventListener('message', receive)
    return () => {
      controller.abort()
      clearTimeout(startupTimer)
      window.removeEventListener('message', receive)
      if (pending.current) { clearTimeout(pending.current.timer); pending.current.reject(new Error('文档已关闭')) }
    }
  }, [content, readOnly, title])

  async function save() {
    if (!docId || readOnly || !ready || busy) return
    setBusy(true)
    try {
      const result = await new Promise<{ snapshot: Snapshot; blob: Blob }>((resolve, reject) => {
        const id = crypto.randomUUID()
        const timer = setTimeout(() => reject(new Error('保存超时，请重试')), 120000)
        pending.current = { id, timer, resolve, reject }
        frame.current?.contentWindow?.postMessage({ channel: 'haiku-pptist', type: 'snapshot', requestId: id }, window.location.origin)
      })
      const filename = `${title.replace(/\.pptx$/i, '')}.pptx`
      const uploaded = await uploadWithDedup(new File([result.blob], filename, { type: MIME }))
      const source = parseNativeAttachment(content) ?? { url: uploaded.url, filename, size: uploaded.size, ext: 'pptx' }
      await patchDoc(docId, { content: JSON.stringify({ ...source, schema: 'haiku.pptist/1', edited_url: uploaded.url, presentation: result.snapshot }), source: 'manual' })
      message.success('PPT 文档已保存')
      onSaved?.()
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '保存失败') }
    finally { if (pending.current) clearTimeout(pending.current.timer); pending.current = null; setBusy(false) }
  }

  return <div style={{ width: '100%', minHeight: 660 }}>
    <Space wrap style={{ marginBottom: 12 }}>
      {!readOnly && docId ? <Button type="primary" disabled={!ready} loading={busy} onClick={() => void save()}>保存</Button> : null}
      <Button disabled={!ready || busy} onClick={() => frame.current?.contentWindow?.postMessage({ channel: 'haiku-pptist', type: 'export' }, window.location.origin)}>导出 PPTX</Button>
      {!readOnly && docId ? <Button onClick={() => setVersionOpen(true)}>历史版本</Button> : null}
      {parseNativeAttachment(content) ? <Button onClick={async () => {
        const source = parseNativeAttachment(content)!
        try { const response = await fetch(source.url); if (!response.ok) throw new Error(); downloadBlob(await response.blob(), source.filename) }
        catch { message.error('原文件下载失败') }
      }}>下载原文件</Button> : null}
    </Space>
    {error ? <Alert type="error" showIcon message="无法打开 PPT 文档" description={error} /> : null}
    <iframe ref={frame} src="/pptist/index.html" title={`${title} · ${readOnly ? '阅读' : '编辑'}`} allow="fullscreen; clipboard-read; clipboard-write" allowFullScreen style={{ width: '100%', height: 'max(620px, calc(100vh - 220px))', border: '1px solid #e5e7eb', display: error ? 'none' : 'block' }} />
    {docId ? <VersionDrawer open={versionOpen} docId={docId} title={title} docType="powerpoint" onClose={() => setVersionOpen(false)} onRolledBack={() => { setVersionOpen(false); onSaved?.() }} /> : null}
  </div>
}
