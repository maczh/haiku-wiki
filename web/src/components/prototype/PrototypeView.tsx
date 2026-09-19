import { useMemo, useState } from 'react'
import { Button, Card, Empty, Image, Modal, Tag, Tooltip } from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileUnknownOutlined,
  GlobalOutlined,
} from '@ant-design/icons'
import type { PrototypeContent, PrototypeItem } from '../../types'
import './prototype.css'

interface Props {
  content: string
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

/**
 * 需求原型阅读态：一张卡片 = 一个原型（一份需求说明 + 它的载体）。
 *   - 网页原型（html）：直接打开入口页（新窗口）
 *   - 图片原型：预览图 + 灯箱
 *   - 工程文件（.rp/.mp/.sketch 等无法在网页渲染的）：占位 + 原件下载
 */
export default function PrototypeView({ content }: Props) {
  const items: PrototypeItem[] = useMemo(() => parsePrototype(content).items, [content])
  const [preview, setPreview] = useState<PrototypeItem | null>(null)

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
        footer={null}
        title={preview?.title}
        width="80%"
        onCancel={() => setPreview(null)}
        destroyOnClose
      >
        {preview?.kind === 'html' && preview.entry ? (
          <iframe src={preview.entry} title={preview.title} className="hk-proto-frame" />
        ) : (
          <Image src={preview?.preview || preview?.url} alt={preview?.title} style={{ maxWidth: '100%' }} />
        )}
      </Modal>
    </div>
  )
}
