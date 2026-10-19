/**
 * 「导入到文库」两步流程：选目标知识库（+可选目录）→ 建导入任务 → 轮询到 success
 * → 取回字节 → **交给既有 ImportDialog 解析入库**。
 *
 * 关键约束（设计文档 §3.4-E）：**不重写任何解析器、不改 ImportDialog**。
 * 这里只做「取字节 → 包成 File → 喂 initialFiles」，解析与秒传全部复用现有链路。
 */

import { useEffect, useMemo, useState } from 'react'
import { Alert, Modal, Select, Space, Spin, Tree, message } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { FolderOutlined } from '@ant-design/icons'
import { listBooks } from '../../api/books'
import { getTree } from '../../api/docs'
import { fetchTaskBlob, getTask, importFile } from '../../api/netdisk'
import ImportDialog from '../import/ImportDialog'
import type { BookWithCount, DocNode, NetdiskEntry, NetdiskTask } from '../../types'

interface Props {
  open: boolean
  connId: number
  entry: NetdiskEntry | null
  onClose: () => void
}

interface KNode extends DataNode {
  key: string
  docId: number
  children?: KNode[]
}

export default function NetdiskImportDialog({ open, connId, entry, onClose }: Props) {
  const [books, setBooks] = useState<BookWithCount[]>([])
  const [bookId, setBookId] = useState(0)
  const [parentId, setParentId] = useState(0)
  const [tree, setTree] = useState<KNode[]>([])
  const [task, setTask] = useState<NetdiskTask | null>(null)
  const [blobFile, setBlobFile] = useState<File | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  // 打开时加载知识库列表
  useEffect(() => {
    if (!open || !entry) return
    setTask(null)
    setBlobFile(null)
    setImportOpen(false)
    setParentId(0)
    void listBooks().then((shelf) => {
      const all = [...(shelf.mine || []), ...(shelf.teams || []), ...(shelf.visible || [])]
      setBooks(all)
      setBookId(all[0]?.id ?? 0)
    })
  }, [open, entry])

  // 选中知识库后加载它的目录树
  useEffect(() => {
    if (!bookId) return
    void getTree(bookId).then((docs) => {
      const byParent = new Map<number, DocNode[]>()
      for (const d of docs) {
        const arr = byParent.get(d.parent_id) || []
        arr.push(d)
        byParent.set(d.parent_id, arr)
      }
      const build = (pid: number): KNode[] =>
        (byParent.get(pid) || []).map((d) => ({
          key: `doc:${d.id}`,
          docId: d.id,
          title: d.title || '未命名',
          icon: <FolderOutlined style={{ color: '#faad14' }} />,
          isLeaf: false,
          children: build(d.id),
        }))
      setTree([{ key: 'root', docId: 0, title: '（知识库根目录）', icon: <FolderOutlined style={{ color: '#2f54eb' }} />, isLeaf: true }, ...build(0)])
    })
  }, [bookId])

  // 建任务后轮询到终态，再取字节
  useEffect(() => {
    if (!task || task.status === 'success' || task.status === 'failed' || task.status === 'canceled') return
    const timer = window.setInterval(async () => {
      try {
        const t = await getTask(task.id)
        setTask(t)
        if (t.status === 'success') {
          window.clearInterval(timer)
          const blob = await fetchTaskBlob(t.id)
          setBlobFile(new File([blob], entry?.name || 'download', { type: blob.type || undefined }))
          setImportOpen(true)
        }
        if (t.status === 'failed' || t.status === 'canceled') window.clearInterval(timer)
      } catch {
        window.clearInterval(timer)
      }
    }, 1200)
    return () => window.clearInterval(timer)
  }, [task, entry?.name])

  const bookOptions = useMemo(
    () => books.map((b) => ({ value: b.id, label: b.name || '未命名知识库' })),
    [books],
  )

  if (!entry) return null

  async function handleStart() {
    if (!bookId) {
      message.warning('请先选择目标知识库')
      return
    }
    try {
      const t = await importFile(connId, entry!.path, bookId, parentId)
      setTask(t)
    } catch {
      /* request 拦截器已提示 */
    }
  }

  return (
    <>
      <Modal
        open={open && !importOpen}
        title={`导入「${entry.name}」到文库`}
        onCancel={onClose}
        width={480}
        onOk={handleStart}
        okText={task ? '任务进行中…' : '开始导入'}
        okButtonProps={{ disabled: Boolean(task) || !bookId }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <div style={{ marginBottom: 4, fontSize: 13, color: '#5c6470' }}>目标知识库</div>
            <Select
              style={{ width: '100%' }}
              options={bookOptions}
              value={bookId || undefined}
              onChange={(v) => {
                setBookId(v)
                setParentId(0)
              }}
              placeholder="选择知识库"
            />
          </div>
          {bookId > 0 && (
            <div>
              <div style={{ marginBottom: 4, fontSize: 13, color: '#5c6470' }}>
                目标目录（可选，默认知识库根目录）
              </div>
              <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: 4 }}>
                <Tree
                  blockNode
                  treeData={tree}
                  selectedKeys={[parentId === 0 ? 'root' : `doc:${parentId}`]}
                  onSelect={(keys) => {
                    if (!keys.length) return
                    if (keys[0] === 'root') {
                      setParentId(0)
                      return
                    }
                    setParentId(Number(String(keys[0]).replace('doc:', '')))
                  }}
                />
              </div>
            </div>
          )}
          {task && (
            <Alert
              type={task.status === 'failed' ? 'error' : 'info'}
              showIcon
              message={
                task.status === 'failed'
                  ? `导入失败：${task.error || '未知错误'}`
                  : task.status === 'success'
                    ? '已取回文件，正在打开导入面板…'
                    : `正在从网盘取回文件…（${task.status === 'pending' ? '排队中' : '进行中'}）`
              }
            />
          )}
        </Space>
      </Modal>

      {blobFile && (
        <ImportDialog
          open={importOpen}
          bookId={bookId}
          parentId={parentId}
          initialFiles={[blobFile]}
          onClose={() => {
            setImportOpen(false)
            onClose()
          }}
          onFilesConsumed={() => setBlobFile(null)}
          onImported={() => message.success('导入成功，可在文库中查看')}
        />
      )}
    </>
  )
}
