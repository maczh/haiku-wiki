/**
 * 网盘页 `/netdisk/:id`：左侧目录树 + 右侧文件列表面板。
 *
 * 布局与交互口径见 PRD §4.5；写操作成功后统一走 `invalidate + force=1 重拉`，
 * 保证目录树与列表不出现「改了但看不到」的陈旧态。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Empty, Modal, Spin, message } from 'antd'
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import {
  createDir,
  deleteItem,
  downloadUrl,
  getConnection,
  listDir,
  listConnections,
  makePreviewToken,
  moveItem,
  refreshConnection,
  renameItem,
  uploadFile,
} from '../api/netdisk'
import { dirCacheGet, dirCacheInvalidate, dirCacheSet } from '../lib/netdisk/dirCache'
import { NETDISK_ROOT } from '../lib/netdisk/constants'
import { baseName } from '../lib/netdisk/path'
import { isNetdiskImportable } from '../lib/netdisk/format'
import NetdiskTree from '../components/netdisk/NetdiskTree'
import NetdiskFileList from '../components/netdisk/NetdiskFileList'
import NetdiskCategoryRail from '../components/netdisk/NetdiskCategoryRail'
import NetdiskMoveDialog from '../components/netdisk/NetdiskMoveDialog'
import NetdiskPreviewModal from '../components/netdisk/NetdiskPreviewModal'
import NetdiskImportDialog from '../components/netdisk/NetdiskImportDialog'
import NetdiskTaskCenter from '../components/netdisk/NetdiskTaskCenter'
// 网盘页样式必须由本路由自带：此前只在 DashboardPage 引入，
// 直达 /netdisk/:id 时该分包不会加载，页面会退化成无样式的单列堆叠。
import '../components/netdisk/netdisk.css'
import type { NetdiskConnection, NetdiskEntry } from '../types'
import type { NetdiskCategoryFilter } from '../lib/netdisk/format'

/** 弹起的「输入名字」对话框状态（新建目录 / 改名共用） */
type PromptState =
  | { mode: 'mkdir' }
  | { mode: 'rename'; entry: NetdiskEntry }
  | null

