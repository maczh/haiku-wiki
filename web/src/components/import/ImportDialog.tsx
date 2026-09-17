import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, List, Spin, Tag, Typography, Upload, message } from 'antd'
import type { UploadFile } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, InboxOutlined } from '@ant-design/icons'
import { createDoc } from '../../api/docs'
import { uploadFile } from '../../api/uploads'
import { prepareAttachment } from '../../api/attachments'
import { ACCEPT_EXTENSIONS, parseFile } from '../../lib/import/parse'
import type { FileAttachment } from '../../types'

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
 *  → parseFile 按扩展名分派 → createDoc 写入（导入目标=当前知识库根目录）；
 *  - .docx/.doc/.pdf：上传原文件后按原样保存为「附件」文档（不可编辑，阅读界面内直接预览）；
 *  - .xlsx/.xls/.csv/.et：解析为「表格」；多工作表时建父「表格」+ 每个工作表一个「表格」子文档；
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
      // 附件型（docx/pdf/pptx/vsd/dwg…）：先上传原文件，再按原样落库为 file 文档；
      // CAD 还要多一步：由后端把 .dwg/.dxf 转成 .svg/.png，回填 derived 供前端预览。
      if (res.attachment) {
        const up = await uploadFile(file)
        let ref: FileAttachment = {
          url: up.url,
          filename: up.filename || res.attachment.filename,
          size: up.size || res.attachment.size,
          ext: res.attachment.ext,
        }
        let note = ''
        if (res.needsPrepare) {
          updateItem(item.uid, { status: 'parsing', message: '正在生成预览…' })
          const prep = await prepareAttachment({ url: ref.url, filename: ref.filename, size: ref.size })
          ref = prep.ref
          note = prep.warning || (ref.degraded ? ref.note || '图纸预览为降级结果' : '')
        }
        const doc = await createDoc(bookId, 0, res.title, 'file', JSON.stringify(ref))
        // 转换降级/失败只做成 toast，不把长原因塞进列表标签
        if (note) message.warning(note)
        updateItem(item.uid, {
          status: 'success',
          message: note ? '导入成功（预览为降级结果）' : '导入成功（按原文件保存，不可编辑）',
          docId: doc.id,
        })
        return
      }

      // 普通文档：一次请求写入正文
      const doc = await createDoc(bookId, 0, res.title, res.docType, res.content)

      // 多文档导入（xlsx 多工作表）：每个工作表挂为父文档下的「表格」子文档
      const children = res.children ?? []
      let childFailed = 0
      for (const c of children) {
        try {
          await createDoc(bookId, doc.id, c.title, c.docType, c.content)
        } catch {
          childFailed++
        }
      }
      updateItem(item.uid, {
        status: childFailed > 0 && childFailed === children.length ? 'error' : 'success',
        message:
          children.length > 0
            ? `导入成功：${children.length - childFailed} 个表格子文档${childFailed > 0 ? `，${childFailed} 个失败` : ''}`
            : res.large
              ? '导入成功（内容较大，打开可能较慢）'
              : '导入成功',
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
        // 不自动上传：md/txt/xlsx 等由前端解析；docx/pdf 在解析后单独上传原文件
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
          支持 .md / .txt / .docx / .html / .xlsx / .xls / .csv / .pdf / .pptx / .drawio / .vsd / .vsdx /
          .dwg / .dxf / .et，可多选批量导入
        </p>
      </Upload.Dragger>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        · <b>.docx / .pdf / .pptx</b>：按原文件保存，阅读界面内直接预览（.pptx 支持翻页与自动播放）
        <br />· <b>.dwg / .dxf</b>：保留原图，后端自动转换为 .svg + .png，前端可缩放拖动并导出
        <br />· <b>.drawio</b>：建为「绘图」文档，内嵌 draw.io 组件直接编辑
        <br />· <b>.vsd / .vsdx</b>：保留源文件，阅读页由绘图组件转换预览，可另存为可编辑的绘图文档
        <br />· <b>.xlsx</b>：转为「表格」，每个有内容的工作表存为一个「表格」子文档
      </Typography.Paragraph>

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
