import { useEffect, useRef, useState } from 'react'
import { Alert, Modal, Spin, message } from 'antd'
import { createDir, deleteItem, downloadUrl, listDir, makePreviewToken, moveItem, renameItem, uploadFile } from '../../api/netdisk'
import type { NetdiskConnection, NetdiskEntry } from '../../types'
import NetdiskFileList from './NetdiskFileList'
import NetdiskPreviewModal from './NetdiskPreviewModal'
import type { NetdiskCategoryFilter } from '../../lib/netdisk/format'
import './netdisk.css'

interface Props { conn: NetdiskConnection; path: string; onPathChange: (path: string) => void }

export default function EmbeddedNetdiskPanel({ conn, path, onPathChange }: Props) {
  const [entries, setEntries] = useState<NetdiskEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<NetdiskEntry | null>(null)
  const requestSeq = useRef(0)
  const uploadInput = useRef<HTMLInputElement>(null)
  const category: NetdiskCategoryFilter = 'all'
  const refresh = () => { void listDir(conn.id, path, true).then((res) => setEntries(res.items)) }
  const download = async (item: NetdiskEntry) => {
    const { token } = await makePreviewToken(conn.id, item.path)
    const a = document.createElement('a'); a.href = downloadUrl(conn.id, item.path, token); a.download = item.name; a.click()
  }
  const newDir = (name: string) => {
    if (name.trim()) void createDir(conn.id, path, name.trim()).then(() => { message.success('目录已创建'); refresh() })
  }

  useEffect(() => {
    let alive = true
    const seq = ++requestSeq.current
    setLoading(true)
    void listDir(conn.id, path).then((res) => {
      if (alive && seq === requestSeq.current) setEntries(res.items)
    }).catch(() => {
      if (alive && seq === requestSeq.current) setEntries([])
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [conn.id, path])

  const noop = () => undefined
  const noopItem = (_item: NetdiskEntry) => undefined
  const noopItems = (_items: NetdiskEntry[]) => undefined

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {loading && entries.length === 0 ? <Spin style={{ margin: '80px auto' }} /> : null}
      {!loading && !conn ? <Alert message="网盘连接不存在" type="warning" /> : null}
      <input ref={uploadInput} type="file" multiple hidden onChange={(e) => {
        const files = Array.from(e.target.files ?? [])
        void Promise.all(files.map((file) => uploadFile(conn.id, path, file))).then(() => { message.success('已加入上传队列'); refresh() })
        e.currentTarget.value = ''
      }} />
      <NetdiskFileList
        conn={conn}
        path={path}
        entries={entries}
        loading={loading}
        onOpenDir={onPathChange}
        onGoPath={onPathChange}
        onRefresh={refresh}
        onNewDir={newDir}
        onUpload={() => uploadInput.current?.click()}
        onPreview={setPreview}
        onDownload={(item) => { void download(item).catch(() => undefined) }}
        onImport={noopItem}
        onRename={(item, name) => { void renameItem(conn.id, item.path, name).then(() => { message.success('已改名'); refresh() }) }}
        onMove={(item) => {
          const target = window.prompt('请输入目标目录路径', path)
          if (target?.trim()) void moveItem(conn.id, item.path, target.trim()).then(() => { message.success('已移动'); refresh() })
        }}
        onDelete={(item) => {
          Modal.confirm({ title: `删除「${item.name}」？`, okButtonProps: { danger: true }, onOk: () => deleteItem(conn.id, item.path, item.is_dir).then(() => { message.success('已删除'); refresh() }) })
        }}
        onBatchDownload={(items) => { for (const item of items) if (!item.is_dir) void download(item).catch(() => undefined) }}
        onBatchImport={noopItems}
        onBatchDelete={(items) => { Modal.confirm({ title: `删除选中的 ${items.length} 项？`, okButtonProps: { danger: true }, onOk: async () => { for (const item of items) await deleteItem(conn.id, item.path, item.is_dir); refresh() } }) }}
        onBatchMove={(items) => { const target = window.prompt('请输入目标目录路径', path); if (target?.trim()) void Promise.all(items.map((item) => moveItem(conn.id, item.path, target.trim()))).then(refresh) }}
        category={category}
      />
      <NetdiskPreviewModal
        open={!!preview}
        connId={conn.id}
        entry={preview}
        entries={entries}
        onClose={() => setPreview(null)}
        onNavigate={setPreview}
        onDownload={noopItem}
        onImport={noopItem}
      />
    </div>
  )
}
