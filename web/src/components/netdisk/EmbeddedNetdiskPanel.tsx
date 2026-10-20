import { useEffect, useRef, useState } from 'react'
import { Alert, Modal, Spin, message } from 'antd'
import { createDir, deleteItem, downloadUrl, getTask, listConnections, listDir, makePreviewToken, moveItem, renameItem, uploadFile } from '../../api/netdisk'
import type { NetdiskConnection, NetdiskEntry } from '../../types'
import NetdiskFileList from './NetdiskFileList'
import NetdiskPreviewModal from './NetdiskPreviewModal'
import NetdiskMoveDialog from './NetdiskMoveDialog'
import type { NetdiskCategoryFilter } from '../../lib/netdisk/format'
import './netdisk.css'

interface Props { conn: NetdiskConnection; path: string; onPathChange: (path: string) => void }

export default function EmbeddedNetdiskPanel({ conn, path, onPathChange }: Props) {
  const [entries, setEntries] = useState<NetdiskEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<NetdiskEntry | null>(null)
  const [moveTarget, setMoveTarget] = useState<NetdiskEntry | NetdiskEntry[] | null>(null)
  const [connections, setConnections] = useState<NetdiskConnection[]>([conn])
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

  useEffect(() => { void listConnections().then(setConnections).catch(() => setConnections([conn])) }, [conn])

  const noop = () => undefined

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
        onUploadFiles={(files) => {
          void Promise.all(Array.from(files).map((file) => uploadFile(conn.id, path, file))).then(() => { message.success('已加入上传队列'); refresh() })
        }}
        onPreview={setPreview}
        onDownload={(item) => { void download(item).catch(() => undefined) }}
        onRename={(item, name) => { void renameItem(conn.id, item.path, name).then(() => { message.success('已改名'); refresh() }) }}
        onMove={(item) => setMoveTarget(item)}
        onDelete={(item) => {
          Modal.confirm({ title: `删除「${item.name}」？`, okButtonProps: { danger: true }, onOk: () => deleteItem(conn.id, item.path, item.is_dir).then(() => { message.success('已删除'); refresh() }) })
        }}
        onBatchDownload={(items) => { for (const item of items) if (!item.is_dir) void download(item).catch(() => undefined) }}
        onBatchDelete={(items) => { Modal.confirm({ title: `删除选中的 ${items.length} 项？`, okButtonProps: { danger: true }, onOk: async () => { for (const item of items) await deleteItem(conn.id, item.path, item.is_dir); refresh() } }) }}
        onBatchMove={(items) => setMoveTarget(items)}
        category={category}
      />
      <NetdiskPreviewModal
        open={!!preview}
        connId={conn.id}
        entry={preview}
        entries={entries}
        onClose={() => setPreview(null)}
        onNavigate={setPreview}
        onDownload={(item) => { void download(item).catch(() => undefined) }}
      />
      <NetdiskMoveDialog
        open={moveTarget !== null}
        connId={conn.id}
        connections={connections}
        srcPath={Array.isArray(moveTarget) ? moveTarget[0]?.path ?? '/' : moveTarget?.path ?? '/'}
        onClose={() => setMoveTarget(null)}
        onConfirm={(targetConnId, targetDir) => {
          const items = Array.isArray(moveTarget) ? moveTarget : moveTarget ? [moveTarget] : []
          setMoveTarget(null)
          void Promise.all(items.map(async (item) => {
            if (targetConnId === conn.id) {
              await moveItem(conn.id, item.path, targetDir)
              return
            }
            if (item.is_dir) throw new Error('跨网盘暂不支持移动目录')
            const { token } = await makePreviewToken(conn.id, item.path)
            const response = await fetch(downloadUrl(conn.id, item.path, token))
            if (!response.ok) throw new Error(`读取「${item.name}」失败`)
            const task = await uploadFile(targetConnId, targetDir, new File([await response.blob()], item.name))
            let status = task.status
            while (status === 'pending' || status === 'running') {
              await new Promise((resolve) => window.setTimeout(resolve, 800))
              status = (await getTask(task.id)).status
            }
            if (status !== 'success') throw new Error(`复制「${item.name}」失败，源文件未删除`)
            await deleteItem(conn.id, item.path)
          })).then(() => { message.success('已移动'); refresh() }).catch((error) => message.error(error instanceof Error ? error.message : '移动失败'))
        }}
      />
    </div>
  )
}
