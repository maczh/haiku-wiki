import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, List, Spin, Tag, Typography, Upload, message } from 'antd'
import type { UploadFile } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, InboxOutlined } from '@ant-design/icons'
import { createDoc, patchDoc } from '../../api/docs'
import { ACCEPT_EXTENSIONS, parseFile } from '../../lib/import/parse'

interface Props {
  open: boolean
  onClose: () => void
  bookId: number
  /** 导入成功后刷新目录树 */
  onImported: () => void
  /** 第四轮 R3：由外部（导入格式下拉 + 文件选择器）直接传入的文件，打开后立即开始解析导入 */
  initialFiles?: File[] | null
  /** 外部传入文件被消费后的回调（父组件清空 initialFiles，避免重复触发） */
  onFilesConsumed?: () => void
}

type ItemStatus = 'waiting' | 'parsing' | 'success' | 'error'

interface ImportItem {
  uid: string
  name: string
  status: ItemStatus
  message: string
  docId?: number
}

/**
 * 导入对话框（I09/I12 / 第四轮 R3）：
 *  - Upload.Dragger 多选 或 外部传入 initialFiles（格式下拉触发，accept 已在文件选择器限定）
 *  → parseFile 按扩展名分派 → createDoc + patchDoc 写入正文（导入目标=当前知识库根目录）；
 *  逐文件成功/失败反馈，失败不产生损坏文档。
 */
export default function ImportDialog({ open, onClose, bookId, onImported, initialFiles, onFilesConsumed }: Props) {
  const [items, setItems] = useState<ImportItem[]>([])
  const [running, setRunning] = useState(false)
  const [pending, setPending] = useState<File[] | null>(null)

  // 外部传入的文件：打开后进入待处理队列并通知父组件清空，避免依赖变化重复触发
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) {
      setPending(initialFiles)
      onFilesConsumed?.()
    }
  }, [open, initialFiles, onFilesConsumed])

  // 待处理队列 → 顺序导入
  useEffect(() => {
    if (open && pending && !running) {
      const files = pending
      setPending(null)
      void runImport(files)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending, running])

  function updateItem(uid: string, patch: Partial<ImportItem>) {
    setItems((list) => list.map((it) => (it.uid === uid ? { ...it, ...patch } : it)))
  }

  async function importOne(item: ImportItem, file: File) {
    updateItem(item.uid, { status: 'parsing', message: '解析中…' })
    const res = await parseFile(file)
    if (!res.ok) {
      updateItem(item.uid, { status: 'error', message: res.reason || '解析失败' })
      return
    }
    try {
      // 按解析结果创建对应类型文档，随后写入正文（默认内容由前端首次保存写入）
      const doc = await createDoc(bookId, 0, res.title, res.docType)
      await patchDoc(doc.id, { content: res.content, source: 'manual' })
      updateItem(item.uid, {
        status: 'success',
        message: res.large ? '导入成功（内容较大，打开可能较慢）' : '导入成功',
        docId: doc.id,
      })
    } catch (e) {
      updateItem(item.uid, { status: 'error', message: (e as Error)?.message || '创建文档失败' })
    }
  }

  /** 顺序导入一批文件（逐个反馈，清晰可控） */
  async function runImport(files: File[]) {
    const next: ImportItem[] = files.map((f, i) => ({
      uid: `imp-${Date.now()}-${i}`,
      name: f.name,
      status: 'waiting',
      message: '等待导入',
    }))
    setItems(next)
    setRunning(true)
    for (let i = 0; i < next.length; i++) {
      await importOne(next[i], files[i])
    }
    setRunning(false)
    onImported()
  }

  async function handleFiles(fileList: UploadFile[]) {
    const files: File[] = []
    for (const f of fileList) {
      if (f.originFileObj) files.push(f.originFileObj)
    }
    if (files.length > 0) await runImport(files)
  }

  const okCount = items.filter((i) => i.status === 'success').length
  const errCount = items.filter((i) => i.status === 'error').length

  return (
    <Drawer
      title="导入文档"
      width={480}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        items.length > 0 && !running ? (
          <Button type="primary" onClick={() => { setItems([]); onClose() }}>
            完成
          </Button>
        ) : null
      }
    >
      <Upload.Dragger
        multiple
        accept={ACCEPT_EXTENSIONS}
        showUploadList={false}
        disabled={running}
        // 不自动上传：文件由前端解析（导入解析全部在前端做）
        beforeUpload={() => false}
        onChange={({ fileList }) => {
          if (!running && fileList.length > 0) {
            const files = fileList.filter((f) => f.originFileObj)
            if (files.length > 0) void handleFiles(files)
          }
        }}
        style={{ background: '#fafafa' }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined style={{ color: '#2f54eb' }} />
        </p>
        <p className="ant-upload-text">点击或拖拽文件到此处</p>
        <p className="ant-upload-hint">
          支持 .md / .txt / .docx / .html / .xlsx / .xls / .csv / .pdf / .pptx / .wps / .et，可多选批量导入
        </p>
      </Upload.Dragger>

      {items.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {running && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Spin size="small" />
              <Typography.Text type="secondary">导入中，请稍候…</Typography.Text>
            </div>
          )}
          {!running && (
            <Alert
              style={{ marginBottom: 8 }}
              type={errCount === 0 ? 'success' : 'warning'}
              message={`完成：成功 ${okCount} 个${errCount > 0 ? `，失败 ${errCount} 个` : ''}`}
            />
          )}
          <List
            size="small"
            dataSource={items}
            renderItem={(it) => (
              <List.Item>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  {it.status === 'success' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
                  {it.status === 'error' && <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
                  {(it.status === 'waiting' || it.status === 'parsing') && <Spin size="small" />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{it.name}</span>
                  <Tag color={it.status === 'success' ? 'green' : it.status === 'error' ? 'red' : 'default'}>
                    {it.message}
                  </Tag>
                </div>
              </List.Item>
            )}
          />
          {errCount > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              失败的文件不会产生损坏文档；可检查格式后重试。
            </Typography.Text>
          )}
        </div>
      )}
    </Drawer>
  )
}

// message 引用保留（导入异常统一走列表反馈，未来全局提示可复用）
void message
