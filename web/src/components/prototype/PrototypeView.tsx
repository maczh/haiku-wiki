import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, Image, Modal, Segmented, Tag, Tooltip, message } from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileUnknownOutlined,
  GlobalOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import type { PrototypeContent, PrototypeItem } from '../../types'
import { regeneratePrototypeItem } from '../../api/prototype'
import './prototype.css'

interface Props {
  content: string
  /** 文档 id：阅读态「重新生成」需要它来调用后端；分享页等无 docId 时不显示该按钮 */
  docId?: number
  /** 重新生成后通知外层刷新 */
  onChanged?: () => void
}

export function parsePrototype(content: string): PrototypeContent {
  if (!content || !content.trim()) return { version: 1, items: [] }
  try {
    const obj = JSON.parse(content) as PrototypeContent
    return { version: obj?.version ?? 1, items: Array.isArray(obj?.items) ? obj.items : [] }
  } catch {
    return { version: 1, items: [] }
  }
}

const KIND_LABEL: Record<PrototypeItem['kind'], string> = {
  html: '网页原型',
  image: '图片原型',
  other: '工程文件',
}
const KIND_COLOR: Record<PrototypeItem['kind'], string> = {
  html: 'blue',
  image: 'green',
  other: 'default',
}

function humanSize(n: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

type SizeMode = 'preview' | 'thumb' | 'original'

/**
 * 需求原型阅读态：一张卡片 = 一个原型（一份需求说明 + 它的载体）。
 *   - 网页原型（html）：直接打开入口页（新窗口）
 *   - 图片原型：预览图 + 灯箱（支持屏宽/缩略图/原尺寸三档切换）
 *   - 工程文件（.rp/.mp/.sketch 等无法在网页渲染的）：占位 + 原件下载
 */
export default function PrototypeView({ content, docId, onChanged }: Props) {
  const [items, setItems] = useState<PrototypeItem[]>(() => parsePrototype(content).items)
  useEffect(() => {
    setItems(parsePrototype(content).items)
  }, [content])
  const [preview, setPreview] = useState<PrototypeItem | null>(null)
  const [sizeMode, setSizeMode] = useState<SizeMode>('preview')
  const [regenLoading, setRegenLoading] = useState(false)

  // 切换预览项时回到默认的「屏宽」档
  useEffect(() => {
    setSizeMode('preview')
  }, [preview])

  const currentSrc = useMemo(() => {
    if (!preview) return ''
    if (sizeMode === 'preview') return preview.preview || preview.url
    if (sizeMode === 'thumb') return preview.thumb || preview.preview || preview.url
    // 原尺寸：优先 original（非图片格式为全分辨率派生图），回退到原图 url
    return preview.original || preview.url
  }, [preview, sizeMode])

  async function handleRegenerate() {
    if (!docId || !preview) return
    setRegenLoading(true)
    try {
      const { item } = await regeneratePrototypeItem(docId, preview.id)
      // 用返回的最新条目更新本地列表与当前预览
      setItems((prev) => prev.map((x) => (x.id === item.id ? item : x)))
      setPreview(item)
      message.success('已重新生成预览图')
      onChanged?.()
    } catch {
      /* 拦截器已提示 */
    } finally {
      setRegenLoading(false)
    }
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: '40px 0' }}>
        <Empty description="这个需求原型库还是空的，切换到编辑模式即可上传原型" />
      </div>
    )
  }

  return (
    <div className="hk-proto">
      <div className="hk-proto-bar">
        <span className="hk-proto-count">共 {items.length} 个原型</span>
      </div>
      <div className="hk-proto-grid">
        {items.map((it) => {
          const hasPreview = !!it.preview && !it.degraded
          const thumb = it.thumb || it.preview || it.url
          return (
            <Card key={it.id} className="hk-proto-card" bordered>
              <div className="hk-proto-thumb">
                {it.kind === 'html' ? (
                  <div className="hk-proto-thumb-placeholder">
                    <GlobalOutlined />
                    <span>网页原型</span>
                  </div>
                ) : hasPreview ? (
                  <Image src={thumb} alt={it.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : it.kind === 'image' ? (
                  <div className="hk-proto-thumb-placeholder">
                    <FileImageOutlined />
                    <span>暂无预览</span>
                  </div>
                ) : (
                  <div className="hk-proto-thumb-placeholder">
                    <FileUnknownOutlined />
                    <span>{it.filename || it.ext.toUpperCase()}</span>
                  </div>
                )}
                <Tag className="hk-proto-kind" color={KIND_COLOR[it.kind]}>
                  {KIND_LABEL[it.kind]}
                </Tag>
              </div>
              <div className="hk-proto-body">
                <div className="hk-proto-title" title={it.title}>
                  {it.title}
                </div>
                <div className="hk-proto-desc">{it.desc || '（未填写需求描述）'}</div>
                <div className="hk-proto-actions">
                  {it.kind === 'html' && it.entry && (
                    <Tooltip title="在新窗口打开原型">
                      <Button
                        size="small"
                        type="link"
                        icon={<GlobalOutlined />}
                        href={it.entry}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开
                      </Button>
                    </Tooltip>
                  )}
                  {hasPreview && (
                    <Tooltip title="预览大图">
                      <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setPreview(it)}>
                        预览
                      </Button>
                    </Tooltip>
                  )}
                  <Tooltip title="下载原件">
                    <Button size="small" type="link" icon={<DownloadOutlined />} href={it.url} target="_blank" rel="noreferrer">
                      原件{humanSize(it.size) && ` (${humanSize(it.size)})`}
                    </Button>
                  </Tooltip>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <Modal
        open={!!preview}
        footer={
          preview && preview.kind !== 'html' && docId ? (
            <Button icon={<ReloadOutlined />} loading={regenLoading} onClick={handleRegenerate}>
              重新生成
            </Button>
          ) : null
        }
        title={preview?.title}
        width="80%"
        onCancel={() => setPreview(null)}
        destroyOnClose
      >
        {preview?.kind === 'html' && preview.entry ? (
          <iframe src={preview.entry} title={preview.title} className="hk-proto-frame" />
        ) : (
          <>
            <Segmented
              options={[
                { label: '屏宽', value: 'preview' },
                { label: '缩略图', value: 'thumb' },
                { label: '原尺寸', value: 'original' },
              ]}
              value={sizeMode}
              onChange={(v) => setSizeMode(v as SizeMode)}
              style={{ marginBottom: 12 }}
            />
            <Image src={currentSrc} alt={preview?.title} style={{ maxWidth: '100%' }} />
          </>
        )}
      </Modal>
    </div>
  )
}
