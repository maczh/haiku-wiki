import { useMemo } from 'react'
import { Alert, Empty, Image } from 'antd'
import type { GalleryContent, GalleryImage } from '../../types'
import AlbumCard from './AlbumCard'
import './gallery.css'

interface Props {
  content: string
}

/** 解析正文；坏 JSON / 空串都当空相册处理，不让一篇坏数据把页面打白 */
export function parseGallery(content: string): GalleryContent {
  if (!content || !content.trim()) return { version: 1, images: [] }
  try {
    const obj = JSON.parse(content) as GalleryContent
    return { version: obj?.version ?? 1, images: Array.isArray(obj?.images) ? obj.images : [] }
  } catch {
    return { version: 1, images: [] }
  }
}

/**
 * 图片库阅读态：一本电子相册。
 *
 * 网格用缩略图（400），点开用预览图（1600），下载给原件——
 * 直接把几十 MB 的原图塞进网格会把浏览器拖死，这是三层尺寸存在的意义。
 */
export default function GalleryView({ content }: Props) {
  const images: GalleryImage[] = useMemo(() => parseGallery(content).images, [content])

  if (images.length === 0) {
    return (
      <div style={{ padding: '40px 0' }}>
        <Empty description="这个图片库还没有图片，切换到编辑模式即可批量上传" />
      </div>
    )
  }

  const degraded = images.filter((i) => i.degraded)

  return (
    <div className="hk-album">
      <div className="hk-album-bar">
        <span className="hk-album-count">共 {images.length} 张图片</span>
      </div>
      {degraded.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`有 ${degraded.length} 张图片未能生成预览图`}
          description="服务端缺少对应的图片转换器（如 HEIC/PSD/CDR/AI 需要 ImageMagick）。原件已保存，可直接下载查看。"
        />
      )}
      {/* PreviewGroup：整组图片串成一个灯箱，可左右翻页 */}
      <Image.PreviewGroup>
        <div className="hk-album-grid">
          {images.map((img) => (
            <AlbumCard key={img.id} image={img} />
          ))}
        </div>
      </Image.PreviewGroup>
    </div>
  )
}
