import { useEffect, useMemo, useState } from 'react'
import { Input, Modal, Radio, Typography, message } from 'antd'
import { getDoc, exportDocBlob, exportBookBlob, saveBlob } from '../../api/docs'
import { DOC_TYPE_LABEL, type DocType } from '../../types'

export interface ExportTarget {
  kind: 'doc' | 'book'
  /** doc 模式必填 */
  docId?: number
  /** book 模式必填 */
  bookId?: number
  /** 默认文件名（文档标题/知识库名，不含扩展名） */
  title: string
  /** doc 模式的文档类型（决定可选格式） */
  docType?: DocType
}

interface FormatOption {
  value: string
  label: string
  ext: string
}

/**
 * 导出对话框（第四轮 R6）：
 *  第一步选择目标格式——markdown→.md；知识库→.md.zip；表格/思维导图/流程图→.json（原始内容）。
 *  第二步输入文件名（默认=文档/知识库名，自动带扩展名）。
 *  保存：浏览器支持 File System Access API（window.showSaveFilePicker）时弹系统保存对话框，
 *  否则降级浏览器默认下载并提示"文件将保存到浏览器下载目录"。
 */
export default function ExportDialog({ open, onClose, target }: { open: boolean; onClose: () => void; target: ExportTarget | null }) {
  const [format, setFormat] = useState<string>('md')
  const [filename, setFilename] = useState('')
  const [saving, setSaving] = useState(false)
  const [fallbackTip, setFallbackTip] = useState(false)

  // 每次打开时按目标重置
  useEffect(() => {
    if (open && target) {
      const opts = formatOptions(target)
      setFormat(opts[0]?.value ?? 'md')
      setFilename(target.title)
      setFallbackTip(typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker !== 'function')
    }
  }, [open, target])

  const options = useMemo(() => (target ? formatOptions(target) : []), [target])

  const ext = options.find((o) => o.value === format)?.ext ?? 'md'

  /** 执行导出：按格式获取 blob → saveBlob（picker 优先，降级下载） */
  async function doExport() {
    if (!target) return
    setSaving(true)
    try {
      let blob: Blob
      let name = (filename.trim() || target.title) + '.' + ext
      if (format === 'md') {
        const r = await exportDocBlob(target.docId!, target.title)
        blob = r.blob
        // 尊重服务端 Content-Disposition 的命名（含中文转义还原）
        name = r.filename
      } else if (format === 'mdzip') {
        const r = await exportBookBlob(target.bookId!, target.title)
        blob = r.blob
        name = r.filename
      } else {
        // json：导出原始内容，前端直接生成 Blob，无需后端接口
        const res = await getDoc(target.docId!)
        blob = new Blob([res.doc.content ?? ''], { type: 'application/json;charset=utf-8' })
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

  return (
    <Modal
      title="导出"
      open={open && !!target}
      onCancel={onClose}
      onOk={() => void doExport()}
      confirmLoading={saving}
      okText="导出"
      cancelText="取消"
      destroyOnClose
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {target?.kind === 'book' ? '知识库将按目录结构导出为 Markdown 压缩包' : '选择导出格式'}
      </Typography.Paragraph>
      <Radio.Group value={format} onChange={(e) => setFormat(e.target.value)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((o) => (
          <Radio key={o.value} value={o.value}>
            {o.label}
          </Radio>
        ))}
      </Radio.Group>
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          onPressEnter={() => void doExport()}
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

/** 按导出目标派生可选格式（R6：仅三种，不做 .html） */
function formatOptions(target: ExportTarget): FormatOption[] {
  if (target.kind === 'book') {
    return [{ value: 'mdzip', label: 'Markdown 打包（.md.zip，按目录结构）', ext: 'md.zip' }]
  }
  if ((target.docType ?? 'markdown') === 'markdown') {
    return [{ value: 'md', label: 'Markdown 文档（.md）', ext: 'md' }]
  }
  // 表格/思维导图/流程图：导出原始内容 JSON
  return [{ value: 'json', label: `${DOC_TYPE_LABEL[target.docType ?? 'markdown']}原始内容（.json）`, ext: 'json' }]
}
