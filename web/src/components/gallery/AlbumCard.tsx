import { Button, Image, Tooltip } from 'antd'
import { DownloadOutlined, FileImageOutlined, WarningOutlined } from '@ant-design/icons'
import type { GalleryImage } from '../../types'
import './gallery.css'

/** 字节数友好显示 */
export function humanSize(n: number): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

interface Props {
  image: GalleryImage
  /** 卡片右下角操作区（编辑态用来放「重命名 / 删除」） */
  actions?: React.ReactNode
  /** 是否放进灯箱分组（阅读态开启，点击缩略图即放大） */
  preview?: boolean
  /** 点击卡片缩略图（非原生灯箱模式时）的回调，用于阅读态自定义灯箱 */
  onClick?: () => void
}

/**
 * 相册里的一张卡片。
 *
 * 三态：
 *   - 正常：缩略图 + 灯箱预览（点开看的是 1600 的预览图，不是几十 MB 的原件）
 *   - 降级（degraded）：条纹占位卡 + 扩展名 + 原因，原件仍可下载
 *   - SVG：preview/thumb 就是原件本身（矢量，浏览器自己缩放）
 */
export default function AlbumCard({ image, actions, preview = true }: Props) {
  const meta = (
    <div className="hk-album-meta">
      <div className="hk-album-name" title={image.name}>
        {image.name}
      </div>
      <div className="hk-album-sub">
        <span>{humanSize(image.size)}</span>
        {image.width > 0 && image.height > 0 && (
          <span>
            {image.width}×{image.height}
          </span>
        )}
        {image.degraded && (
          <Tooltip title={image.note || '未能生成预览图'}>
            <span style={{ color: '#fa8c16', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <WarningOutlined /> 无预览
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  )

  const downloadBtn = (
    <Tooltip title="下载原图">
      <Button
        size="small"
        icon={<DownloadOutlined />}
        onClick={(e) => {
          e.stopPropagation()
          window.open(image.url, '_blank')
        }}
      />
    </Tooltip>
  )

  const thumb = image.degraded ? (
    <div className="hk-album-placeholder">
      <FileImageOutlined style={{ fontSize: 32 }} />
      <span className="hk-album-ext">{image.ext || '文件'}</span>
    </div>
  ) : preview ? (
    <Image
      src={image.preview || image.thumb || image.url}
      fallback={image.url}
      alt={image.name}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  ) : (
    <img src={image.thumb || image.preview || image.url} alt={image.name} />
  )

  return (
    <div className="hk-album-card">
      <div className="hk-album-thumb" style={image.degraded ? { cursor: 'default' } : undefined}>
        {thumb}
        <div className="hk-album-hover">{downloadBtn}</div>
      </div>
      {meta}
      {actions && <div className="hk-album-actions">{actions}</div>}
    </div>
  )
}
