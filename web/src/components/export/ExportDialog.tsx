import { useEffect, useState } from 'react'
import { Alert, Input, Modal, Radio, Spin, Typography, message } from 'antd'
import { exportBookBlob, exportDocBlob, getExportFormats, saveBlob } from '../../api/docs'
import type { DocExportFormats, DocType } from '../../types'

export interface ExportTarget {
  kind: 'doc' | 'book'
  /** doc 模式必填 */
  docId?: number
  /** book 模式必填 */
  bookId?: number
  /** 默认文件名（文档标题/知识库名，不含扩展名） */
  title: string
  /** doc 模式的文档类型（决定可选格式；真实格式清单以服务端返回为准） */
  docType?: DocType
}

/**
 * 导出对话框：
 *  格式清单来自服务端 GET /api/export/docs/:id/formats（单一事实来源），
 *  转换全部在服务端完成，前端只负责保存返回的二进制流：
 *    文档 → .md / .docx / .pdf ；表格 → .xlsx / .csv / .json ；
 *    思维导图 → .km / .smm / .xmind / .mm / .png ；流程图 → .md / .svg / .png ；
 *    附件型（doc_type=file，导入的 docx/pdf）→ 原样下载原文件。
 *  保存：浏览器支持 File System Access API 时弹系统保存对话框，否则降级浏览器下载。
 */
export default function ExportDialog({
  open,
  onClose,
  target,
}: {
  open: boolean
  onClose: () => void
  target: ExportTarget | null
}) {
  const [format, setFormat] = useState<string>('')
  const [filename, setFilename] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fallbackTip, setFallbackTip] = useState(false)
  const [meta, setMeta] = useState<DocExportFormats | null>(null)
  const [loadError, setLoadError] = useState('')

  const isBook = target?.kind === 'book'
  const isAttachment = !isBook && !!meta?.is_file
  /**
   * 附件里只有 CAD（.dwg/.dxf）有服务端派生出的可选格式（svg/png），
   * 其余附件（docx/pdf/pptx…）只有"原文件"一种，无需让用户选。
   */
  const allFormats = meta?.formats ?? []
  const isCadAttachment = isAttachment && allFormats.length > 1
  /**
   * 绘图文档（doc_type=drawing）的 .svg/.png/.vsdx 需要浏览器侧 mxGraph 渲染，
   * 服务端无法生成，因此这里只暴露 .drawio，并引导用户去编辑器里导出其余格式。
   */
  const isDrawing = !isBook && meta?.doc_type === 'drawing'
  const formats = isDrawing ? allFormats.filter((f) => f.value === 'drawio') : allFormats
  const spec = formats.find((f) => f.value === format)
  const pickable = !isBook && (!isAttachment || isCadAttachment)
  const ext = isBook
    ? 'md.zip'
    : isAttachment && !isCadAttachment
      ? extOf(meta?.filename ?? '') || 'bin'
      : spec?.ext || 'md'

  // 每次打开时按目标重置，并向服务端拉取该文档的可用格式
  useEffect(() => {
    if (!open || !target) return
    setFallbackTip(typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker !== 'function')
    setFilename(target.title)
    setLoadError('')
    setMeta(null)
    setFormat('')
    if (target.kind === 'book') return

    let alive = true
    setLoading(true)
    getExportFormats(target.docId!)
      .then((m) => {
        if (!alive) return
        setMeta(m)
        setFormat(m.default || m.formats?.[0]?.value || '')
      })
      .catch((e) => {
        if (alive) setLoadError((e as Error)?.message || '获取导出格式失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, target])

  /** 执行导出：后端转换 → saveBlob（picker 优先，降级下载） */
  async function doExport() {
    if (!target) return
    setSaving(true)
    try {
      let blob: Blob
      let name: string
      if (target.kind === 'book') {
        const r = await exportBookBlob(target.bookId!, target.title)
        blob = r.blob
        name = r.filename
      } else {
        // 附件里只有 CAD 需要选格式（原图 / svg / png）；其余附件直接下载原文件
        const r = await exportDocBlob(target.docId!, target.title, pickable ? format : undefined)
        blob = r.blob
        const typed = filename.trim()
        // 用户改过文件名 → 以自己的命名为准；否则沿用服务端命名（扩展名与去重更可靠）
        name = typed && typed !== target.title ? `${typed}.${ext}` : r.filename
      }
      const how = await saveBlob(blob, name)
      if (how === 'picker') message.success(`已导出：${name}`)
      else message.info(`文件将保存到浏览器下载目录：${name}`)
      onClose()
    } catch (e) {
      message.error((e as Error)?.message || '导出失败')
    } finally {
      setSaving(false)
    }
  }

  const okDisabled = isBook ? false : loading || !!loadError || (pickable && !format)

  return (
    <Modal
      title="导出"
      open={open && !!target}
      onCancel={onClose}
      onOk={() => void doExport()}
      confirmLoading={saving}
      okButtonProps={{ disabled: okDisabled }}
      okText={isAttachment && !isCadAttachment ? '下载原文件' : '导出'}
      cancelText="取消"
      destroyOnClose
      width={480}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {isBook
          ? '知识库将按目录结构导出为 Markdown 压缩包（附件型文档按原文件打包）'
          : isCadAttachment
            ? '图纸原文件与后端转换出的矢量图/位图均可导出'
            : isAttachment
              ? '该文档为导入的原始文件，按原样保存、内容不可编辑，导出即下载原文件'
              : '选择导出格式，转换在服务端完成后下载'}
      </Typography.Paragraph>

      {loading && (
        <div style={{ padding: '12px 0' }}>
          <Spin size="small" /> <span style={{ marginLeft: 8, color: '#8a919f' }}>正在获取可用格式…</span>
        </div>
      )}

      {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 12 }} />}

      {!isBook && !loading && !loadError && isAttachment && !isCadAttachment && (
        <Alert
          type="info"
          showIcon
          message={meta?.filename || '原始文件'}
          description="导出的文件名与内容与上传时完全一致。"
        />
      )}

      {isDrawing && !loading && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="绘图文档这里仅支持导出 .drawio"
          description=".svg / .png / .vsdx 需要在浏览器里由绘图内核渲染，服务端无法生成。请在绘图编辑器内点击顶部「导出」按钮获取这些格式。"
        />
      )}

      {!isBook && !loading && !loadError && pickable && (
        <Radio.Group
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {formats.map((o) => (
            <Radio key={o.value} value={o.value}>
              {o.label}
            </Radio>
          ))}
        </Radio.Group>
      )}

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          onPressEnter={() => !okDisabled && void doExport()}
          placeholder="文件名"
          addonAfter={'.' + ext}
        />
      </div>
      {fallbackTip && (
        <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
          当前浏览器不支持系统保存对话框，文件将保存到浏览器下载目录。
        </Typography.Text>
      )}
    </Modal>
  )
}

/** 从文件名取扩展名（小写，不含点）；无扩展名返回空串 */
function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}
