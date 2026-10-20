import { useEffect, useState } from 'react'
import { Alert, Modal, Progress, Select, Spin, Tree } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { FolderOutlined } from '@ant-design/icons'
import { listConnections, listDir, uploadFile } from '../../api/netdisk'
import { parseAttachment } from '../../lib/attachment'
import { getDoc } from '../../api/docs'
import { exportDocBlob } from '../../api/docs'
import { parseWhiteboardContent } from '../../lib/whiteboardDoc'
import { buildExcalidrawFile } from '../../lib/whiteboardExport'
import type { MindmapJSON, SmmNode } from '../../lib/mindmap.smm'
import type { DocNode, NetdiskConnection, NetdiskEntry } from '../../types'

interface Props { open: boolean; doc: DocNode | null; onClose: () => void }
interface DirNode extends DataNode { path: string; children?: DirNode[] }

function toKmNode(node: SmmNode): Record<string, unknown> {
  return {
    data: { text: node.data?.text ?? '', expandState: node.data?.expand === false ? 'collapse' : 'expand' },
    children: (node.children ?? []).map(toKmNode),
  }
}

export default function NetdiskUploadDialog({ open, doc, onClose }: Props) {
  const [connections, setConnections] = useState<NetdiskConnection[]>([])
  const [connId, setConnId] = useState<number>()
  const [dirs, setDirs] = useState<Map<string, NetdiskEntry[]>>(new Map())
  const [target, setTarget] = useState('/')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError(''); setProgress(0); setTarget('/'); setDirs(new Map())
    void listConnections().then((items) => {
      const writable = items
      setConnections(writable); setConnId(writable[0]?.id)
    }).catch(() => setError('网盘连接加载失败'))
  }, [open])

  useEffect(() => {
    if (!open || !connId) return
    setLoading(true)
    void listDir(connId, '/').then((res) => setDirs(new Map([['/', res.items.filter((item) => item.is_dir)]])))
      .catch(() => setError('网盘目录加载失败')).finally(() => setLoading(false))
  }, [open, connId])

  async function load(path: string) {
    if (!connId || dirs.has(path)) return
    const res = await listDir(connId, path)
    setDirs((prev) => new Map(prev).set(path, res.items.filter((item) => item.is_dir)))
  }

  function tree(items: NetdiskEntry[], parent: string): DirNode[] {
    return items.map((item) => ({ key: item.path, path: item.path, title: item.name, icon: <FolderOutlined />, isLeaf: false, children: dirs.has(item.path) ? tree(dirs.get(item.path)!, item.path) : undefined }))
  }

  async function confirm() {
    if (!doc || !connId) return
    setUploading(true); setError(''); setProgress(0)
    try {
      let file: File
      const detail = await getDoc(doc.id)
      // 文库的附件文档不一定仍标记为 file：DOCX/PPTX/XLSX 导入后可能被
      // 映射成对应原生类型，但正文仍保存着 {url, filename, ext} 原文件引用。
      // 无论 doc_type，优先提取这个原文件，避免把引用 JSON 当正文上传。
      const attachment = parseAttachment(detail.doc.content)
      if (attachment?.url) {
        const response = await fetch(attachment.url)
        if (!response.ok) throw new Error(`原文件读取失败（HTTP ${response.status}）`)
        file = new File([await response.blob()], attachment.filename || `${doc.title}.bin`)
      } else if (['powerpoint', 'word', 'sheet', 'excel'].includes(doc.doc_type)) {
        const format = doc.doc_type === 'powerpoint' ? 'pptx' : doc.doc_type === 'word' ? 'docx' : 'xlsx'
        const exported = await exportDocBlob(doc.id, doc.title || '文档', format)
        file = new File([exported.blob], exported.filename, { type: exported.blob.type || 'application/octet-stream' })
      } else if (doc.doc_type === 'mindmap') {
        const data = JSON.parse(detail.doc.content) as MindmapJSON
        if (!data?.root) throw new Error('思维导图内容格式无效')
        const km = JSON.stringify({ root: toKmNode(data.root), template: 'default', theme: 'fresh-blue', version: '1.4.43' }, null, 2)
        file = new File([km], `${doc.title || '思维导图'}.km`, { type: 'application/json;charset=utf-8' })
      } else if (doc.doc_type === 'flowchart') {
        const markdown = `\`\`\`mermaid\n${detail.doc.content || ''}\n\`\`\`\n`
        file = new File([markdown], `${doc.title || '流程图'}.md`, { type: 'text/markdown;charset=utf-8' })
      } else if (doc.doc_type === 'whiteboard') {
        const whiteboard = parseWhiteboardContent(detail.doc.content ?? '')
        const excalidraw = await buildExcalidrawFile(whiteboard.elements, whiteboard.appState, whiteboard.files)
        file = new File([excalidraw], `${doc.title || '白板'}.excalidraw`, { type: 'application/json;charset=utf-8' })
      } else {
        const ext = doc.doc_type === 'markdown' ? 'md' : 'txt'
        file = new File([detail.doc.content ?? ''], `${doc.title || '文档'}.${ext}`, { type: ext === 'md' ? 'text/markdown' : 'text/plain' })
      }
      await uploadFile(connId, target, file, setProgress)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上传失败')
    } finally { setUploading(false) }
  }

  return <Modal open={open} title="上传到网盘" onCancel={onClose} onOk={() => void confirm()} okText="开始上传" confirmLoading={uploading} destroyOnHidden>
    <Select style={{ width: '100%', marginBottom: 12 }} placeholder="选择网盘" value={connId} onChange={(value) => setConnId(value)} options={connections.map((item) => ({ value: item.id, label: item.name }))} />
    <Spin spinning={loading}>
      <Tree blockNode treeData={tree(dirs.get('/') ?? [], '/')} selectedKeys={[target]} onSelect={(keys) => { if (keys[0]) setTarget(String(keys[0])) }} loadData={(node) => load((node as DirNode).path)} />
    </Spin>
    <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 8 }}>目标目录：{target}</div>
    {uploading && <Progress percent={progress} style={{ marginTop: 8 }} />}
    {error && <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} />}
  </Modal>
}
