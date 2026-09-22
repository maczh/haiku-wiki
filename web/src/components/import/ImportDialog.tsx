import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Drawer, List, Spin, Tag, Tooltip, Typography, Upload, message } from 'antd'
import type { UploadFile } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, InboxOutlined } from '@ant-design/icons'
import { createDoc } from '../../api/docs'
import { uploadWithDedup } from '../../lib/uploadFlow'
import { prepareAttachment } from '../../api/attachments'
import { ACCEPT_EXTENSIONS, parseFile } from '../../lib/import/parse'
import { extOfName, isSupportedImportExt, unsupportedImportReason } from '../../lib/import/formats'
import type { FileAttachment } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  bookId: number
  /** 导入目标目录（文档 id）；0=知识库根目录。由外部（书架目录树）选定目录后传入 */
  parentId?: number
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
  /** 内容摘要（32 位小写 hex），来自秒传链路；仅用于 UI 回显 */
  md5?: string
  /** true = 本次命中秒传（内容已存在，未重复存储字节） */
  dedup?: boolean
}

/** 文件去重键：名称 + 大小（同一批拖入的重复文件两者皆同） */
function fileKey(f: File): string {
  return `${f.name}::${f.size}`
}

/**
 * 导入对话框（I09/I12 / 第四轮 R3）：
 *  - Upload.Dragger 多选 或 外部传入 initialFiles（格式下拉触发，accept 已在文件选择器限定）
 *  → parseFile 按扩展名分派 → createDoc 写入（导入目标=当前知识库根目录）；
 *  - .docx/.doc/.pdf：上传原文件后按原样保存为「附件」文档（不可编辑，阅读界面内直接预览）；
 *  - .xlsx/.xls/.csv/.et：解析为「表格」；多工作表时建父「表格」+ 每个工作表一个「表格」子文档；
 *  逐文件成功/失败反馈，失败不产生损坏文档。
 *
 * 去重与单次执行（本轮修复）：
 *  - antd Upload 每加入一个文件都会触发一次 onChange，且每次回传的是**完整 fileList**；
 *    早期实现把整份 fileList 直接拿去导入，于是 N 个文件会产生 N²/N 次重复导入；
 *  - 现在以「名称 + 大小」登记已受理文件（handledRef），重复回调被直接过滤；
 *  - 导入过程用 runningRef 串行化：新来的文件进队列由同一个循环消费，
 *    不会并发跑起第二个导入循环（并发会让列表项状态互相覆盖）。
 */