export default function NetdiskPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const connId = Number(id || 0)

  const [conns, setConns] = useState<NetdiskConnection[]>([])
  const [connDetail, setConnDetail] = useState<NetdiskConnection | null>(null)
  const [path, setPath] = useState<string>(NETDISK_ROOT)
  const [category, setCategory] = useState<NetdiskCategoryFilter>('all')
  const [entries, setEntries] = useState<NetdiskEntry[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)

  const [prompt, setPrompt] = useState<PromptState>(null)
  const [promptValue, setPromptValue] = useState('')
  const [moveTarget, setMoveTarget] = useState<NetdiskEntry | NetdiskEntry[] | null>(null)
  const [preview, setPreview] = useState<NetdiskEntry | null>(null)
  const [importEntry, setImportEntry] = useState<NetdiskEntry | null>(null)
  const [taskOpen, setTaskOpen] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const conn = useMemo(() => conns.find((c) => c.id === connId) || null, [conns, connId])

  useEffect(() => {
    setPath(NETDISK_ROOT)
    setCategory('all')
  }, [connId])

  /** 加载连接列表（页面壳 + 目录树共用） */
  useEffect(() => {
    void listConnections().then(setConns).catch(() => undefined)
  }, [])

  /** 当前连接的详情（状态 / last_error 等） */
  useEffect(() => {
    if (!connId) return
    setPageLoading(true)
    void getConnection(connId)
      .then((c) => {
        setConnDetail(c)
        setConns((prev) => {
          const has = prev.some((x) => x.id === c.id)
          return has ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]
        })
      })
      .catch(() => setConnDetail(null))
      .finally(() => setPageLoading(false))
  }, [connId])

  /** 拉目录列表（先命中前端缓存） */
  const loadDir = useCallback(
    async (target: string, force = false) => {
      if (!connId) return
      if (!force) {
        const hit = dirCacheGet(connId, target)
        if (hit) {
          setEntries(hit)
          return
        }
      }
      setListLoading(true)
      try {
        const res = await listDir(connId, target, force)
        setEntries(res.items)
        dirCacheSet(connId, target, res.items)
      } catch {
        setEntries([])
      } finally {
        setListLoading(false)
      }
    },
    [connId],
  )

  useEffect(() => {
    void loadDir(path)
  }, [path, loadDir])

  /** 写操作后：失效缓存 + 强制重拉 + 通知目录树重拉 */
  const afterWrite = useCallback(
    (targetPath: string) => {
      dirCacheInvalidate(connId, targetPath)
      setReloadNonce((n) => n + 1)
      void loadDir(path, true)
    },
    [connId, path, loadDir],
  )

  // ---------- 目录 / 文件操作 ----------

  function openDir(next: string) {
    setPath(next)
  }

  async function handleMkdir(name: string) {
    if (!name.trim()) return
    try {
      await createDir(connId, path, name.trim())
      message.success('目录已创建')
      setPrompt(null)
      setPromptValue('')
      afterWrite(path)
    } catch {
      /* request 拦截器已提示 */
    }
  }

  async function handleRename(entry: NetdiskEntry, name: string) {
    if (!name.trim()) return
    try {
      await renameItem(connId, entry.path, name.trim())
      message.success('已改名')
      setPrompt(null)
      setPromptValue('')
      afterWrite(path)
    } catch {
      /* request 拦截器已提示 */
    }
  }

  async function handleDelete(items: NetdiskEntry[]) {
    for (const item of items) {
      try {
        await deleteItem(connId, item.path, item.is_dir)
      } catch {
        /* request 拦截器已提示 */
      }
    }
    message.success('已删除')
    afterWrite(path)
  }

  async function handleMove(items: NetdiskEntry[], targetDir: string) {
    for (const item of items) {
      try {
        await moveItem(connId, item.path, targetDir)
      } catch {
        /* request 拦截器已提示 */
      }
    }
    message.success('已移动')
    setMoveTarget(null)
    afterWrite(path)
    // 目标目录的祖先链也受影响
    dirCacheInvalidate(connId, targetDir)
    setReloadNonce((n) => n + 1)
  }

  /** 下载：浏览器直接打开（带 token），浏览器原生进度 */
  async function handleDownload(items: NetdiskEntry[]) {
    for (const item of items) {
      if (item.is_dir) continue
      try {
        const { token } = await makePreviewToken(connId, item.path)
        const a = document.createElement('a')
        a.href = downloadUrl(connId, item.path, token)
        a.download = item.name
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
      } catch {
        /* request 拦截器已提示 */
      }
    }
  }

  /** 上传：隐藏 <input type=file> 触发，任务化 */
  function handleUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i]
      void uploadFile(connId, path, f).catch(() => undefined)
    }
    message.success(`已加入上传队列（${files.length} 个文件）`)
    setTaskOpen(true)
    // 任务完成后由任务中心回调触发刷新
    setReloadNonce((n) => n + 1)
  }

  // ---------- 渲染 ----------

  if (pageLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spin size="large" tip="正在加载网盘…" />
      </div>
    )
  }

  if (!conn) {
    return (
      <div style={{ padding: 48 }}>
        <Empty description="网盘连接不存在或已被删除">
          <Button type="primary" onClick={() => window.history.back()}>
            返回
          </Button>
        </Empty>
      </div>
    )
  }

  if (conn.status === 'reauth_required') {
    return (
      <div style={{ padding: 48 }}>
        <Alert
          type="warning"
          showIcon
          message="该网盘需要重新授权"
          description="授权已过期，点击下方按钮重新完成授权后即可继续使用。"
          action={
            <Button
              size="small"
              onClick={() => {
                window.location.href = `/netdisk/${conn.id}`
                void refreshConnection(conn.id).then((c) => {
                  setConnDetail(c)
                  setConns((prev) => prev.map((x) => (x.id === c.id ? c : x)))
                })
              }}
            >
              重新授权
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="hk-nd-page" data-testid="hk-netdisk-page">
      <div className="hk-nd-side">
        <div className="hk-nd-side-head">
          <CloudDownloadOutlined />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{conn.name}</span>
          <SyncOutlined
            spin={listLoading}
            style={{ cursor: 'pointer', color: '#8a919f' }}
            onClick={() => void loadDir(path, true)}
            title="刷新当前目录"
          />
        </div>
        <NetdiskCategoryRail active={category} onChange={setCategory} />
        <NetdiskTree
          conns={conns}
          activeConnId={connId}
          currentPath={path}
          loading={listLoading}
          onSelect={(c, p) => {
            if (c !== connId) navigate(`/netdisk/${c}`)
            else openDir(p)
          }}
          onSelectConn={(c) => {
            if (c !== connId) navigate(`/netdisk/${c}`)
            else openDir(NETDISK_ROOT)
          }}
          reloadNonce={reloadNonce}
        />
      </div>

      <NetdiskFileList
        conn={conn}
        path={path}
        entries={entries}
        loading={listLoading}
        category={category}
        onOpenDir={openDir}
        onGoPath={openDir}
        onRefresh={() => void loadDir(path, true)}
        onNewDir={(name) => void handleMkdir(name)}
        onUpload={() => fileInputRef.current?.click()}
        onPreview={(item) => setPreview(item)}
        onDownload={(item) => void handleDownload([item])}
        onImport={(item) => setImportEntry(item)}
        onRename={(item, name) => void handleRename(item, name)}
        onMove={(item) => setMoveTarget(item)}
        onDelete={(item) => {
          Modal.confirm({
            title: `删除「${item.name}」？`,
            content: item.is_dir ? '该操作会递归删除目录下的全部内容，且不可恢复。' : '删除后不可恢复。',
            okText: '删除',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: () => handleDelete([item]),
          })
        }}
        onBatchDownload={(items) => void handleDownload(items)}
        onBatchImport={(items) => {
          const ok = items.filter((i) => !i.is_dir && isNetdiskImportable(i.name))
          if (ok.length === 0) {
            message.warning('所选文件都不在文库支持的格式内')
            return
          }
          if (ok.length > 1) {
            message.info(`已选择第一个文件「${ok[0].name}」，其余 ${ok.length - 1} 个请逐个导入`)
          }
          setImportEntry(ok[0])
        }}
        onBatchDelete={(items) => {
          const dirCount = items.filter((i) => i.is_dir).length
          Modal.confirm({
            title: `删除所选 ${items.length} 项？`,
            content: dirCount > 0 ? `其中 ${dirCount} 个目录会连同子内容一起删除，且不可恢复。` : '删除后不可恢复。',
            okText: '删除',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: () => handleDelete(items),
          })
        }}
        onBatchMove={(items) => setMoveTarget(items)}
      />

      {/* 上传用的隐藏文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          handleUploadFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {/* 新建目录 / 改名 */}
      <Modal
        open={prompt !== null}
        title={prompt?.mode === 'mkdir' ? '新建目录' : '改名'}
        onCancel={() => setPrompt(null)}
        onOk={() => {
          if (prompt?.mode === 'mkdir') void handleMkdir(promptValue)
          else if (prompt?.mode === 'rename') void handleRename(prompt.entry, promptValue)
        }}
        okButtonProps={{ disabled: !promptValue.trim() }}
      >
        <input
          autoFocus
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
          placeholder={prompt?.mode === 'mkdir' ? `在 ${baseName(path) || '根目录'} 下新建` : '输入新名称'}
          style={{
            width: '100%',
            padding: '6px 10px',
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
      </Modal>

      {/* 移动 */}
      <NetdiskMoveDialog
        open={moveTarget !== null}
        connId={connId}
        srcPath={Array.isArray(moveTarget) ? moveTarget[0]?.path ?? '/' : moveTarget?.path ?? '/'}
        onClose={() => setMoveTarget(null)}
        onConfirm={(target) => {
          const items = Array.isArray(moveTarget) ? moveTarget : moveTarget ? [moveTarget] : []
          void handleMove(items, target)
        }}
      />

      {/* 预览 */}
      <NetdiskPreviewModal
        open={preview !== null}
        connId={connId}
        entry={preview}
        entries={entries}
        onClose={() => setPreview(null)}
        onNavigate={setPreview}
        onDownload={(item) => void handleDownload([item])}
        onImport={(item) => setImportEntry(item)}
      />

      {/* 导入到文库 */}
      <NetdiskImportDialog
        open={importEntry !== null}
        connId={connId}
        entry={importEntry}
        onClose={() => setImportEntry(null)}
      />

      {/* 任务中心入口 */}
      <Button
        type="primary"
        shape="round"
        icon={<CloudUploadOutlined />}
        style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 10 }}
        onClick={() => setTaskOpen(true)}
        data-testid="hk-netdisk-task-open"
      >
        任务中心
      </Button>
      <NetdiskTaskCenter
        open={taskOpen}
        connId={connId}
        onClose={() => setTaskOpen(false)}
        onTaskDone={() => {
          dirCacheInvalidate(connId, path)
          setReloadNonce((n) => n + 1)
          void loadDir(path, true)
        }}
      />
    </div>
  )
}
