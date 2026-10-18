import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Space, Spin, message } from 'antd'
import { DocxEditor as Editor, type DocxEditorRef } from '@docx-editor.dev/react'
import '@docx-editor.dev/core/styles/editor.css'
import { patchDoc } from '../../api/docs'
import { uploadWithDedup } from '../../lib/uploadFlow'
import { downloadBlob, parseNativeAttachment } from '../../lib/office/native'
import VersionDrawer from '../editor/VersionDrawer'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

interface Props {
  content?: string
  docId?: number
  title?: string
  readOnly?: boolean
  onSaved?: () => void
}

export default function DocxOfficeEditor({ content = '', docId, title = '文档', readOnly = false, onSaved }: Props) {
  const editorRef = useRef<DocxEditorRef>(null)
  const [documentSource, setDocumentSource] = useState<ArrayBuffer | 'blank' | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const sourceRef = parseNativeAttachment(content)

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    setDocumentSource(null)
    const url = sourceRef?.edited_url || sourceRef?.url
    if (!url) {
      setDocumentSource('blank')
      return () => controller.abort()
    }
    void fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`DOCX 文件读取失败（HTTP ${response.status}）`)
        return response.arrayBuffer()
      })
      .then((buffer) => setDocumentSource(buffer))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'DOCX 文件读取失败')
      })
    return () => controller.abort()
  }, [sourceRef?.edited_url, sourceRef?.url])

  async function currentBlob() {
    const bytes = await editorRef.current?.save()
    if (!bytes) throw new Error('DOCX 编辑器尚未准备完成')
    return new Blob([bytes], { type: DOCX_MIME })
  }

  async function save() {
    if (!docId || readOnly || busy) return
    setBusy(true)
    try {
      const blob = await currentBlob()
      const filename = `${title.replace(/\.docx$/i, '') || 'document'}.docx`
      const uploaded = await uploadWithDedup(new File([blob], filename, { type: DOCX_MIME }))
      const original = sourceRef ?? { url: uploaded.url, filename, size: uploaded.size, ext: 'docx' }
      await patchDoc(docId, {
        content: JSON.stringify({ ...original, edited_url: uploaded.url }),
        source: 'manual',
      })
      message.success('Word 文档已保存')
      onSaved?.()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Word 文档保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    setBusy(true)
    try {
      downloadBlob(await currentBlob(), `${title.replace(/\.docx$/i, '') || 'document'}.docx`)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'DOCX 导出失败')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <Alert type="error" showIcon message="无法打开 Word 文档" description={error} />
  if (!documentSource) return <Spin tip="正在读取 DOCX…"><div style={{ height: 160 }} /></Spin>

  return <div style={{ height: '100%', minHeight: 520, display: 'flex', flexDirection: 'column' }}>
    <Space style={{ padding: '0 0 12px' }} wrap>
      {!readOnly && docId ? <Button type="primary" loading={busy} onClick={() => void save()}>保存</Button> : null}
      <Button disabled={busy} onClick={() => void download()}>导出 DOCX</Button>
      {!readOnly && docId ? <Button onClick={() => setVersionOpen(true)}>历史版本</Button> : null}
    </Space>
    <div style={{ flex: 1, minHeight: 0 }}>
      <Editor ref={editorRef} document={documentSource} mode={readOnly ? 'view' : 'edit'} title={title} onSave={() => void save()} />
    </div>
    {docId ? <VersionDrawer open={versionOpen} docId={docId} title={title} docType="word" onClose={() => setVersionOpen(false)} onRolledBack={() => { setVersionOpen(false); onSaved?.() }} /> : null}
  </div>
}

