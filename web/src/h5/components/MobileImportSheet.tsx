import { useRef, useState } from 'react'
import { Button, Drawer, List, Spin, Typography, message } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, InboxOutlined } from '@ant-design/icons'
import { runImport, type ImportProgressItem } from '../../lib/import/runImport'

interface Props {
  open: boolean
  onClose: () => void
  /** 导入目标文库 id */
  bookId: number
  /** 导入完成（无论成功失败）回调，用于刷新目录树 */
  onImported?: () => void
}

/**
 * H5 导入面板：从手机选择文件导入当前文库。
 * 文件选择器放行所有类型：在微信内置浏览器里会调起系统选择器，可直接选取「微信文件」，
 * 从而满足「包括微信中的文件」的需求；桌面/普通浏览器则走常规文件选择。
 */
export default function MobileImportSheet({ open, onClose, bookId, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<ImportProgressItem[]>([])
  const [running, setRunning] = useState(false)

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    setRunning(true)
    setItems([])
    await runImport(files, {
      bookId,
      parentId: 0,
      onItem: (it) => {
        setItems((list) => {
          const idx = list.findIndex((x) => x.uid === it.uid)
          if (idx >= 0) {
            const next = list.slice()
            next[idx] = { ...next[idx], ...it }
            return next
          }
          return [...list, it]
        })
      },
      onDone: (s) => {
        setRunning(false)
        onImported?.()
        if (s.ok > 0) message.success(`导入完成：成功 ${s.ok} 个${s.dedup > 0 ? `，其中 ${s.dedup} 个命中秒传` : ''}`)
        if (s.err > 0) message.warning(`${s.err} 个文件导入失败（未产生损坏文档）`)
      },
    })
  }

  const okCount = items.filter((i) => i.status === 'success').length
  const errCount = items.filter((i) => i.status === 'error').length

  return (
    <Drawer
      title="导入文件"
      placement="bottom"
      height="72%"
      open={open}
      onClose={onClose}
      rootClassName="h5-import-sheet"
      extra={items.length > 0 && !running ? <Button type="primary" size="small" onClick={onClose}>完成</Button> : null}
    >
      <input
        ref={inputRef}
        type="file"
        accept="*/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = '' // 允许重复选同一文件
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={running}
        style={{
          width: '100%',
          padding: '28px 12px',
          border: '1.5px dashed #d0d5dd',
          borderRadius: 12,
          background: '#fafbfc',
          color: '#1f2329',
          fontSize: 15,
          cursor: 'pointer',
        }}
      >
        <InboxOutlined style={{ fontSize: 26, color: '#2f54eb', display: 'block', margin: '0 auto 8px' }} />
        点击选择手机中的文件
        <br />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          支持 md/txt/md.zip（md+图片包）/docx/pdf/xlsx/pptx/drawio/vsd/dwg…；微信内可直接选「微信文件」
        </Typography.Text>
      </button>

      {running && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0' }}>
          <Spin size="small" />
          <Typography.Text type="secondary">导入中，请稍候…</Typography.Text>
        </div>
      )}

      {!running && items.length > 0 && (
        <Typography.Paragraph
          type={errCount === 0 ? 'success' : 'warning'}
          style={{ marginTop: 12, marginBottom: 8 }}
        >
          完成：成功 {okCount} 个{errCount > 0 ? `，失败 ${errCount} 个` : ''}
        </Typography.Paragraph>
      )}

      {items.length > 0 && (
        <List
          size="small"
          dataSource={items}
          renderItem={(it) => (
            <List.Item>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                {it.status === 'success' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
                {it.status === 'error' && <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
                {(it.status === 'waiting' || it.status === 'parsing') && <Spin size="small" />}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                  {it.message}
                </Typography.Text>
              </div>
            </List.Item>
          )}
        />
      )}
    </Drawer>
  )
}