export default function ImportDialog({ open, onClose, bookId, parentId = 0, onImported, initialFiles, onFilesConsumed }: Props) {
  const [items, setItems] = useState<ImportItem[]>([])
  const [running, setRunning] = useState(false)

  /** 已受理文件的指纹集合（跨次 onChange 去重） */
  const handledRef = useRef<Set<string>>(new Set())
  /** 待导入队列（导入进行中新增的文件排队，由同一循环消费） */
  const queueRef = useRef<File[]>([])
  /** 串行化标记：同一时刻只跑一个导入循环 */
  const runningRef = useRef(false)
  /** 列表项序号（保证 uid 唯一，不依赖 Date.now 的同毫秒碰撞） */
  const seqRef = useRef(0)

  // 打开时清空去重指纹与队列：同一文件在重新打开对话框后允许再次导入
  useEffect(() => {
    if (!open) return
    handledRef.current.clear()
    queueRef.current = []
    seqRef.current = 0
    setItems([])
  }, [open])

  // 外部传入的文件：打开后进入待处理队列并通知父组件清空，避免依赖变化重复触发
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) {
      void enqueue(initialFiles)
      onFilesConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles, onFilesConsumed])

  function updateItem(uid: string, patch: Partial<ImportItem>) {
    setItems((list) => list.map((it) => (it.uid === uid ? { ...it, ...patch } : it)))
  }

  /** 导入单个文件；返回 true 表示本次命中了秒传（供调用方汇总提示） */
  async function importOne(item: ImportItem, file: File): Promise<boolean> {
    updateItem(item.uid, { status: 'parsing', message: '解析中…' })

    // 前置格式校验：不支持的扩展名直接友好拒绝，不解析、不上传、不创建文档
    const ext = extOfName(file.name)
    if (!isSupportedImportExt(ext)) {
      updateItem(item.uid, { status: 'error', message: unsupportedImportReason(file.name) })
      return false
    }

    const res = await parseFile(file)
    if (!res.ok) {
      updateItem(item.uid, { status: 'error', message: res.reason || unsupportedImportReason(file.name) })
      return false
    }
    try {
      // 附件型（docx/pdf/pptx/vsd/dwg…）：先上传原文件，再按原样落库为 file 文档；
      // CAD 还要多一步：由后端把 .dwg/.dxf 转成 .svg/.png，回填 derived 供前端预览。
      if (res.attachment) {
        // 走秒传链路：内容已存在时不重复传输字节（降级由 uploadFlow 内部保证）
        const up = await uploadWithDedup(file)
        let ref: FileAttachment = {
          url: up.url,
          filename: up.filename || res.attachment.filename,
          size: up.size || res.attachment.size,
          ext: res.attachment.ext,
        }
        let note = ''
        if (res.needsPrepare) {
          updateItem(item.uid, { status: 'parsing', message: '正在生成预览…' })
          try {
            const prep = await prepareAttachment({ url: ref.url, filename: ref.filename, size: ref.size })
            ref = prep.ref
            note = prep.warning || (ref.degraded ? ref.note || '图纸预览为降级结果' : '')
            // 转换不出任何预览产物（例如未安装 DWG 转换器且文件内无预览图）：
            // 仍保留原文件，只提示不可在线预览，绝不落一个「预览地址指向空文件」的损坏文档。
            if (!ref.derived?.svg && !ref.derived?.png) {
              note = '暂不支持该格式在线预览，已按原文件保存（可下载后用专业软件打开）'
            }
          } catch {
            note = '预览转换失败，已按原文件保存（可下载后用专业软件打开）'
          }
        }
        const doc = await createDoc(bookId, parentId, res.title, 'file', JSON.stringify(ref))
        // 转换降级/失败只做成 toast，不把长原因塞进列表标签
        if (note) message.warning(note)
        updateItem(item.uid, {
          status: 'success',
          message: note ? '导入成功（无在线预览）' : '导入成功（按原文件保存，不可编辑）',
          docId: doc.id,
          md5: up.md5,
          dedup: up.dedup,
        })
        return up.dedup
      }

      // 普通文档：一次请求写入正文（落到指定的目标目录）
      const doc = await createDoc(bookId, parentId, res.title, res.docType, res.content)

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
      return false
    } catch (e) {
      updateItem(item.uid, { status: 'error', message: (e as Error)?.message || '创建文档失败' })
      return false
    }
  }

  /** 入列一批文件（去重后由单一循环顺序导入，逐个反馈） */
  async function enqueue(files: File[]) {
    const fresh = files.filter((f) => !handledRef.current.has(fileKey(f)))
    if (fresh.length === 0) return
    for (const f of fresh) handledRef.current.add(fileKey(f))
    queueRef.current.push(...fresh)

    // 已有循环在跑：交给它继续消费队列（避免并发导致列表状态互相覆盖）
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    let deduped = 0
    try {
      while (queueRef.current.length > 0) {
        const file = queueRef.current.shift()
        if (!file) break
        const item: ImportItem = {
          uid: `imp-${Date.now()}-${seqRef.current++}`,
          name: file.name,
          status: 'waiting',
          message: '等待导入',
        }
        setItems((list) => [...list, item])
        if (await importOne(item, file)) deduped++
      }
    } finally {
      runningRef.current = false
      setRunning(false)
      onImported()
      // 秒传汇总：只在真有命中时提示，避免每次导入都刷一条无意义 toast
      if (deduped > 0) {
        message.success(`本次有 ${deduped} 个文件命中秒传（内容已存在，未重复存储）`)
      }
    }
  }

  async function handleFiles(fileList: UploadFile[]) {
    const files: File[] = []
    for (const f of fileList) {
      if (f.originFileObj) files.push(f.originFileObj)
    }
    if (files.length > 0) await enqueue(files)
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
          if (fileList.length > 0) void handleFiles(fileList)
        }}
        style={{ background: '#fafafa' }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined style={{ color: '#2f54eb' }} />
        </p>
        <p className="ant-upload-text">点击或拖拽文件到此处</p>
        <p className="ant-upload-hint">
          支持 .md / .txt / .docx / .html / .xlsx / .xls / .csv / .pdf / .pptx / .drawio / .vsd / .vsdx /
          .dwg / .dxf / .et / .excalidraw，可多选批量导入
        </p>
      </Upload.Dragger>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        · <b>.docx / .pdf / .pptx</b>：按原文件保存，阅读界面内直接预览（.pptx 支持翻页与自动播放）
        <br />· <b>.dwg / .dxf</b>：保留原图，后端自动转换为 .svg + .png，前端可缩放拖动并导出
        <br />· <b>.drawio</b>：建为「绘图」文档，内嵌 draw.io 组件直接编辑
        <br />· <b>.excalidraw</b>：建为「白板」文档，内嵌 Excalidraw 组件直接编辑
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
                  {it.dedup && (
                    <Tooltip title="该文件内容已存在于文库中，本次仅新增引用，未重复存储">
                      <Tag color="blue">秒传</Tag>
                    </Tooltip>
                  )}
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
